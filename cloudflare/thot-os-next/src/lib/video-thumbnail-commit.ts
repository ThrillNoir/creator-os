import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../../shared/service-auth.ts";
import { VIDEO_POSTER_MAX_BYTES, videoPosterIdentity } from "./video-poster.ts";
import { validateImageUpload } from "./profile-image-processing.ts";

const CREATOR = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ASSET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = Math.ceil(VIDEO_POSTER_MAX_BYTES * 4 / 3) + 4096;
const PRINCIPAL = "thot-os-thumbnail-runner";
const CAPABILITY = "library.thumbnail.commit";
const VIDEO_STATES = "('canonical_verified','processing_queued','processing','playback_ready','processing_failed')";

type Source = { key: string; revision: string; version: string; etag: string; bytes: number; codec: "h264" | "h265" };
type CommitInput = { creatorId: string; assetId: string; source: Source; posterBase64: string; contentType: "image/jpeg" };
type SourceRow = { posterKey: string | null; sourceKey: string; sourceRevision: string; version: string;
  etag: string; bytes: number; codec: string };

const sourceSql = `SELECT a.preview_r2_key AS posterKey,o.object_key AS sourceKey,
  o.source_revision AS sourceRevision,o.r2_version AS version,o.r2_etag AS etag,
  o.byte_count AS bytes,vp.source_codec AS codec
  FROM assets a
  JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id
    AND ma.authority_kind='r2_native' AND ma.state='canonical_verified'
  JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    AND vp.canonical_storage_object_id=ma.canonical_storage_object_id
    AND vp.state IN ${VIDEO_STATES} AND vp.source_codec IN ('h264','h265')
  JOIN asset_storage_objects o ON o.id=ma.canonical_storage_object_id
    AND o.asset_id=a.id AND o.creator_id=a.creator_id AND o.provider='r2'
    AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
  WHERE a.creator_id=? AND a.id=? AND a.source_available=1`;

const casSql = `UPDATE assets SET preview_r2_key=?
  WHERE id=? AND creator_id=? AND preview_r2_key IS NULL AND source_available=1
    AND EXISTS (SELECT 1 FROM asset_media_authorities ma
      JOIN asset_video_playback_states vp ON vp.asset_id=ma.asset_id AND vp.creator_id=ma.creator_id
        AND vp.canonical_storage_object_id=ma.canonical_storage_object_id
      JOIN asset_storage_objects o ON o.id=ma.canonical_storage_object_id
        AND o.asset_id=ma.asset_id AND o.creator_id=ma.creator_id
      WHERE ma.asset_id=assets.id AND ma.creator_id=assets.creator_id
        AND ma.authority_kind='r2_native' AND ma.state='canonical_verified'
        AND vp.state IN ${VIDEO_STATES} AND vp.source_codec=?
        AND o.provider='r2' AND o.storage_role='canonical_original'
        AND o.bucket_role='library_media' AND o.ingest_status='verified'
        AND o.object_key=? AND o.source_revision=? AND o.r2_etag=?
        AND o.r2_version=? AND o.byte_count=?)`;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validText(value: unknown, max = 1024): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}
