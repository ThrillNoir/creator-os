import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { isSameOriginRequest } from "@/lib/audit-identity";

const ATTACHMENT_ID = /^[a-zA-Z0-9_-]{1,160}$/;

export async function GET(_: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const context = await requireCreatorContext();
  const { attachmentId } = await params;
  if (!ATTACHMENT_ID.test(attachmentId)) return new Response("Not found", { status: 404 });
  const { DB, MEDIA } = cloudflareEnv();
  const item = await DB.prepare(`SELECT d.object_key,d.content_type,d.sha256
    FROM creator_profile_image_attachments a
    JOIN creator_profile_image_derivatives d ON d.id=a.derivative_id AND d.creator_id=a.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.status='attached'`).bind(attachmentId, context.creator.creator_id).first<{ object_key: string; content_type: string; sha256: string }>();
  if (!item) return new Response("Not found", { status: 404 });
  const object = await MEDIA.get(item.object_key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": item.content_type, "cache-control": "private, max-age=300", etag: `"${item.sha256}"`, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  if (!isSameOriginRequest(request)) return Response.json({ ok: false }, { status: 403, headers: { "cache-control": "no-store" } });
  const context = await requireCreatorContext("mutate");
  const { attachmentId } = await params;
  if (!ATTACHMENT_ID.test(attachmentId)) return new Response("Not found", { status: 404 });
  const { DB } = cloudflareEnv();
  const creatorId = context.creator.creator_id;
  const attachment = await DB.prepare(`SELECT surface,public_profile_version_id,adult_profile_version_id
    FROM creator_profile_image_attachments WHERE id=? AND creator_id=? AND status='attached'`).bind(attachmentId, creatorId).first<{ surface: "public_sfw" | "adult_profile"; public_profile_version_id: string | null; adult_profile_version_id: string | null }>();
  if (!attachment) return new Response("Not found", { status: 404 });
  const versionId = attachment.surface === "public_sfw" ? attachment.public_profile_version_id : attachment.adult_profile_version_id;
  const version = attachment.surface === "public_sfw"
    ? await DB.prepare("SELECT id FROM creator_public_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first()
    : await DB.prepare("SELECT id FROM creator_adult_profile_versions WHERE id=? AND creator_id=? AND status='draft'").bind(versionId, creatorId).first();
  if (!version) return new Response("Not found", { status: 404 });
  await DB.prepare("UPDATE creator_profile_image_attachments SET status='detached',detached_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='attached'").bind(attachmentId, creatorId).run();
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
