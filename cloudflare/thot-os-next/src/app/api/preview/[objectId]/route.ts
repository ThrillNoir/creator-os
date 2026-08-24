import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

export async function GET(_: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const context = await requireCreatorContext();
  const { objectId } = await params;
  if (!/^[a-f0-9]{64}$/.test(objectId)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const creatorId = context.creator.creator_id;
  const legacyKey = `creators/${creatorId}/assets/${objectId}/preview.jpg`;
  const revisionedPrefix = `creators/${creatorId}/assets/${objectId}/previews/`;
  const { DB, PREVIEWS } = cloudflareEnv();
  const asset = await DB.prepare("SELECT id,preview_r2_key FROM assets WHERE creator_id=? AND (preview_r2_key=? OR (substr(preview_r2_key,1,?)=? AND substr(preview_r2_key,-4)='.jpg')) AND source_available=1").bind(creatorId, legacyKey, revisionedPrefix.length, revisionedPrefix).first<{ id: string; preview_r2_key: string }>();
  if (!asset) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const object = await PREVIEWS.get(asset.preview_r2_key);
  if (!object) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400", etag: object.etag, "x-content-type-options": "nosniff" } });
}
