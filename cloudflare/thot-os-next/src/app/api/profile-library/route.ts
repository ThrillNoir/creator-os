import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { isSameOriginRequest } from "@/lib/audit-identity";
import { CloudflareProfileImageProcessor, PROFILE_IMAGE_MAX_BYTES } from "@/lib/profile-image-processing";
import { immutableR2IdentityMatches } from "@/lib/source-media";

export const runtime = "nodejs";

type Surface = "public_sfw" | "adult_profile";
type RequestBody = { surface?: unknown; versionId?: unknown; assetId?: unknown; rightsConfirmed?: unknown; subjectConsents?: unknown };
type Candidate = { id: string; basename: string; display_stem: string | null; extension: string; preview_r2_key: string | null; byte_count: number; people_count: number };
type Source = { id: string; object_key: string; byte_count: number; verified_mime_type: string; sha256: string; r2_version: string | null; r2_etag: string | null };

const ID = /^[a-zA-Z0-9_-]{1,160}$/;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic"]);
const fail = (code: string, status: number) => Response.json({ ok: false, error: code }, { status, headers: { "cache-control": "no-store" } });

function previewUrl(creatorId: string, key: string | null) {
  const prefix = `creators/${creatorId}/assets/`;
  if (!key?.startsWith(prefix)) return null;
  const id = key.slice(prefix.length).split("/")[0];
  return /^[a-f0-9]{64}$/.test(id) ? `/api/preview/${id}` : null;
}

