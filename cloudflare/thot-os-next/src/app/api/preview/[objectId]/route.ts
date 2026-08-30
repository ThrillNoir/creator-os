import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

export async function GET(_: Request, { params }: { params: Promise<{ objectId: string }> }) {
  const context = await requireCreatorContext();
  const { objectId } = await params;
  if (!/^[a-f0-9]{64}$/.test(objectId)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const creatorId = context.creator.creator_id;
  const revisionedPrefix = `creators/${creatorId}/assets/${objectId}/previews/`;
  const { DB, PREVIEWS } = cloudflareEnv();
  const asset = await DB.prepare(`SELECT a.id,a.preview_r2_key FROM assets a
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    WHERE a.creator_id=? AND substr(a.preview_r2_key,1,?)=? AND substr(a.preview_r2_key,-4)='.jpg' AND a.source_available=1`)
    .bind(creatorId, revisionedPrefix.length, revisionedPrefix).first<{ id: string; preview_r2_key: string }>();
  if (!asset) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const object = await PREVIEWS.get(asset.preview_r2_key);
  if (!object) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400", etag: object.etag, "x-content-type-options": "nosniff" } });
}
