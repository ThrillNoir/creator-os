import { humanAuditActor, identityAuditStatement, isSameOriginRequest, rejectClientActorRole } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { SOURCE_MEDIA_CHUNK_BYTES, SOURCE_MEDIA_MAX_BYTES, SOURCE_MEDIA_SESSION_MINUTES, expectedMime, isSha256, noStoreJson, privateOriginalKey, validSourceFilename } from "@/lib/source-media";

type IntentInput = { assetId?: unknown; filename?: unknown; bytes?: unknown; sha256?: unknown; mimeType?: unknown; sourceRevision?: unknown; actorRole?: unknown; actor_role?: unknown; effectiveRole?: unknown };

function text(value: unknown, max: number) {
  return typeof value === "string" && value.length <= max ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const input = await request.json().catch(() => null) as IntentInput | null;
  if (!input || typeof input !== "object") return noStoreJson({ ok: false, error: "invalid_intent" }, 400);
  try { rejectClientActorRole(input as Record<string, unknown>); } catch { return noStoreJson({ ok: false, error: "invalid_intent" }, 400); }
  const assetId = text(input.assetId, 200);
  const filename = text(input.filename, 512);
  const bytes = Number(input.bytes);
  const sha256 = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : "";
  const mimeType = text(input.mimeType, 160).toLowerCase();
  const sourceRevision = text(input.sourceRevision, 240) || `direct:${crypto.randomUUID()}`;
  if (!assetId || !validSourceFilename(filename) || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > SOURCE_MEDIA_MAX_BYTES || !isSha256(sha256)) return noStoreJson({ ok: false, error: "invalid_intent" }, 400);

  const context = await requireCreatorContext("mutate");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const asset = await DB.prepare("SELECT id,basename,extension FROM assets WHERE id=? AND creator_id=? AND source_available=1").bind(assetId, context.creator.creator_id).first<{ id: string; basename: string; extension: string }>();
  if (!asset || asset.basename !== filename || expectedMime(asset.extension) !== mimeType) return noStoreJson({ ok: false, error: "asset_metadata_mismatch" }, 409);

  const duplicate = await DB.prepare(`SELECT id,status FROM asset_ingest_sessions
    WHERE creator_id=? AND asset_id=? AND source_revision=? AND expected_sha256=?
    ORDER BY created_at DESC LIMIT 1`).bind(context.creator.creator_id, asset.id, sourceRevision, sha256).first<{ id: string; status: string }>();
  if (duplicate?.status === "finalized") return noStoreJson({ ok: true, sessionId: duplicate.id, status: "finalized", replay: true });
  if (duplicate && ["created", "uploading"].includes(duplicate.status)) return noStoreJson({ ok: true, sessionId: duplicate.id, status: duplicate.status, replay: true });

  const sessionId = crypto.randomUUID();
  const objectId = crypto.randomUUID();
  const objectKey = privateOriginalKey();
  const expiresAt = new Date(Date.now() + SOURCE_MEDIA_SESSION_MINUTES * 60_000).toISOString();
  const multipart = await LIBRARY_MEDIA.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: mimeType, contentDisposition: "attachment", cacheControl: "private, no-store" },
    customMetadata: { creator_id: context.creator.creator_id, asset_id: asset.id, source_session: sessionId, expected_sha256: sha256 },
  });
  try {
    await DB.batch([
      DB.prepare(`INSERT INTO asset_storage_objects
        (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,source_revision,ingest_status)
        VALUES (?,?,?,'r2','canonical_original','library_media',?,?,?,?,?,'m1_direct',?,'pending')`)
        .bind(objectId, context.creator.creator_id, asset.id, objectKey, filename, bytes, mimeType, sha256, sourceRevision),
      DB.prepare(`INSERT INTO asset_ingest_sessions
        (id,creator_id,asset_id,storage_object_id,source_revision,expected_sha256,expected_bytes,expected_mime_type,status,expires_at,object_key,multipart_upload_id,chunk_bytes,actor_email,actor_role)
        VALUES (?,?,?,?,?,?,?,?, 'created',?,?,?,?,?,?)`)
        .bind(sessionId, context.creator.creator_id, asset.id, objectId, sourceRevision, sha256, bytes, mimeType, expiresAt, objectKey, multipart.uploadId, SOURCE_MEDIA_CHUNK_BYTES, context.email, context.creator.role),
      DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'intent_created',?)")
        .bind(crypto.randomUUID(), context.creator.creator_id, asset.id, sessionId, context.email, context.creator.role, JSON.stringify({ byteCount: bytes, mimeType, source: "direct" })),
      identityAuditStatement(DB, humanAuditActor(context), "source_media_intent_created", asset.id, { byteCount: bytes, mimeType, source: "direct" }),
      DB.prepare("UPDATE creator_media_source_states SET migration_state=CASE WHEN migration_state='dropbox' THEN 'planned' ELSE migration_state END,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(context.creator.creator_id),
    ]);
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    return noStoreJson({ ok: false, error: "intent_persistence_failed" }, 503);
  }
  return noStoreJson({ ok: true, sessionId, status: "created", partBytes: SOURCE_MEDIA_CHUNK_BYTES, expiresAt, uploadPath: `/api/source-media/intents/${sessionId}/parts/{partNumber}`, finalizePath: `/api/source-media/intents/${sessionId}/finalize` }, 201);
}
