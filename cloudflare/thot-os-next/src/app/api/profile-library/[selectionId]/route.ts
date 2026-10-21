import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

const ID = /^[a-zA-Z0-9_-]{1,160}$/;

export async function GET(request: Request, { params }: { params: Promise<{ selectionId: string }> }) {
  const { selectionId } = await params;
  if (!ID.test(selectionId)) return new Response("Not found", { status: 404 });
  const context = await requireCreatorContext("view");
  const { DB, MEDIA } = cloudflareEnv();
  const display = new URL(request.url).searchParams.get("variant") === "display";
  const row = await DB.prepare(`SELECT ${display ? "d.display_object_key AS object_key,d.display_sha256 AS sha256" : "d.preview_object_key AS object_key,d.preview_sha256 AS sha256"}
    FROM creator_profile_library_photo_selections s
    JOIN creator_profile_library_photo_derivatives d ON d.id=s.derivative_id AND d.creator_id=s.creator_id
    WHERE s.id=? AND s.creator_id=?`).bind(selectionId, context.creator.creator_id)
    .first<{ object_key: string; sha256: string }>();
  if (!row) return new Response("Not found", { status: 404 });
  const object = await MEDIA.get(row.object_key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: {
    "content-type": "image/webp", "cache-control": "private, no-store", etag: `"${row.sha256}"`,
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}
