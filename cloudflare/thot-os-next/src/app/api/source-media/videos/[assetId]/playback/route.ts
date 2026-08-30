import { humanAuditActor, identityAuditStatement, isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { noStoreJson } from "@/lib/source-media";
import { createStreamCopyRequest, streamPlaybackAvailable, streamSubmissionFailureCode, validStreamVideoId } from "@/lib/stream-playback";

type Playback = { asset_id: string; canonical_storage_object_id: string; state: string; playback_provider: string; playback_external_id: string | null; failure_code: string | null; object_key: string; ingest_status: string };
function validAssetId(value: string) { return /^[0-9a-f-]{16,64}$/i.test(value); }
function submissionDiagnostic(phase: "accepted" | "failed" | "uncertain", status: number, startedAt: number, state: string) {
  console.log(JSON.stringify({ event: "creatoros.video_playback_submission", route: "/api/source-media/videos/[assetId]/playback", phase, status, durationMs: Date.now() - startedAt, state }));
}

async function recordEvent(DB: D1Database, context: Awaited<ReturnType<typeof requireCreatorContext>>, assetId: string, eventType: "processing_queued" | "processing_failed" | "playback_ready", detail: Record<string, unknown>) {
  await DB.batch([
    DB.prepare("INSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), context.creator.creator_id, assetId, null, context.email, context.creator.role, eventType, JSON.stringify(detail)),
    identityAuditStatement(DB, humanAuditActor(context), `native_video_stream_${eventType}`, assetId, detail),
  ]);
}

export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const startedAt = Date.now();
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { assetId } = await params;
  if (!validAssetId(assetId)) return noStoreJson({ ok: false, error: "invalid_asset" }, 400);
  const context = await requireCreatorContext("mutate");
  const env = cloudflareEnv() as CloudflareEnv & { STREAM?: StreamBinding; R2_STREAM_PLAYBACK_ENABLED?: string };
  if (!streamPlaybackAvailable(env)) return noStoreJson({ ok: false, error: "stream_playback_unavailable" }, 503);
  const playback = await env.DB.prepare(`SELECT vp.asset_id,vp.canonical_storage_object_id,vp.state,vp.playback_provider,vp.playback_external_id,vp.failure_code,o.object_key,o.ingest_status
    FROM asset_video_playback_states vp JOIN asset_storage_objects o ON o.id=vp.canonical_storage_object_id AND o.creator_id=vp.creator_id
    WHERE vp.asset_id=? AND vp.creator_id=?`).bind(assetId, context.creator.creator_id).first<Playback>();
  if (!playback) return noStoreJson({ ok: false, error: "video_not_found" }, 404);
  if (playback.state === "playback_ready") return noStoreJson({ ok: true, state: "playback_ready", replay: true });
  if (playback.state === "processing_failed") return noStoreJson({ ok: false, error: "playback_preparation_failed" }, 409);
  if (playback.playback_external_id || playback.state === "processing" || playback.state === "processing_queued") return noStoreJson({ ok: false, error: "playback_already_submitted" }, 409);
  if (playback.state !== "canonical_verified" || playback.playback_provider !== "none" || playback.ingest_status !== "verified") return noStoreJson({ ok: false, error: "playback_not_eligible" }, 409);

  const claimed = await env.DB.prepare("UPDATE asset_video_playback_states SET state='processing_queued',playback_provider='stream',failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state='canonical_verified' AND playback_provider='none' AND playback_external_id IS NULL")
    .bind(assetId, context.creator.creator_id).run();
  if (!claimed.meta?.changes) return noStoreJson({ ok: false, error: "playback_already_submitted" }, 409);
  await recordEvent(env.DB, context, assetId, "processing_queued", { provider: "stream", operation: "manual_submission" });

  let requestForStream: Awaited<ReturnType<typeof createStreamCopyRequest>>;
  try {
    requestForStream = await createStreamCopyRequest(env, { creatorId: context.creator.creator_id, assetId, objectKey: playback.object_key });
  } catch {
    await env.DB.prepare("UPDATE asset_video_playback_states SET state='processing_failed',playback_provider='none',failure_code='stream_source_authorization_failed',updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state='processing_queued' AND playback_external_id IS NULL")
      .bind(assetId, context.creator.creator_id).run();
    await recordEvent(env.DB, context, assetId, "processing_failed", { provider: "stream", failureCode: "stream_source_authorization_failed", submission: "not_started" });
    submissionDiagnostic("failed", 503, startedAt, "processing_failed");
    return noStoreJson({ ok: false, error: "playback_preparation_failed" }, 503);
  }

  let video: StreamVideo;
  try {
    // Stream fetches the signed R2 URL itself; no canonical bytes are read by
    // this Worker and the URL is deliberately discarded after this call.
    video = await env.STREAM!.upload(requestForStream.sourceUrl, requestForStream.params);
  } catch (error) {
    const failureCode = streamSubmissionFailureCode(error);
    if (failureCode !== "stream_submission_uncertain") {
      await env.DB.prepare("UPDATE asset_video_playback_states SET state='processing_failed',playback_provider='none',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state='processing_queued' AND playback_external_id IS NULL")
        .bind(failureCode, assetId, context.creator.creator_id).run();
      await recordEvent(env.DB, context, assetId, "processing_failed", { provider: "stream", failureCode, submission: "not_accepted" });
      submissionDiagnostic("failed", 422, startedAt, "processing_failed");
      return noStoreJson({ ok: false, error: "playback_preparation_failed" }, 422);
    }
    await env.DB.prepare("UPDATE asset_video_playback_states SET failure_code='stream_submission_uncertain',updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state='processing_queued' AND playback_external_id IS NULL")
      .bind(assetId, context.creator.creator_id).run();
    await recordEvent(env.DB, context, assetId, "processing_failed", { provider: "stream", failureCode: "stream_submission_uncertain", submission: "unknown_requires_reconciliation" });
    submissionDiagnostic("uncertain", 503, startedAt, "processing_queued");
    return noStoreJson({ ok: false, error: "playback_submission_needs_review" }, 503);
  }
  if (!validStreamVideoId(video.id)) {
    await env.DB.prepare("UPDATE asset_video_playback_states SET failure_code='stream_submission_uncertain',updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state='processing_queued' AND playback_external_id IS NULL")
      .bind(assetId, context.creator.creator_id).run();
    submissionDiagnostic("uncertain", 503, startedAt, "processing_queued");
    return noStoreJson({ ok: false, error: "playback_submission_needs_review" }, 503);
  }
  const state = video.readyToStream ? "playback_ready" : "processing";
  await env.DB.prepare("UPDATE asset_video_playback_states SET state=?,playback_provider='stream',playback_external_id=?,playback_manifest_path=NULL,failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND state='processing_queued' AND playback_external_id IS NULL")
    .bind(state, video.id, assetId, context.creator.creator_id).run();
  await recordEvent(env.DB, context, assetId, state === "playback_ready" ? "playback_ready" : "processing_queued", { provider: "stream", submission: "accepted", state });
  submissionDiagnostic("accepted", 200, startedAt, state);
  return noStoreJson({ ok: true, state });
}
