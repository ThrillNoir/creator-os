import { humanAuditActor, identityAuditStatement, isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { expectedPartBytes, hashAndValidateR2Object, noStoreJson, safeFailureCode } from "@/lib/source-media";

type Context = Awaited<ReturnType<typeof requireCreatorContext>>;
type Session = { id: string; asset_id: string; storage_object_id: string | null; object_key: string | null; multipart_upload_id: string | null; expected_sha256: string; expected_bytes: number; expected_mime_type: string; chunk_bytes: number | null; status: string; finalization_state: string; expires_at: string };
type Part = { part_number: number; etag: string | null; byte_count: number; status: string };

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

async function quarantine(DB: D1Database, session: Session, creatorId: string, failure: string) {
  await DB.batch([
    DB.prepare("UPDATE asset_ingest_sessions SET status='failed',finalization_state='quarantined',failure_code=?,multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(failure, session.id, creatorId),
    DB.prepare("UPDATE asset_storage_objects SET ingest_status='failed',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND ingest_status<>'verified'").bind(failure, session.storage_object_id, creatorId),
  ]);
}

async function verifyAndPersist(DB: D1Database, bucket: R2Bucket, images: ImagesBinding, session: Session, creatorId: string, context: Context) {
  if (!session.object_key || !session.storage_object_id) throw new Error("session_storage_missing");
  if (session.expected_mime_type.startsWith("video/")) {
    await quarantine(DB, session, creatorId, "source_media_decoder_required");
    throw new Error("source_media_decoder_required");
  }
  await DB.prepare("UPDATE asset_ingest_sessions SET finalization_state='verifying',reconcile_attempts=reconcile_attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(session.id, creatorId).run();
  const verified = await hashAndValidateR2Object(bucket, session.object_key, images);
  if (verified.byteCount !== session.expected_bytes || verified.sha256 !== session.expected_sha256 || verified.detectedMime !== session.expected_mime_type) {
    await quarantine(DB, session, creatorId, "source_media_verification_failed");
    throw new Error("source_media_verification_failed");
  }
  await DB.batch([
    DB.prepare("UPDATE asset_ingest_sessions SET status='finalized',finalization_state='verified',completed_r2_version=?,completed_r2_etag=?,completion_observed_at=COALESCE(completion_observed_at,CURRENT_TIMESTAMP),multipart_upload_id=NULL,uploaded_bytes=?,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(verified.r2Version, verified.r2Etag, verified.byteCount, session.id, creatorId),
    DB.prepare("UPDATE asset_storage_objects SET ingest_status='verified',verified_mime_type=?,r2_version=?,r2_etag=?,uploaded_at=COALESCE(uploaded_at,CURRENT_TIMESTAMP),verified_at=CURRENT_TIMESTAMP,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND ingest_status<>'verified'").bind(verified.detectedMime, verified.r2Version, verified.r2Etag, session.storage_object_id, creatorId),
    DB.prepare("UPDATE creator_media_source_states SET migration_state='transferring',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND migration_state IN ('dropbox','planned','transferring')").bind(creatorId),
    DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'ingest_verified',?)").bind(crypto.randomUUID(), creatorId, session.asset_id, session.id, context.email, context.creator.role, JSON.stringify({ byteCount: verified.byteCount, mimeType: verified.detectedMime })),
    identityAuditStatement(DB, humanAuditActor(context), "source_media_ingest_verified", session.asset_id, { byteCount: verified.byteCount, mimeType: verified.detectedMime }),
  ]);
}

async function abortExpired(DB: D1Database, bucket: R2Bucket, session: Session, creatorId: string) {
  if (!session.object_key || !session.multipart_upload_id) return false;
  try {
    await bucket.resumeMultipartUpload(session.object_key, session.multipart_upload_id).abort();
    await DB.prepare("UPDATE asset_ingest_sessions SET status='expired',finalization_state='expired',failure_code='session_expired',multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete'").bind(session.id, creatorId).run();
    return true;
  } catch {
    await DB.prepare("UPDATE asset_ingest_sessions SET failure_code='expiry_abort_uncertain',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete'").bind(session.id, creatorId).run().catch(() => undefined);
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { sessionId } = await params;
  if (!validUuid(sessionId)) return noStoreJson({ ok: false, error: "invalid_session" }, 400);
  const context = await requireCreatorContext("mutate");
  const { DB, LIBRARY_MEDIA, IMAGES } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket; IMAGES?: ImagesBinding };
  if (!LIBRARY_MEDIA || !IMAGES) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const session = await DB.prepare(`SELECT id,asset_id,storage_object_id,object_key,multipart_upload_id,expected_sha256,expected_bytes,expected_mime_type,chunk_bytes,status,finalization_state,expires_at
    FROM asset_ingest_sessions WHERE id=? AND creator_id=?`).bind(sessionId, context.creator.creator_id).first<Session>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  if (session.status === "finalized" && session.finalization_state === "verified") return noStoreJson({ ok: true, sessionId: session.id, status: "finalized", replay: true });
  if (["quarantined", "failed", "expired", "aborted"].includes(session.finalization_state)) return noStoreJson({ ok: false, error: `session_${session.finalization_state}` }, 409);

  if (["completing", "completed_unreconciled", "verifying"].includes(session.finalization_state)) {
    try {
      const head = session.object_key ? await LIBRARY_MEDIA.head(session.object_key) : null;
      if (!head) return noStoreJson({ ok: false, error: "finalization_in_progress" }, 409);
      await DB.prepare("UPDATE asset_ingest_sessions SET finalization_state='completed_unreconciled',completed_r2_version=?,completed_r2_etag=?,completion_observed_at=COALESCE(completion_observed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(head.version, head.etag, session.id, context.creator.creator_id).run();
      await verifyAndPersist(DB, LIBRARY_MEDIA, IMAGES, session, context.creator.creator_id, context);
      return noStoreJson({ ok: true, sessionId: session.id, status: "finalized", reconciled: true });
    } catch (error) {
      return noStoreJson({ ok: false, error: safeFailureCode(error, "reconciliation_required") }, 409);
    }
  }

  if (!session.object_key || !session.multipart_upload_id || !session.chunk_bytes || Date.parse(session.expires_at) <= Date.now()) {
    const aborted = await abortExpired(DB, LIBRARY_MEDIA, session, context.creator.creator_id);
    return noStoreJson({ ok: false, error: aborted ? "session_expired" : "expiry_abort_uncertain" }, aborted ? 410 : 503);
  }
  const parts = (await DB.prepare("SELECT part_number,etag,byte_count,status FROM asset_ingest_parts WHERE session_id=? ORDER BY part_number").bind(session.id).all<Part>()).results;
  const partCount = Math.ceil(session.expected_bytes / session.chunk_bytes);
  if (parts.length !== partCount || parts.some((part, index) => part.status !== "uploaded" || !part.etag || part.part_number !== index + 1 || part.byte_count !== expectedPartBytes(session.expected_bytes, index + 1, session.chunk_bytes!))) return noStoreJson({ ok: false, error: "parts_incomplete" }, 409);

  const claimed = await DB.prepare("UPDATE asset_ingest_sessions SET finalization_state='completing',failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete' AND status IN ('created','uploading')").bind(session.id, context.creator.creator_id).run();
  if (!claimed.meta?.changes) return noStoreJson({ ok: false, error: "finalization_in_progress" }, 409);
  try {
    const completed = await LIBRARY_MEDIA.resumeMultipartUpload(session.object_key, session.multipart_upload_id).complete(parts.map((part) => ({ partNumber: part.part_number, etag: part.etag! })));
    await DB.prepare("UPDATE asset_ingest_sessions SET finalization_state='completed_unreconciled',completed_r2_version=?,completed_r2_etag=?,completion_observed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='completing'").bind(completed.version, completed.etag, session.id, context.creator.creator_id).run();
    await verifyAndPersist(DB, LIBRARY_MEDIA, IMAGES, session, context.creator.creator_id, context);
    return noStoreJson({ ok: true, sessionId: session.id, status: "finalized" });
  } catch (error) {
    const state = await DB.prepare("SELECT finalization_state FROM asset_ingest_sessions WHERE id=? AND creator_id=?").bind(session.id, context.creator.creator_id).first<{ finalization_state: string }>().catch(() => null);
    if (state?.finalization_state === "quarantined") return noStoreJson({ ok: false, error: "source_media_verification_failed" }, 422);
    const failure = safeFailureCode(error, "completed_unreconciled");
    if (/no_?such_?upload|upload_(?:not_found|missing)|missing_upload/.test(failure)) {
      let head: R2Object | null = null; let headRead = false;
      try { head = await LIBRARY_MEDIA.head(session.object_key); headRead = true; } catch { /* Preserve uncertain state when head cannot be proven. */ }
      if (headRead && !head) {
        await DB.batch([
          DB.prepare("UPDATE asset_ingest_sessions SET status='failed',finalization_state='failed',failure_code='multipart_upload_missing',multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='completing'").bind(session.id, context.creator.creator_id),
          DB.prepare("UPDATE asset_storage_objects SET ingest_status='failed',failure_code='multipart_upload_missing',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND ingest_status<>'verified'").bind(session.storage_object_id, context.creator.creator_id),
        ]);
        return noStoreJson({ ok: false, error: "multipart_upload_missing" }, 409);
      }
    }
    await DB.prepare("UPDATE asset_ingest_sessions SET failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state IN ('completing','completed_unreconciled','verifying')").bind(failure, session.id, context.creator.creator_id).run().catch(() => undefined);
    return noStoreJson({ ok: false, error: "completion_requires_reconciliation" }, 503);
  }
}
