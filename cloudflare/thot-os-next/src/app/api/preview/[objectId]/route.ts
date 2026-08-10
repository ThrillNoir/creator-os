import { requireAccessIdentity } from "@/lib/access";
import { cloudflareEnv } from "@/lib/cloudflare";

export async function GET(_: Request, { params }: { params: Promise<{ objectId: string }> }) {
  await requireAccessIdentity();
  const { objectId } = await params;
  if (!/^[a-f0-9]{64}$/.test(objectId)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const key = `creators/adelaide/assets/${objectId}/preview.jpg`;
  const { DB, PREVIEWS } = cloudflareEnv();
  const asset = await DB.prepare("SELECT id FROM assets WHERE creator_id='adelaide' AND preview_r2_key=? AND source_available=1").bind(key).first<{ id: string }>();
  if (!asset) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const object = await PREVIEWS.get(key);
  if (!object) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400", etag: object.etag, "x-content-type-options": "nosniff" } });
}
