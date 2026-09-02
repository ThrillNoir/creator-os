import { getGrowthInsights } from "@/lib/growth-insights";
import { getCreatorContext } from "@/lib/identity";
import { cloudflareEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const creatorId = params.get("creator")?.trim() || "";
  const context = await getCreatorContext(creatorId);
  if (!context) return Response.json({ ok: false, error: "creator_not_found" }, { status: 404 });
  const accountId = params.get("accountId")?.trim() || undefined;
  if (accountId) {
    const account = await cloudflareEnv().DB.prepare("SELECT id FROM operational_accounts WHERE id=? AND creator_id=? AND platform='instagram' AND is_active=1").bind(accountId, context.creator.creator_id).first();
    if (!account) return Response.json({ ok: false, error: "instagram_account_not_found" }, { status: 404 });
  }
  return Response.json({ ok: true, creatorId: context.creator.creator_id, accountId: accountId ?? null, insights: await getGrowthInsights(context.creator.creator_id, accountId) }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
