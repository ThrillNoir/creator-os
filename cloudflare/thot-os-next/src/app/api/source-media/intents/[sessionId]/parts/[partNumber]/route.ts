import { isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { expectedPartBytes, noStoreJson, safeFailureCode } from "@/lib/source-media";

type Session = { id: string; asset_id: string; object_key: string | null; multipart_upload_id: string | null; expected_bytes: number; chunk_bytes: number | null; status: string; finalization_state: string; expires_at: string; ingest_kind: "legacy_direct" | "native_image" };

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string; partNumber: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { sessionId, partNumber: rawPartNumber } = await params;
  const partNumber = Number(rawPartNumber);
  if (!validUuid(sessionId) || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return noStoreJson({ ok: false, error: "invalid_part" }, 400);
  const context = await requireCreatorContext("mutate");
  const { DB, LIBRARY_MEDIA } = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const session = await DB.prepare(`SELECT id,asset_id,object_key,multipart_upload_id,expected_bytes,chunk_bytes,status,finalization_state,expires_at,ingest_kind
    FROM asset_ingest_sessions WHERE id=? AND creator_id=?`).bind(sessionId, context.creator.creator_id).first<Session>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  if (session.status === "finalized") return noStoreJson({ ok: false, error: "session_finalized" }, 409);
  if (session.finalization_state !== "incomplete") return noStoreJson({ ok: false, error: "session_finalizing" }, 409);
  if (!session.object_key || !session.multipart_upload_id || !session.chunk_bytes || Date.parse(session.expires_at) <= Date.now()) {
    if (!session.object_key || !session.multipart_upload_id) return noStoreJson({ ok: false, error: "session_upload_missing" }, 409);
    try {
      await LIBRARY_MEDIA.resumeMultipartUpload(session.object_key, session.multipart_upload_id).abort();
      await DB.prepare("UPDATE asset_ingest_sessions SET status='expired',finalization_state='expired',failure_code='session_expired',multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete'").bind(session.id, context.creator.creator_id).run();
      return noStoreJson({ ok: false, error: "session_expired" }, 410);
    } catch {
      await DB.prepare("UPDATE asset_ingest_sessions SET failure_code='expiry_abort_uncertain',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND finalization_state='incomplete'").bind(session.id, context.creator.creator_id).run().catch(() => undefined);
      return noStoreJson({ ok: false, error: "expiry_abort_uncertain" }, 503);
    }
  }
  const expectedBytes = expectedPartBytes(session.expected_bytes, partNumber, session.chunk_bytes);
  if (!expectedBytes) return noStoreJson({ ok: false, error: "invalid_part" }, 400);
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredLength) || declaredLength !== expectedBytes) return noStoreJson({ ok: false, error: "part_size_mismatch" }, 400);
  const existing = await DB.prepare("SELECT status FROM asset_ingest_parts WHERE session_id=? AND part_number=?").bind(session.id, partNumber).first<{ status: string }>();
  if (existing?.status === "uploaded") {
    if (session.ingest_kind === "native_image") return noStoreJson({ ok: true, partNumber, byteCount: expectedBytes, replay: true });
    return noStoreJson({ ok: false, error: "part_replayed" }, 409);
  }
  if (existing?.status === "uploading") return noStoreJson({ ok: false, error: "part_in_progress" }, 409);
  if (existing?.status === "failed") {
    const reclaimed = await DB.prepare("UPDATE asset_ingest_parts SET status='uploading',failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND part_number=? AND status='failed'").bind(session.id, partNumber).run();
    if (!reclaimed.meta?.changes) return noStoreJson({ ok: false, error: "part_in_progress" }, 409);
  } else {
    const claimed = await DB.prepare("INSERT OR IGNORE INTO asset_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES (?,?,?,?, 'uploading')").bind(session.id, context.creator.creator_id, partNumber, expectedBytes).run();
    if (!claimed.meta?.changes) return noStoreJson({ ok: false, error: "part_replayed" }, 409);
  }
  try {
    const content = await request.arrayBuffer();
    if (content.byteLength !== expectedBytes) throw new Error("part_size_mismatch");
    const multipart = LIBRARY_MEDIA.resumeMultipartUpload(session.object_key, session.multipart_upload_id);
    const uploaded = await multipart.uploadPart(partNumber, content);
    await DB.batch([
      DB.prepare("UPDATE asset_ingest_parts SET status='uploaded',etag=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND part_number=? AND status='uploading'").bind(uploaded.etag, session.id, partNumber),
      DB.prepare("UPDATE asset_ingest_sessions SET status='uploading',uploaded_bytes=(SELECT COALESCE(SUM(byte_count),0) FROM asset_ingest_parts WHERE session_id=? AND status='uploaded'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status IN ('created','uploading')").bind(session.id, session.id, context.creator.creator_id),
      DB.prepare("INSERT INTO creator_media_source_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'part_uploaded',?)").bind(crypto.randomUUID(), context.creator.creator_id, session.asset_id, session.id, context.email, context.creator.role, JSON.stringify({ partNumber, byteCount: expectedBytes })),
    ]);
    return noStoreJson({ ok: true, partNumber, byteCount: expectedBytes });
  } catch (error) {
    const failure = safeFailureCode(error, "part_upload_failed");
    await DB.prepare("UPDATE asset_ingest_parts SET status='failed',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND part_number=?").bind(failure, session.id, partNumber).run();
    return noStoreJson({ ok: false, error: failure }, 422);
  }
}
