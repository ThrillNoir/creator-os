import { getLibraryAssets } from "@/lib/library";
import { getCreatorContext } from "@/lib/identity";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creator")?.trim() || "";
  const context = await getCreatorContext(creatorId);
  if (!context) return Response.json({ ok: false, error: "creator_not_found" }, { status: 404 });
  return Response.json({ ok: true, creatorId, assets: await getLibraryAssets(context.creator.creator_id) }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
