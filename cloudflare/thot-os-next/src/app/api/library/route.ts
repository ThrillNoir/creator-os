import { requireAccessIdentity } from "@/lib/access";
import { getLibraryAssets } from "@/lib/library";

export async function GET(request: Request) {
  await requireAccessIdentity();
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creator")?.trim() || "";
  if (creatorId !== "adelaide") return Response.json({ ok: false, error: "creator_not_found" }, { status: 404 });
  return Response.json({ ok: true, creatorId, assets: await getLibraryAssets() }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