export async function GET(request: Request) {
  const context = await requireCreatorContext("view");
  const creatorId = context.creator.creator_id;
  const { DB } = cloudflareEnv();
  const url = new URL(request.url);
  const surface = url.searchParams.get("surface");
  const versionId = url.searchParams.get("versionId");
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  if ((surface !== "public_sfw" && surface !== "adult_profile") || !versionId || !ID.test(versionId)) return fail("invalid_scope", 400);
  const version = surface === "public_sfw"
    ? await DB.prepare("SELECT id,status FROM creator_public_profile_versions WHERE id=? AND creator_id=? AND status IN ('draft','approved','published')").bind(versionId, creatorId).first<{ id: string; status: string }>()
    : await DB.prepare("SELECT id,status FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status IN ('draft','approved','published')").bind(versionId, creatorId).first<{ id: string; status: string }>();
  if (!version) return fail("version_unavailable", 404);
  const rows = await DB.prepare(`SELECT a.id,a.basename,a.display_stem,a.extension,a.preview_r2_key,o.byte_count,
      (SELECT COUNT(*) FROM asset_people ap WHERE ap.creator_id=a.creator_id AND ap.asset_id=a.id) AS people_count
    FROM assets a
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id
      AND ma.authority_kind='r2_native' AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
    JOIN asset_storage_objects o ON o.id=ma.canonical_storage_object_id AND o.asset_id=a.id AND o.creator_id=a.creator_id
    WHERE a.creator_id=? AND (?='' OR instr(lower(COALESCE(a.display_stem,a.basename)),lower(?))>0)
      AND a.source_available=1 AND o.provider='r2' AND o.storage_role='canonical_original'
      AND o.bucket_role='library_media' AND o.ingest_status='verified' AND o.object_key=a.media_r2_key
      AND o.verified_mime_type IN ('image/jpeg','image/png','image/webp','image/avif','image/heic')
    ORDER BY a.modified_at DESC LIMIT 100`).bind(creatorId, search, search).all<Candidate>();
  const ids = rows.results.map((row) => row.id);
  const people = ids.length ? await DB.prepare(`SELECT ap.asset_id,ap.person_id,p.display_name,
      CASE WHEN sg.person_id IS NOT NULL THEN 1 ELSE 0 END AS consent_satisfied
    FROM asset_people ap JOIN people p ON p.id=ap.person_id AND p.creator_id=ap.creator_id
    LEFT JOIN creator_profile_library_subject_grants sg ON sg.creator_id=ap.creator_id
      AND sg.asset_id=ap.asset_id AND sg.person_id=ap.person_id AND sg.surface=?
      AND sg.revoked_at IS NULL AND (sg.expires_at IS NULL OR sg.expires_at>CURRENT_TIMESTAMP)
    WHERE ap.creator_id=? AND ap.asset_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.display_name`)
    .bind(surface, creatorId, ...ids).all<{ asset_id: string; person_id: number; display_name: string; consent_satisfied: number }>() : { results: [] };
  const current = await DB.prepare(`SELECT s.id,s.position,d.asset_id,a.basename,a.display_stem,a.extension
    FROM creator_profile_library_photo_selections s
    JOIN creator_profile_library_photo_derivatives d ON d.id=s.derivative_id AND d.creator_id=s.creator_id
    JOIN assets a ON a.id=d.asset_id AND a.creator_id=d.creator_id
    WHERE s.creator_id=? AND s.surface=? AND s.${surface === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id"}=?
    ORDER BY s.position`).bind(creatorId, surface, versionId)
    .all<{ id: string; position: number; asset_id: string; basename: string; display_stem: string | null; extension: string }>();
  return Response.json({ ok: true, canEdit: version.status === "draft", selected: current.results.map((row) => ({
    id: row.id, assetId: row.asset_id, name: row.display_stem ? `${row.display_stem}.${row.extension}` : row.basename,
    previewUrl: `/api/profile-library/${row.id}`, position: row.position,
  })), photos: rows.results.map((row) => ({
    id: row.id,
    name: row.display_stem ? `${row.display_stem}.${row.extension}` : row.basename,
    previewUrl: previewUrl(creatorId, row.preview_r2_key),
    supported: row.byte_count <= PROFILE_IMAGE_MAX_BYTES,
    people: people.results.filter((person) => person.asset_id === row.id).map((person) => ({ id: person.person_id, name: person.display_name, consentSatisfied: person.consent_satisfied === 1 })),
  })) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail("same_origin_required", 403);
  const context = await requireCreatorContext("mutate");
  const body = await request.json().catch(() => null) as RequestBody | null;
  const surface = body?.surface;
  const versionId = body?.versionId;
  const assetId = body?.assetId;
  if ((surface !== "public_sfw" && surface !== "adult_profile") || typeof versionId !== "string" || !ID.test(versionId)
    || typeof assetId !== "string" || !ID.test(assetId) || body?.rightsConfirmed !== true
    || !Array.isArray(body.subjectConsents) || body.subjectConsents.length > 30) return fail("invalid_selection", 400);
  const scope = surface as Surface;
  const creatorId = context.creator.creator_id;
  const { DB, MEDIA, LIBRARY_MEDIA, IMAGES } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket; IMAGES?: ImagesBinding };
  if (!LIBRARY_MEDIA || !IMAGES) return fail("image_processing_unavailable", 503);
  const version = scope === "public_sfw"
    ? await DB.prepare("SELECT id FROM creator_public_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first()
    : await DB.prepare("SELECT id FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first();
  if (!version) return fail("draft_required", 409);
  const source = await DB.prepare(`SELECT o.id,o.object_key,o.byte_count,o.verified_mime_type,o.sha256,o.r2_version,o.r2_etag
    FROM assets a
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    JOIN asset_storage_objects o ON o.id=ma.canonical_storage_object_id AND o.asset_id=a.id AND o.creator_id=a.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.source_available=1 AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
      AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media'
      AND o.ingest_status='verified' AND o.object_key=a.media_r2_key AND o.byte_count=a.bytes`).bind(assetId, creatorId).first<Source>();
  if (!source) return fail("verified_photo_required", 409);
  if (!IMAGE_TYPES.has(source.verified_mime_type)) return fail("unsupported_image_type", 400);
  if (source.byte_count > PROFILE_IMAGE_MAX_BYTES) return fail("photo_too_large", 400);
  if (!source.r2_version || !source.r2_etag) return fail("source_identity_missing", 409);
  const people = await DB.prepare(`SELECT ap.person_id,
      CASE WHEN sg.person_id IS NOT NULL THEN 1 ELSE 0 END AS consent_satisfied
    FROM asset_people ap JOIN people p ON p.id=ap.person_id AND p.creator_id=ap.creator_id
    LEFT JOIN creator_profile_library_subject_grants sg ON sg.creator_id=ap.creator_id
      AND sg.asset_id=ap.asset_id AND sg.person_id=ap.person_id AND sg.surface=?
      AND sg.revoked_at IS NULL AND (sg.expires_at IS NULL OR sg.expires_at>CURRENT_TIMESTAMP)
    WHERE ap.creator_id=? AND ap.asset_id=? ORDER BY ap.person_id`).bind(scope, creatorId, assetId).all<{ person_id: number; consent_satisfied: number }>();
  const subjectConsents = body.subjectConsents as Array<{ personId?: unknown; evidenceNote?: unknown }>;
  const missing = people.results.filter((person) => person.consent_satisfied !== 1);
  if (subjectConsents.length !== missing.length || missing.some((person) => !subjectConsents.some((consent) => consent?.personId === person.person_id && typeof consent.evidenceNote === "string" && consent.evidenceNote.trim().length >= 1 && consent.evidenceNote.length <= 1000))
    || subjectConsents.some((consent) => !missing.some((person) => person.person_id === consent?.personId))) return fail("subject_consent_required", 409);
  const selections = await DB.prepare(`SELECT COUNT(*) AS count,COALESCE(MAX(s.position),-1) AS last_position,
      SUM(CASE WHEN d.asset_id=? THEN 1 ELSE 0 END) AS already_selected
    FROM creator_profile_library_photo_selections s
    JOIN creator_profile_library_photo_derivatives d ON d.id=s.derivative_id AND d.creator_id=s.creator_id
    WHERE s.creator_id=? AND s.surface=? AND s.${scope === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id"}=?`).bind(assetId, creatorId, scope, versionId).first<{ count: number; last_position: number; already_selected: number | null }>();
  if ((selections?.count ?? 0) >= 6) return fail("photo_limit_reached", 409);
  if (selections?.already_selected) return fail("photo_already_selected", 409);
  if ((selections?.last_position ?? -1) !== (selections?.count ?? 0) - 1) return fail("photo_order_needs_review", 409);
  const existing = await DB.prepare("SELECT id,display_object_key,preview_object_key FROM creator_profile_library_photo_derivatives WHERE creator_id=? AND storage_object_id=? AND source_sha256=?")
    .bind(creatorId, source.id, source.sha256).first<{ id: string; display_object_key: string; preview_object_key: string }>();
  let derivativeId = existing?.id ?? crypto.randomUUID();
  let createdKeys: string[] = [];
  try {
    // Check the immutable source even when reusing a processed derivative.
    const object = await LIBRARY_MEDIA.get(source.object_key, { onlyIf: { etagMatches: source.r2_etag } });
    if (!object || !("body" in object) || !immutableR2IdentityMatches(source, object)) return fail("source_identity_changed", 409);
    let processed: Awaited<ReturnType<CloudflareProfileImageProcessor["process"]>> | null = null;
    if (!existing) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      processed = await new CloudflareProfileImageProcessor(IMAGES).process({ bytes, declaredContentType: source.verified_mime_type, role: "background" });
      if (processed.sourceSha256 !== source.sha256) return fail("source_checksum_changed", 409);
      const base = `profile-library/${creatorId}/${derivativeId}`;
      for (const [key, content] of [[`${base}/display.webp`, processed.display.bytes], [`${base}/preview.webp`, processed.preview.bytes]] as const) {
        createdKeys.push(key);
        const stored = await MEDIA.put(key, content, { httpMetadata: { contentType: "image/webp" } });
        if (!stored) throw new Error("profile_library_derivative_storage_failed");
      }
    }
    const selectionId = crypto.randomUUID();
    const statements = [
      ...(processed ? [DB.prepare(`INSERT INTO creator_profile_library_photo_derivatives
        (id,creator_id,asset_id,storage_object_id,source_sha256,source_r2_version,source_r2_etag,display_object_key,display_sha256,preview_object_key,preview_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(derivativeId, creatorId, assetId, source.id, source.sha256, source.r2_version, source.r2_etag,
          createdKeys[0], processed.display.sha256, createdKeys[1], processed.preview.sha256)] : []),
      DB.prepare(`INSERT INTO creator_profile_library_photo_grants (creator_id,asset_id,surface,confirmed_by,revoked_at)
        VALUES (?,?,?,?,NULL) ON CONFLICT(creator_id,asset_id,surface)
        DO UPDATE SET confirmed_by=excluded.confirmed_by,confirmed_at=CURRENT_TIMESTAMP,revoked_at=NULL`)
        .bind(creatorId, assetId, scope, context.email),
      ...subjectConsents.map((consent) => DB.prepare(`INSERT INTO creator_profile_library_subject_grants
        (creator_id,asset_id,person_id,surface,evidence_note,confirmed_by,revoked_at) VALUES (?,?,?,?,?,?,NULL)
        ON CONFLICT(creator_id,asset_id,person_id,surface)
        DO UPDATE SET evidence_note=excluded.evidence_note,confirmed_by=excluded.confirmed_by,confirmed_at=CURRENT_TIMESTAMP,revoked_at=NULL`)
        .bind(creatorId, assetId, consent.personId, scope, String(consent.evidenceNote).trim(), context.email)),
      DB.prepare(`INSERT INTO creator_profile_library_photo_selections
        (id,creator_id,surface,${scope === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id"},derivative_id,position)
        VALUES (?,?,?,?,?,?)`).bind(selectionId, creatorId, scope, versionId, derivativeId, (selections?.last_position ?? -1) + 1),
    ];
    await DB.batch(statements);
    return Response.json({ ok: true, photo: { id: selectionId, previewUrl: `/api/profile-library/${selectionId}` } }, { headers: { "cache-control": "no-store" } });
  } catch {
    // A batch response can be lost after D1 commits. Keep its media if D1
    // contains the derivative; release will still verify the exact checksum.
    const committed = createdKeys.length ? await DB.prepare("SELECT 1 FROM creator_profile_library_photo_derivatives WHERE id=? AND creator_id=?")
      .bind(derivativeId, creatorId).first().catch(() => "unknown") : null;
    if (createdKeys.length && committed === null) await MEDIA.delete(createdKeys).catch(() => undefined);
    return fail("selection_failed", 409);
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return fail("same_origin_required", 403);
  const context = await requireCreatorContext("mutate");
  const body = await request.json().catch(() => null) as { surface?: unknown; versionId?: unknown; selectionIds?: unknown } | null;
  const surface = body?.surface;
  const versionId = body?.versionId;
  const ids = body?.selectionIds;
  if ((surface !== "public_sfw" && surface !== "adult_profile") || typeof versionId !== "string" || !ID.test(versionId)
    || !Array.isArray(ids) || ids.length > 6 || ids.some((id) => typeof id !== "string" || !ID.test(id))
    || new Set(ids).size !== ids.length) return fail("invalid_order", 400);
  const creatorId = context.creator.creator_id;
  const { DB } = cloudflareEnv();
  const column = surface === "public_sfw" ? "public_profile_version_id" : "adult_profile_version_id";
  const version = surface === "public_sfw"
    ? await DB.prepare("SELECT id FROM creator_public_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first()
    : await DB.prepare("SELECT id FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first();
  if (!version) return fail("draft_required", 409);
  const current = await DB.prepare(`SELECT id,derivative_id FROM creator_profile_library_photo_selections
    WHERE creator_id=? AND surface=? AND ${column}=?`).bind(creatorId, surface, versionId).all<{ id: string; derivative_id: string }>();
  const byId = new Map(current.results.map((row) => [row.id, row.derivative_id]));
  if (ids.some((id) => !byId.has(id))) return fail("selection_unavailable", 404);
  try {
    await DB.batch([
      DB.prepare(`DELETE FROM creator_profile_library_photo_selections WHERE creator_id=? AND surface=? AND ${column}=?`).bind(creatorId, surface, versionId),
      ...ids.map((id, position) => DB.prepare(`INSERT INTO creator_profile_library_photo_selections
        (id,creator_id,surface,${column},derivative_id,position) VALUES (?,?,?,?,?,?)`)
        .bind(id, creatorId, surface, versionId, byId.get(id), position)),
    ]);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return fail("photo_order_failed", 409);
  }
}
