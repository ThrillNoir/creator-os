import { cloudflareEnv } from "@/lib/cloudflare";
import { getDeploymentMetadata } from "@/lib/deployment-metadata";
import { requireCreatorContext } from "@/lib/identity";

export async function GET() {
  const context = await requireCreatorContext();
  const env = cloudflareEnv() as CloudflareEnv & { MEDIA?: R2Bucket; PREVIEWS?: R2Bucket; INSTAGRAM_SCHEDULER?: Fetcher; REDDIT_SCHEDULER?: Fetcher; TELEGRAM_BRIDGE?: Fetcher; VAULT_BRIDGE?: Fetcher };
  const [counts, migration] = await Promise.all([env.DB.prepare(`
    SELECT COUNT(*) AS assets,SUM(CASE WHEN preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS previews
    FROM assets WHERE creator_id=? AND source_available=1
  `).bind(context.creator.creator_id).first<{ assets: number; previews: number }>(), env.DB.prepare("SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1").first<{ name: string }>()]);
  const deployment = getDeploymentMetadata();
  return Response.json({ ok: true, service: deployment.component, environment: deployment.environment, runtime: "nextjs-opennext", deployment, creatorId: context.creator.creator_id, database: { connected: true, migration: migration?.name ?? "none", assets: counts?.assets ?? 0, previews: counts?.previews ?? 0 }, bindings: { d1: Boolean(env.DB), media: Boolean(env.MEDIA), previews: Boolean(env.PREVIEWS), instagramScheduler: Boolean(env.INSTAGRAM_SCHEDULER), redditScheduler: Boolean(env.REDDIT_SCHEDULER), telegramBridge: Boolean(env.TELEGRAM_BRIDGE), vaultBridge: Boolean(env.VAULT_BRIDGE) }, timestamp: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
