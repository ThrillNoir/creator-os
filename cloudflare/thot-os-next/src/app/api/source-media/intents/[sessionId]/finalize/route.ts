import { humanAuditActor, identityAuditStatement, isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { expectedPartBytes, hashAndDetectR2Object, noStoreJson, safeFailureCode } from "@/lib/source-media";

type Session = { id: string; asset_id: string; storage_object_id: string | null; object_key: string | null; multipart_upload_id: string | null; expected_sha256: string; expected_bytes: number; expected_mime_type: string; chunk_bytes: number | null; status: string; expires_at: string };
type Part = { part_number: number; etag: string | null; byte_count: number; status: string };

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

async function fail(DB: D1Database, session: Session, creatorId: string, actor: { email: string; creator: { role: string } }, failure: string) {
  await DB.batch([
    DB.prepare("UPDATE asset_ingest_sessions SET status='failed',failure_code=?,multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status<>'finalized'").bind(failure, session.id, creatorId),
    DB.prepare("UPDATE asset_storage_objects SET ingest_status='failed',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND ingest_status<>'verified'").bind(failure, session.storage_object_id, creatorId),
    DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'ingest_failed',?)").bind(crypto.randomUUID(), creatorId, session.asset_id, session.id, actor.email, actor.creator.role, JSON.stringify({ reason: failure })),
  ]);
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { sessionId } = await params;
  if (!validUuid(sessionId)) return noStoreJson({ ok: false, error: "invalid_session" }, 400);
  const context = await requireCreatorContext("mutate");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const session = await DB.prepare(`SELECT id,asset_id,storage_object_id,object_key,multipart_upload_id,expected_sha256,expected_bytes,expected_mime_type,chunk_bytes,status,expires_at
    FROM asset_ingest_sessions WHERE id=? AND creator_id=?`).bind(sessionId, context.creator.creator_id).first<Session>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  if (session.status === "finalized") return noStoreJson({ ok: true, sessionId: session.id, status: "finalized", replay: true });
  if (!session.object_key || !session.multipart_upload_id || !session.chunk_bytes || Date.parse(session.expires_at) <= Date.now()) {
    await fail(DB, session, context.creator.creator_id, context, "session_expired");
    return noStoreJson({ ok: false, error: "session_expired" }, 410);
  }
  const chunkBytes = session.chunk_bytes;
  const parts = (await DB.prepare("SELECT part_number,etag,byte_count,status FROM asset_ingest_parts WHERE session_id=? ORDER BY part_number").bind(session.id).all<Part>()).results;
  const partCount = Math.ceil(session.expected_bytes / chunkBytes);
  if (parts.length !== partCount || parts.some((part, index) => part.status !== "uploaded" || !part.etag || part.part_number !== index + 1 || part.byte_count !== expectedPartBytes(session.expected_bytes, index + 1, chunkBytes))) {
    return noStoreJson({ ok: false, error: "parts_incomplete" }, 409);
  }
  try {
    const multipart = LIBRARY_MEDIA.resumeMultipartUpload(session.object_key, session.multipart_upload_id);
    await multipart.complete(parts.map((part) => ({ partNumber: part.part_number, etag: part.etag! })));
    const verified = await hashAndDetectR2Object(LIBRARY_MEDIA, session.object_key);
    if (verified.byteCount !== session.expected_bytes || verified.sha256 !== session.expected_sha256 || verified.detectedMime !== session.expected_mime_type) throw new Error("source_media_verification_failed");
    await DB.batch([
      DB.prepare("UPDATE asset_ingest_sessions SET status='finalized',multipart_upload_id=NULL,uploaded_bytes=?,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status IN ('created','uploading')").bind(verified.byteCount, session.id, context.creator.creator_id),
      DB.prepare("UPDATE asset_storage_objects SET ingest_status='verified',uploaded_at=COALESCE(uploaded_at,CURRENT_TIMESTAMP),verified_at=CURRENT_TIMESTAMP,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(session.storage_object_id, context.creator.creator_id),
      DB.prepare("UPDATE creator_media_source_states SET migration_state='transferring',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND migration_state IN ('dropbox','planned','transferring')").bind(context.creator.creator_id),
      DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'ingest_verified',?)").bind(crypto.randomUUID(), context.creator.creator_id, session.asset_id, session.id, context.email, context.creator.role, JSON.stringify({ byteCount: verified.byteCount, mimeType: verified.detectedMime })),
      identityAuditStatement(DB, humanAuditActor(context), "source_media_ingest_verified", session.asset_id, { byteCount: verified.byteCount, mimeType: verified.detectedMime }),
    ]);
    return noStoreJson({ ok: true, sessionId: session.id, status: "finalized" });
  } catch (error) {
    const failure = safeFailureCode(error, "finalization_failed");
    // Completion can be uncertain after the request crosses the Worker/R2
    // boundary. Retain the object for a later authenticated status check rather
    // than deleting an object that may have completed successfully.
    await fail(DB, session, context.creator.creator_id, context, failure);
    return noStoreJson({ ok: false, error: failure }, 422);
  }
}
