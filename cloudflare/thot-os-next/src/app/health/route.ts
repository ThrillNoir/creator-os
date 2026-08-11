import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

export async function GET() {
  const context = await requireCreatorContext();
  const counts = await cloudflareEnv().DB.prepare(`
    SELECT COUNT(*) AS assets,SUM(CASE WHEN preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS previews
    FROM assets WHERE creator_id=? AND source_available=1
  `).bind(context.creator.creator_id).first<{ assets: number; previews: number }>();
  return Response.json({ ok: true, service: "thot-os-staging", runtime: "nextjs-opennext", creatorId: context.creator.creator_id, database: counts, timestamp: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
