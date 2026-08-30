import { isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { noStoreJson } from "@/lib/source-media";

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

/** Lets the owner release an authorization whose R2 PUT failed or expired.
 * The only accepted outcome is a coarse failure code; browser error text and
 * presigned URL details are intentionally never persisted. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string; partNumber: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { sessionId, partNumber: rawPartNumber } = await params; const partNumber = Number(rawPartNumber);
  if (!validUuid(sessionId) || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return noStoreJson({ ok: false, error: "invalid_part" }, 400);
  const context = await requireCreatorContext("mutate"); const { DB } = cloudflareEnv();
  const session = await DB.prepare("SELECT id FROM asset_video_ingest_sessions WHERE id=? AND creator_id=? AND finalization_state='incomplete'").bind(sessionId, context.creator.creator_id).first<{ id: string }>();
  if (!session) return noStoreJson({ ok: false, error: "session_not_found" }, 404);
  await DB.prepare("UPDATE asset_video_ingest_parts SET status='failed',failure_code='direct_part_upload_failed',updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND creator_id=? AND part_number=? AND status='uploading'")
    .bind(session.id, context.creator.creator_id, partNumber).run();
  return noStoreJson({ ok: true });
}
