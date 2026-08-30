import { requireCreatorContext } from "@/lib/identity";
import { getPreviewProgress } from "@/lib/library";

export async function GET(request: Request) {
  const context = await requireCreatorContext();
  const source = new URL(request.url).searchParams.get("source");
  const progress = await getPreviewProgress(context.creator.creator_id, source === "legacy" || source === "all" ? source : "native");
  return Response.json(progress, { headers: { "cache-control": "private, no-store" } });
}
