import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { isSameOriginRequest } from "@/lib/audit-identity";

export const runtime = "nodejs";

const VERSION_ID = /^[a-zA-Z0-9_-]{1,160}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function sourceKey(creatorId: string, versionId: string) {
  return `profile-private/${creatorId}/public_sfw/${versionId}/social-preview.png`;
}

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

async function versionOwned(DB: D1Database, creatorId: string, versionId: string, draftOnly: boolean) {
  return DB.prepare(`SELECT id FROM creator_public_profile_versions WHERE id=? AND creator_id=?${draftOnly ? " AND status='draft'" : ""}`)
    .bind(versionId, creatorId).first<{ id: string }>();
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ ok: false, error: "same_origin_required" }, { status: 403, headers: HEADERS });
  const context = await requireCreatorContext("mutate");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 8192) return Response.json({ ok: false, error: "file_too_large" }, { status: 413, headers: HEADERS });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const versionId = form?.get("versionId");
  if (!(file instanceof File) || typeof versionId !== "string" || !VERSION_ID.test(versionId) || file.size < 1 || file.size > MAX_BYTES || file.type !== "image/png") {
    return Response.json({ ok: false, error: "choose_a_png_up_to_8_mb" }, { status: 400, headers: HEADERS });
  }
  const env = cloudflareEnv() as CloudflareEnv & { IMAGES?: ImagesBinding };
  if (!env.IMAGES || !await versionOwned(env.DB, context.creator.creator_id, versionId, true)) {
    return Response.json({ ok: false, error: "draft_or_image_processing_unavailable" }, { status: 409, headers: HEADERS });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const source = await env.IMAGES.info(stream(bytes));
    if (source.format !== "image/png" || source.width !== 1200 || source.height !== 630) {
      return Response.json({ ok: false, error: "image_must_be_1200_by_630_png" }, { status: 400, headers: HEADERS });
    }
    // Re-encode the approved public card to remove any embedded source metadata.
    const image = await env.IMAGES.input(stream(bytes)).output({ format: "image/png", anim: false });
    const clean = new Uint8Array(await new Response(image.image()).arrayBuffer());
    const verified = await env.IMAGES.info(stream(clean));
    if (verified.format !== "image/png" || verified.width !== 1200 || verified.height !== 630 || clean.byteLength > MAX_BYTES) throw new Error("preview_encode_failed");
    const result = await env.MEDIA.put(sourceKey(context.creator.creator_id, versionId), clean, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { creatorId: context.creator.creator_id, versionId, surface: "public_sfw" },
    });
    if (!result) throw new Error("preview_store_failed");
    return Response.json({ ok: true }, { headers: HEADERS });
  } catch {
    return Response.json({ ok: false, error: "preview_processing_failed" }, { status: 503, headers: HEADERS });
  }
}

export async function GET(request: Request) {
  const context = await requireCreatorContext();
  const versionId = new URL(request.url).searchParams.get("versionId");
  if (!versionId || !VERSION_ID.test(versionId)) return new Response(null, { status: 404, headers: HEADERS });
  const env = cloudflareEnv();
  if (!await versionOwned(env.DB, context.creator.creator_id, versionId, false)) return new Response(null, { status: 404, headers: HEADERS });
  const object = await env.MEDIA.get(sourceKey(context.creator.creator_id, versionId));
  if (!object || object.httpMetadata?.contentType !== "image/png" || object.customMetadata?.creatorId !== context.creator.creator_id || object.customMetadata?.versionId !== versionId) return new Response(null, { status: 404, headers: HEADERS });
  return new Response(object.body, { headers: { ...HEADERS, "content-type": "image/png" } });
}
