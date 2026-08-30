import { humanAuditActor, isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { expireVideoIngest, type VideoIngestSession } from "@/lib/native-video-lifecycle";
import { presignVideoPartUpload } from "@/lib/r2-direct-video-upload";
import { expectedPartBytes, noStoreJson } from "@/lib/source-media";

type Session = VideoIngestSession & { expected_bytes: number; expected_mime_type: string; chunk_bytes: number; status: string; expires_at: string };
function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string; partNumber: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { sessionId, partNumber: rawPartNumber } = await params; const partNumber = Number(rawPartNumber);
  if (!validUuid(sessionId) || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return noStoreJson({ ok: false, error: "invalid_part" }, 400);
  const context = await requireCreatorContext("mutate");
  const env = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!env.LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const session = await env.DB.prepare("SELECT id,asset_id,storage_object_id,object_key,multipart_upload_id,finalization_state,expected_bytes,expected_mime_type,chunk_bytes,status,expires_at FROM asset_video_ingest_sessions WHERE id=? AND creator_id=?")
    .bind(sessionId, context.creator.creator_id).first<Session>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  if (session.status === "finalized") return noStoreJson({ ok: false, error: "session_finalized" }, 409);
  if (session.finalization_state !== "incomplete") return noStoreJson({ ok: false, error: "session_finalizing" }, 409);
  if (!session.multipart_upload_id || Date.parse(session.expires_at) <= Date.now()) {
    const result = await expireVideoIngest(env.DB, env.LIBRARY_MEDIA, session, context.creator.creator_id, { audit: humanAuditActor(context), email: context.email, role: context.creator.role });
    return noStoreJson({ ok: false, error: result.expired ? "session_expired" : "expiry_abort_uncertain" }, result.expired ? 410 : 503);
  }
  const byteCount = expectedPartBytes(session.expected_bytes, partNumber, session.chunk_bytes);
  if (!byteCount) return noStoreJson({ ok: false, error: "invalid_part" }, 400);
  const existing = await env.DB.prepare("SELECT status,updated_at FROM asset_video_ingest_parts WHERE session_id=? AND part_number=?").bind(session.id, partNumber).first<{ status: string; updated_at: string }>();
  if (existing?.status === "uploaded") return noStoreJson({ ok: true, partNumber, byteCount, replay: true });
  if (existing?.status === "uploading") {
    const reclaimed = await env.DB.prepare("UPDATE asset_video_ingest_parts SET updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND part_number=? AND status='uploading' AND updated_at<=datetime('now','-6 minutes')")
      .bind(session.id, partNumber).run();
    if (!reclaimed.meta?.changes) return noStoreJson({ ok: false, error: "part_in_progress" }, 409);
  } else if (existing?.status === "failed") {
    const reclaimed = await env.DB.prepare("UPDATE asset_video_ingest_parts SET status='uploading',failure_code=NULL,etag=NULL,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND part_number=? AND status='failed'")
      .bind(session.id, partNumber).run();
    if (!reclaimed.meta?.changes) return noStoreJson({ ok: false, error: "part_in_progress" }, 409);
  } else {
    const claimed = await env.DB.prepare("INSERT OR IGNORE INTO asset_video_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES (?,?,?,?, 'uploading')")
      .bind(session.id, context.creator.creator_id, partNumber, byteCount).run();
    if (!claimed.meta?.changes) return noStoreJson({ ok: false, error: "part_in_progress" }, 409);
  }
  try {
    const signed = await presignVideoPartUpload(env, { objectKey: session.object_key, multipartUploadId: session.multipart_upload_id, partNumber, mimeType: session.expected_mime_type });
    return noStoreJson({ ok: true, partNumber, byteCount, ...signed });
  } catch {
    await env.DB.prepare("UPDATE asset_video_ingest_parts SET status='failed',failure_code='direct_part_authorization_failed',updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND part_number=? AND status='uploading'").bind(session.id, partNumber).run().catch(() => undefined);
    return noStoreJson({ ok: false, error: "direct_video_upload_unavailable" }, 503);
  }
}
