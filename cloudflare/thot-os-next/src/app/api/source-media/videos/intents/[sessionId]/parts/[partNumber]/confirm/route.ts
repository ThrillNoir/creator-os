import { humanAuditActor, isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { expireVideoIngest, type VideoIngestSession } from "@/lib/native-video-lifecycle";
import { expectedPartBytes, noStoreJson } from "@/lib/source-media";
import { canonicalR2MultipartPartEtag } from "@/lib/r2-multipart-etag";

type Session = VideoIngestSession & { expected_bytes: number; chunk_bytes: number; status: string; expires_at: string };
function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string; partNumber: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { sessionId, partNumber: rawPartNumber } = await params; const partNumber = Number(rawPartNumber);
  const input = await request.json().catch(() => null) as { etag?: unknown } | null;
  const etag = canonicalR2MultipartPartEtag(input?.etag);
  if (!validUuid(sessionId) || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000 || !etag) return noStoreJson({ ok: false, error: "invalid_part_confirmation" }, 400);
  const context = await requireCreatorContext("mutate");
  const env = cloudflareEnv() as CloudflareEnv & { LIBRARY_MEDIA?: R2Bucket };
  if (!env.LIBRARY_MEDIA) return noStoreJson({ ok: false, error: "source_media_unavailable" }, 503);
  const session = await env.DB.prepare("SELECT id,asset_id,storage_object_id,object_key,multipart_upload_id,finalization_state,expected_bytes,chunk_bytes,status,expires_at FROM asset_video_ingest_sessions WHERE id=? AND creator_id=?")
    .bind(sessionId, context.creator.creator_id).first<Session>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  if (session.finalization_state !== "incomplete") return noStoreJson({ ok: false, error: "session_finalizing" }, 409);
  if (!session.multipart_upload_id || Date.parse(session.expires_at) <= Date.now()) {
    const result = await expireVideoIngest(env.DB, env.LIBRARY_MEDIA, session, context.creator.creator_id, { audit: humanAuditActor(context), email: context.email, role: context.creator.role });
    return noStoreJson({ ok: false, error: result.expired ? "session_expired" : "expiry_abort_uncertain" }, result.expired ? 410 : 503);
  }
  const byteCount = expectedPartBytes(session.expected_bytes, partNumber, session.chunk_bytes);
  if (!byteCount) return noStoreJson({ ok: false, error: "invalid_part_confirmation" }, 400);
  const stored = await env.DB.prepare("SELECT status,byte_count FROM asset_video_ingest_parts WHERE session_id=? AND creator_id=? AND part_number=?")
    .bind(session.id, context.creator.creator_id, partNumber).first<{ status: string; byte_count: number }>();
  if (stored?.status === "uploaded") return noStoreJson({ ok: true, partNumber, byteCount, replay: true });
  if (!stored || stored.status !== "uploading" || stored.byte_count !== byteCount) return noStoreJson({ ok: false, error: "part_not_authorized" }, 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE asset_video_ingest_parts SET status='uploaded',etag=?,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND creator_id=? AND part_number=? AND status='uploading'").bind(etag, session.id, context.creator.creator_id, partNumber),
    env.DB.prepare("UPDATE asset_video_ingest_sessions SET status='uploading',uploaded_bytes=(SELECT COALESCE(SUM(byte_count),0) FROM asset_video_ingest_parts WHERE session_id=? AND status='uploaded'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status IN ('created','uploading')").bind(session.id, session.id, context.creator.creator_id),
    env.DB.prepare("INSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?, 'part_uploaded',?)").bind(crypto.randomUUID(), context.creator.creator_id, session.asset_id, session.id, context.email, context.creator.role, JSON.stringify({ partNumber, byteCount })),
  ]);
  return noStoreJson({ ok: true, partNumber, byteCount });
}