function validInput(value: unknown): value is CommitInput {
  if (!record(value) || !exactKeys(value, ["creatorId", "assetId", "source", "posterBase64", "contentType"]) || !record(value.source)
    || !exactKeys(value.source, ["key", "revision", "version", "etag", "bytes", "codec"])) return false;
  const source = value.source;
  return typeof value.creatorId === "string" && CREATOR.test(value.creatorId)
    && typeof value.assetId === "string" && ASSET.test(value.assetId)
    && value.contentType === "image/jpeg"
    && typeof value.posterBase64 === "string" && value.posterBase64.length >= 8
    && value.posterBase64.length <= Math.ceil(VIDEO_POSTER_MAX_BYTES * 4 / 3)
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value.posterBase64)
    && validText(source.key) && !source.key.includes("..") && validText(source.revision, 160)
    && validText(source.version, 160) && validText(source.etag, 160)
    && Number.isSafeInteger(source.bytes) && Number(source.bytes) > 0 && Number(source.bytes) <= 5 * 1024 ** 3
    && (source.codec === "h264" || source.codec === "h265");
}
async function boundedJson(request: Request, timeoutMs: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) throw new Error("thumbnail_request_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("thumbnail_request_invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("thumbnail_request_timeout")), timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timedOut]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new Error("thumbnail_request_too_large");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { clearTimeout(timeoutId); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("thumbnail_request_invalid"); }
}
function sameSource(row: SourceRow | null, source: Source) {
  return row && row.sourceKey === source.key && row.sourceRevision === source.revision
    && row.version === source.version && row.etag === source.etag && row.bytes === source.bytes
    && row.codec === source.codec;
}
function sameSourceObject(head: R2Object | null, source: Source) {
  return head && head.key === source.key && head.version === source.version
    && head.etag === source.etag && head.size === source.bytes;
}
function posterMetadataValid(head: R2Object | null, key: string, creatorId: string, assetId: string, size: number) {
  return head?.key === key && head.size === size && head.httpMetadata?.contentType === "image/jpeg"
    && head.customMetadata?.creator_id === creatorId && head.customMetadata?.asset_id === assetId
    && head.customMetadata?.derivative === "video_poster_v1";
}
function decodeJpeg(input: CommitInput) {
  const raw = atob(input.posterBase64);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.length < 4 || bytes.length > VIDEO_POSTER_MAX_BYTES
    || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
    throw new Error("invalid_jpeg");
  validateImageUpload(bytes, "image/jpeg");
  return bytes;
}
function byteStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

