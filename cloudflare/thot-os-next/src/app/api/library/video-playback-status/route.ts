import { humanAuditActor, identityAuditStatement } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { getDeploymentMetadata } from "@/lib/deployment-metadata";
import { requireCreatorContext } from "@/lib/identity";
import { getVideoPlaybackProgress } from "@/lib/library";
import { noStoreJson } from "@/lib/source-media";
import { streamPlaybackAvailable, streamProcessingFailureCode, validStreamVideoId } from "@/lib/stream-playback";

type PendingPlayback = { asset_id: string; playback_external_id: string };
const MAX_PROVIDER_STATUS_READS = 4;

async function recordProviderTransition(DB: D1Database, context: Awaited<ReturnType<typeof requireCreatorContext>>, assetId: string, state: "playback_ready" | "processing_failed", failureCode: string | null) {
  const detail = { provider: "stream", state, failureCode };
  await DB.batch([
    DB.prepare("INSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), context.creator.creator_id, assetId, null, context.email, context.creator.role, state, JSON.stringify(detail)),
    identityAuditStatement(DB, humanAuditActor(context), `native_video_stream_${state}`, assetId, detail),
  ]);
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const context = await requireCreatorContext("mutate");
    const env = cloudflareEnv() as CloudflareEnv & { STREAM?: StreamBinding; R2_STREAM_PLAYBACK_ENABLED?: string };
    if (!streamPlaybackAvailable(env)) return noStoreJson({ ...(await getVideoPlaybackProgress(context.creator.creator_id)), changed: false, configured: false });
    const pending = (await env.DB.prepare("SELECT asset_id,playback_external_id FROM asset_video_playback_states WHERE creator_id=? AND state='processing' AND playback_provider='stream' AND playback_external_id IS NOT NULL ORDER BY updated_at ASC LIMIT ?")
      .bind(context.creator.creator_id, MAX_PROVIDER_STATUS_READS).all<PendingPlayback>()).results;
    let changed = false;
    for (const row of pending) {
      if (!validStreamVideoId(row.playback_external_id)) continue;
      try {
        const details = await env.STREAM!.video(row.playback_external_id).details();
        const failureCode = streamProcessingFailureCode(details);
        const nextState = details.readyToStream ? "playback_ready" : failureCode ? "processing_failed" : null;
        if (!nextState) continue;
        const updated = await env.DB.prepare("UPDATE asset_video_playback_states SET state=?,failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state='processing' AND playback_provider='stream' AND playback_external_id=?")
          .bind(nextState, failureCode, row.asset_id, context.creator.creator_id, row.playback_external_id).run();
        if (updated.meta?.changes) {
          changed = true;
          await recordProviderTransition(env.DB, context, row.asset_id, nextState, failureCode);
        }
      } catch {
        // Provider reads can be retried by the bounded client poller. Do not
        // mutate state or infer an outcome from a transport failure.
      }
    }
    const progress = await getVideoPlaybackProgress(context.creator.creator_id);
    console.log(JSON.stringify({ event: "creatoros.video_playback_status", route: "/api/library/video-playback-status", phase: "complete", status: 200, durationMs: Date.now() - startedAt, deployment: getDeploymentMetadata(), total: progress.total, ready: progress.ready, queued: progress.queued, processing: progress.processing, failed: progress.failed, changed }));
    return noStoreJson({ ...progress, changed, configured: true }, 200);
  } catch {
    console.log(JSON.stringify({ event: "creatoros.video_playback_status", route: "/api/library/video-playback-status", phase: "failed", status: 500, durationMs: Date.now() - startedAt, deployment: getDeploymentMetadata() }));
    throw new Error("video_playback_status_unavailable");
  }
}
