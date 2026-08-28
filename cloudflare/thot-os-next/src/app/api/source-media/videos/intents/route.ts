import { humanAuditActor, identityAuditStatement, isSameOriginRequest, rejectClientActorRole } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { nativeVideoDetails, validClientUploadId, validNativeVideoBytes } from "@/lib/native-video";
import { SOURCE_MEDIA_MAX_ACTIVE_VIDEO_UPLOADS, SOURCE_MEDIA_VIDEO_SESSION_MINUTES, multipartPartSize, noStoreJson, privateOriginalKey } from "@/lib/source-media";

type IntentInput = { filename?: unknown; bytes?: unknown; sha256?: unknown; mimeType?: unknown; clientUploadId?: unknown; actorRole?: unknown; actor_role?: unknown; effectiveRole?: unknown };

function isSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }

async function pendingHash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ExpiredSession = { id: string; object_key: string; multipart_upload_id: string | null };

/**
 * R2 also expires incomplete multipart uploads under its bucket lifecycle,
 * but we clear abandoned sessions at the next creator mutation so D1 stops
 * advertising a resumable upload after its shorter application lifetime.
 */
async function expireAbandonedSessions(DB: D1Database, bucket: R2Bucket, creatorId: string) {
  const expired = (await DB.prepare(`SELECT id,object_key,multipart_upload_id
    FROM asset_video_ingest_sessions
    WHERE creator_id=? AND finalization_state='incomplete' AND expires_at<=CURRENT_TIMESTAMP
    ORDER BY expires_at ASC LIMIT 10`).bind(creatorId).all<ExpiredSession>()).results;
  for (const session of expired) {
    if (!session.multipart_upload_id) continue;
    try {
      await bucket.resumeMultipartUpload(session.object_key, session.multipart_upload_id).abort();
      await DB.prepare("UPDATE asset_video_ingest_sessions SET status='expired',finalization_state='expired',failure_code='session_expired',multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete'").bind(session.id, creatorId).run();
    } catch {
      await DB.prepare("UPDATE asset_video_ingest_sessions SET failure_code='expiry_abort_uncertain',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete'").bind(session.id, creatorId).run().catch(() => undefined);
    }
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const input = await request.json().catch(() => null) as IntentInput | null;
  if (!input || typeof input !== "object") return noStoreJson({ ok: false, error: "invalid_intent" }, 400);
  try { rejectClientActorRole(input as Record<string, unknown>); } catch { return noStoreJson({ ok: false, error: "invalid_intent" }, 400); }
  const details = nativeVideoDetails(input.filename, input.mimeType);
  const bytes = Number(input.bytes);
  const sha256 = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : "";
  if (!details || !validNativeVideoBytes(bytes) || !isSha256(sha256) || !validClientUploadId(input.clientUploadId)) return noStoreJson({ ok: false, error: "invalid_intent" }, 400);

  const context = await requireCreatorContext("mutate");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  await expireAbandonedSessions(DB, LIBRARY_MEDIA, context.creator.creator_id);
  const existing = await DB.prepare(`SELECT id,asset_id,status,expected_bytes,expected_mime_type,expected_sha256,chunk_bytes
    FROM asset_video_ingest_sessions WHERE creator_id=? AND client_upload_id=?`).bind(context.creator.creator_id, input.clientUploadId)
    .first<{ id: string; asset_id: string; status: string; expected_bytes: number; expected_mime_type: string; expected_sha256: string; chunk_bytes: number }>();
  if (existing) {
    if (existing.expected_bytes !== bytes || existing.expected_mime_type !== details.mimeType || existing.expected_sha256 !== sha256) return noStoreJson({ ok: false, error: "idempotency_conflict" }, 409);
    if (["aborted", "expired", "failed"].includes(existing.status)) return noStoreJson({ ok: false, error: `session_${existing.status}` }, 409);
    return noStoreJson({ ok: true, sessionId: existing.id, assetId: existing.asset_id, status: existing.status, partBytes: existing.chunk_bytes, replay: true });
  }
  const active = await DB.prepare("SELECT COUNT(*) AS count FROM asset_video_ingest_sessions WHERE creator_id=? AND status IN ('created','uploading') AND finalization_state='incomplete' AND expires_at>CURRENT_TIMESTAMP").bind(context.creator.creator_id).first<{ count: number }>();
  if ((active?.count ?? 0) >= SOURCE_MEDIA_MAX_ACTIVE_VIDEO_UPLOADS) return noStoreJson({ ok: false, error: "active_video_upload_limit" }, 429);

  const chunkBytes = multipartPartSize(bytes);
  if (!chunkBytes) return noStoreJson({ ok: false, error: "invalid_intent" }, 400);
  const sessionId = crypto.randomUUID(); const assetId = crypto.randomUUID(); const objectId = crypto.randomUUID();
  const objectKey = privateOriginalKey(); const sourceRevision = `native_video:${input.clientUploadId}`;
  const expiresAt = new Date(Date.now() + SOURCE_MEDIA_VIDEO_SESSION_MINUTES * 60_000).toISOString();
  const multipart = await LIBRARY_MEDIA.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: details.mimeType, contentDisposition: "attachment", cacheControl: "private, no-store" },
    customMetadata: { creator_id: context.creator.creator_id, asset_id: assetId, source_session: sessionId, expected_sha256: sha256, ingest: "cloudflare_direct_video" },
  });
  try {
    await DB.batch([
      DB.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,source_available,indexed_at) VALUES (?,?,?, ?,?,?,CURRENT_TIMESTAMP,'native_direct',1,CURRENT_TIMESTAMP)")
        .bind(assetId, context.creator.creator_id, `native/${assetId}`, details.filename, details.extension, bytes),
      DB.prepare("INSERT INTO asset_storage_objects (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,source_revision,ingest_status) VALUES (?,?,?,'r2','canonical_original','library_media',?,?,?,?,?,'m1_direct',?,'pending')")
        .bind(objectId, context.creator.creator_id, assetId, objectKey, details.filename, bytes, "application/octet-stream", await pendingHash(`video-pending:${sessionId}`), sourceRevision),
      DB.prepare("INSERT INTO asset_media_authorities (asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state) VALUES (?,?,'r2_native','cloudflare_direct',?,'ingesting')")
        .bind(assetId, context.creator.creator_id, objectId),
      DB.prepare("INSERT INTO asset_video_playback_states (asset_id,creator_id,canonical_storage_object_id,state) VALUES (?,?,?,'uploading')")
        .bind(assetId, context.creator.creator_id, objectId),
      DB.prepare("INSERT INTO asset_video_ingest_sessions (id,creator_id,asset_id,storage_object_id,source_revision,expected_sha256,expected_bytes,expected_mime_type,status,expires_at,object_key,multipart_upload_id,chunk_bytes,actor_email,actor_role,client_upload_id) VALUES (?,?,?,?,?,?,?,?, 'created',?,?,?,?,?,?,?)")
        .bind(sessionId, context.creator.creator_id, assetId, objectId, sourceRevision, sha256, bytes, details.mimeType, expiresAt, objectKey, multipart.uploadId, chunkBytes, context.email, context.creator.role, input.clientUploadId),
      DB.prepare("INSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'intent_created',?)")
        .bind(crypto.randomUUID(), context.creator.creator_id, assetId, sessionId, context.email, context.creator.role, JSON.stringify({ byteCount: bytes, mimeType: details.mimeType, source: "cloudflare_direct" })),
      identityAuditStatement(DB, humanAuditActor(context), "native_video_intent_created", assetId, { byteCount: bytes, mimeType: details.mimeType, ingestChannel: "cloudflare_direct" }),
    ]);
  } catch {
    await multipart.abort().catch(() => undefined);
    return noStoreJson({ ok: false, error: "intent_persistence_failed" }, 503);
  }
  return noStoreJson({ ok: true, sessionId, assetId, status: "created", partBytes: chunkBytes, expiresAt, uploadPath: `/api/source-media/videos/intents/${sessionId}/parts/{partNumber}`, finalizePath: `/api/source-media/videos/intents/${sessionId}/finalize` }, 201);
}
