import { requireCreatorContext } from "@/lib/identity";
import { getPreviewProgress } from "@/lib/library";

export async function GET() {
  const context = await requireCreatorContext();
  const progress = await getPreviewProgress(context.creator.creator_id);
  return Response.json(progress, { headers: { "cache-control": "private, no-store" } });
}
