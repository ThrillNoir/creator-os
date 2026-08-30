import { cloudflareEnv } from "@/lib/cloudflare";
import { getDeploymentMetadata } from "@/lib/deployment-metadata";
import { requireCreatorContext } from "@/lib/identity";

export async function GET() {
  const context = await requireCreatorContext();
  const env = cloudflareEnv() as CloudflareEnv & { MEDIA?: R2Bucket; PREVIEWS?: R2Bucket; LIBRARY_MEDIA?: R2Bucket; STREAM?: StreamBinding; R2_STREAM_PLAYBACK_ENABLED?: string; INSTAGRAM_SCHEDULER?: Fetcher; REDDIT_SCHEDULER?: Fetcher; TELEGRAM_BRIDGE?: Fetcher; VAULT_BRIDGE?: Fetcher };
  const [counts, migration, videoCapability] = await Promise.all([env.DB.prepare(`
    SELECT COUNT(*) AS assets,SUM(CASE WHEN preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS previews
    FROM assets WHERE creator_id=? AND source_available=1
  `).bind(context.creator.creator_id).first<{ assets: number; previews: number }>(), env.DB.prepare("SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1").first<{ name: string }>(), env.DB.prepare(`SELECT
    SUM(CASE WHEN state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed') THEN 1 ELSE 0 END) AS canonical_ready,
    SUM(CASE WHEN state='playback_ready' THEN 1 ELSE 0 END) AS playback_ready
    FROM asset_video_playback_states WHERE creator_id=?`).bind(context.creator.creator_id)
    .first<{ canonical_ready: number | null; playback_ready: number | null }>()]);
  const deployment = getDeploymentMetadata();
  const canonicalVideoReady = (videoCapability?.canonical_ready ?? 0) > 0;
  const playbackVideoReady = (videoCapability?.playback_ready ?? 0) > 0;
  const streamConfigured = Boolean(env.STREAM && env.R2_STREAM_PLAYBACK_ENABLED === "1");
  const vaultCapability = { compatible: Boolean(env.VAULT_BRIDGE && env.LIBRARY_MEDIA), reason: env.VAULT_BRIDGE && env.LIBRARY_MEDIA ? "bindings_ready" : "vault_bindings_missing" };
  return Response.json({ ok: true, service: deployment.component, environment: deployment.environment, runtime: "nextjs-opennext", deployment, creatorId: context.creator.creator_id, sourceMediaCapability: "r2-source-v2", videoSourceCapability: "r2-video-canonical-v1", consumers: { vault: vaultCapability, instagram: { compatible: Boolean(env.INSTAGRAM_SCHEDULER && env.LIBRARY_MEDIA), reason: env.INSTAGRAM_SCHEDULER && env.LIBRARY_MEDIA ? "r2_presigned_source_ready" : "instagram_bindings_missing" }, reddit: { compatible: false, reason: "r2_source_not_deployed" }, video: { canonicalReady: canonicalVideoReady, playbackReady: playbackVideoReady, provider: streamConfigured ? "stream" : "not_configured", consumersReady: playbackVideoReady, reason: playbackVideoReady ? "stream_playback_ready" : streamConfigured ? canonicalVideoReady ? "stream_playback_not_prepared" : "no_eligible_canonical_video" : canonicalVideoReady ? "playback_provider_not_configured" : "no_eligible_canonical_video" } }, database: { connected: true, migration: migration?.name ?? "none", assets: counts?.assets ?? 0, previews: counts?.previews ?? 0 }, bindings: { d1: Boolean(env.DB), media: Boolean(env.MEDIA), previews: Boolean(env.PREVIEWS), libraryMedia: Boolean(env.LIBRARY_MEDIA), stream: Boolean(env.STREAM), instagramScheduler: Boolean(env.INSTAGRAM_SCHEDULER), redditScheduler: Boolean(env.REDDIT_SCHEDULER), telegramBridge: Boolean(env.TELEGRAM_BRIDGE), vaultBridge: Boolean(env.VAULT_BRIDGE) }, timestamp: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