/** One allowlisted, creator-scoped mutation. Caller must also pass Cloudflare Access. */
export async function handleVideoThumbnailCommit(request: Request, env: {
  DB: D1Database; PREVIEWS: R2Bucket; LIBRARY_MEDIA: R2Bucket; IMAGES: ImagesBinding;
}, { bodyTimeoutMs = 30_000 } = {}) {
  if (request.method !== "POST" || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return json({ ok: false, error: "invalid_request" }, 400);
  const authorization = request.headers.get("authorization") ?? "";
  const claimedCreator = request.headers.get("x-thot-os-creator-id") ?? "";
  if (!/^Bearer [^\s]{40,512}$/.test(authorization)
    || request.headers.get("x-thot-os-service-capability") !== CAPABILITY
    || !CREATOR.test(claimedCreator))
    return json({ ok: false, error: "not_found" }, 404);
  // Authenticate the scoped principal before accepting a large JPEG body.
  let identity;
  try { identity = await requireInternalServiceForCreator(request, env.DB, claimedCreator, PRINCIPAL, CAPABILITY); }
  catch { return json({ ok: false, error: "not_found" }, 404); }
  let input: unknown;
  try { input = await boundedJson(request, bodyTimeoutMs); }
  catch (error) { const tooLarge = error instanceof Error && error.message === "thumbnail_request_too_large";
    const timedOut = error instanceof Error && error.message === "thumbnail_request_timeout";
    return json({ ok: false, error: tooLarge ? "request_too_large" : timedOut ? "request_timeout" : "invalid_request" },
      tooLarge ? 413 : timedOut ? 408 : 400); }
  if (!validInput(input)) return json({ ok: false, error: "invalid_request" }, 400);
  if (input.creatorId !== claimedCreator) return json({ ok: false, error: "not_found" }, 404);
  let bytes: Uint8Array;
  try {
    bytes = decodeJpeg(input);
    const info = await env.IMAGES.info(byteStream(bytes));
    if (info.format !== "image/jpeg" || !Number.isInteger(info.width) || !Number.isInteger(info.height)
      || info.width < 1 || info.height < 1 || info.width > 960 || info.height > 960)
      throw new Error("invalid_jpeg");
  } catch { return json({ ok: false, error: "poster_invalid" }, 400); }
  const posterKey = (await videoPosterIdentity(input.creatorId, input.assetId, bytes)).key;
  let row: SourceRow | null;
  try { row = await env.DB.prepare(sourceSql).bind(input.creatorId, input.assetId).first<SourceRow>(); }
  catch { return json({ ok: false, error: "source_lookup_unavailable" }, 503); }
  if (!row || !sameSource(row, input.source)) return json({ ok: false, error: "source_changed" }, 409);
  if (row.posterKey === posterKey) return json({ ok: true, status: "already_committed" });
  if (row.posterKey !== null) return json({ ok: false, error: "poster_already_selected" }, 409);
  let sourceHead: R2Object | null;
  try { sourceHead = await env.LIBRARY_MEDIA.head(input.source.key); }
  catch { return json({ ok: false, error: "source_lookup_unavailable" }, 503); }
  if (!sameSourceObject(sourceHead, input.source)) return json({ ok: false, error: "source_changed" }, 409);
  let head: R2Object | null;
  try { head = await env.PREVIEWS.head(posterKey); }
  catch { return json({ ok: false, error: "poster_lookup_unavailable" }, 503); }
  if (!head) {
    try {
      const stored = await env.PREVIEWS.put(posterKey, bytes, {
        httpMetadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
        customMetadata: { creator_id: input.creatorId, asset_id: input.assetId, derivative: "video_poster_v1" },
        onlyIf: { etagDoesNotMatch: "*" },
      });
      head = stored ?? await env.PREVIEWS.head(posterKey);
    } catch { return json({ ok: false, error: "poster_storage_unavailable" }, 503); }
  }
  if (!head || !posterMetadataValid(head, posterKey, input.creatorId, input.assetId, bytes.length))
    return json({ ok: false, error: "poster_invalid" }, 409);
  // A pre-existing key (or a conditional-put race) is only reusable when its
  // actual bytes match the content-derived key. Metadata alone is insufficient.
  let existing: R2ObjectBody | R2Object | null;
  try { existing = await env.PREVIEWS.get(posterKey, { onlyIf: { etagMatches: head.etag } }); }
  catch { return json({ ok: false, error: "poster_lookup_unavailable" }, 503); }
  if (!existing || !("body" in existing) || existing.etag !== head.etag || existing.size !== bytes.length)
    return json({ ok: false, error: "poster_changed" }, 409);
  let storedBytes: Uint8Array;
  try { storedBytes = new Uint8Array(await existing.arrayBuffer()); }
  catch { return json({ ok: false, error: "poster_lookup_unavailable" }, 503); }
  if (storedBytes.length !== bytes.length || (await videoPosterIdentity(input.creatorId, input.assetId, storedBytes)).key !== posterKey)
    return json({ ok: false, error: "poster_invalid" }, 409);
  // Recheck the original after the private R2 write, before the D1 reference.
  try { sourceHead = await env.LIBRARY_MEDIA.head(input.source.key); }
  catch { return json({ ok: false, error: "source_lookup_unavailable" }, 503); }
  if (!sameSourceObject(sourceHead, input.source)) return json({ ok: false, error: "source_changed" }, 409);
  let results: D1Result<Record<string, unknown>>[];
  try { results = await env.DB.batch([
    env.DB.prepare(casSql).bind(posterKey, input.assetId, input.creatorId, input.source.codec,
      input.source.key, input.source.revision, input.source.etag, input.source.version, input.source.bytes),
    internalServiceAuditStatement(env.DB, identity, "video_thumbnail_commit_attempt"),
  ]); }
  catch { return json({ ok: false, error: "commit_uncertain" }, 503); }
  const changes = results[0]?.meta?.changes;
  if (changes === 1) return json({ ok: true, status: "committed" });
  if (changes !== 0) return json({ ok: false, error: "commit_uncertain" }, 503);
  let current: SourceRow | null;
  try { current = await env.DB.prepare(sourceSql).bind(input.creatorId, input.assetId).first<SourceRow>(); }
  catch { return json({ ok: false, error: "commit_uncertain" }, 503); }
  if (sameSource(current, input.source) && current?.posterKey === posterKey) return json({ ok: true, status: "already_committed" });
  return json({ ok: false, error: current?.posterKey ? "poster_already_selected" : "source_changed" }, 409);
}
