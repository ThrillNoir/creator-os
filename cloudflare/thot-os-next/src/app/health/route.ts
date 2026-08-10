import { requireAccessIdentity } from "@/lib/access";
import { cloudflareEnv } from "@/lib/cloudflare";

export async function GET() {
  await requireAccessIdentity();
  const counts = await cloudflareEnv().DB.prepare(`
    SELECT COUNT(*) AS assets,SUM(CASE WHEN preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS previews
    FROM assets WHERE creator_id='adelaide' AND source_available=1
  `).first<{ assets: number; previews: number }>();
  return Response.json({ ok: true, service: "thot-os-staging", runtime: "nextjs-opennext", database: counts, timestamp: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
