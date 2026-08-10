import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";

export async function GET(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const context = await requireCreatorContext();
  const { attachmentId } = await params;
  if (!/^instagram-attachment-[a-f0-9]{40}$/.test(attachmentId)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const { DB, PREVIEWS } = cloudflareEnv();
  const attachment = await DB.prepare(`SELECT a.object_key,a.mime_type FROM message_attachments a
    JOIN messages m ON m.id=a.message_id AND m.creator_id=a.creator_id
    JOIN message_threads t ON t.id=m.thread_id AND t.creator_id=m.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.status='ready' AND a.object_key IS NOT NULL`)
    .bind(attachmentId, context.creator.creator_id).first<{ object_key: string; mime_type: string | null }>();
  if (!attachment) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const rangeHeader = request.headers.get("range");
  const object = await PREVIEWS.get(attachment.object_key, rangeHeader ? { range: request.headers } : undefined);
  if (!object) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "content-type": object.httpMetadata?.contentType ?? attachment.mime_type ?? "application/octet-stream",
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
  });
  let status = 200;
  if (object.range && "offset" in object.range && typeof object.range.offset === "number" && "length" in object.range && typeof object.range.length === "number") {
    status = 206;
    headers.set("content-length", String(object.range.length));
    headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(object.body, { status, headers });
}
