import { getGrowthInsights } from "@/lib/growth-insights";
import { getCreatorContext } from "@/lib/identity";

export async function GET(request: Request) {
  const creatorId = new URL(request.url).searchParams.get("creator")?.trim() || "";
  const context = await getCreatorContext(creatorId);
  if (!context) return Response.json({ ok: false, error: "creator_not_found" }, { status: 404 });
  return Response.json({ ok: true, creatorId: context.creator.creator_id, insights: await getGrowthInsights(context.creator.creator_id) }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
