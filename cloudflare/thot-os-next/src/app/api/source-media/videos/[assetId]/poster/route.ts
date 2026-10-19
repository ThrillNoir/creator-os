import { humanAuditActor, identityAuditStatement, isSameOriginRequest } from "@/lib/audit-identity";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { noStoreJson } from "@/lib/source-media";
import { preparePrivateVideoPoster, readVideoPosterUpload } from "@/lib/video-poster";

const VIDEO_ID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  if (!isSameOriginRequest(request)) return noStoreJson({ ok: false, error: "same_origin_required" }, 403);
  const { assetId } = await params;
  if (!VIDEO_ID.test(assetId)) return noStoreJson({ ok: false, error: "invalid_asset" }, 400);
  const context = await requireCreatorContext("mutate");
  const env = cloudflareEnv() as CloudflareEnv & { IMAGES?: ImagesBinding; PREVIEWS?: R2Bucket; PORTFOLIO_AUTHORING_ENABLED?: string };
  if (env.PORTFOLIO_AUTHORING_ENABLED !== "1") return noStoreJson({ ok: false, error: "not_found" }, 404);
  if (!env.IMAGES || !env.PREVIEWS) return noStoreJson({ ok: false, error: "poster_processing_unavailable" }, 503);
  const creatorId = context.creator.creator_id;
  const video = await env.DB.prepare(`SELECT a.id FROM assets a
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.source_available=1 AND ma.state='canonical_verified'
      AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')`)
    .bind(assetId, creatorId).first<{ id: string }>();
  if (!video) return noStoreJson({ ok: false, error: "verified_video_not_found" }, 404);
  let poster;
  try {
    const bytes = await readVideoPosterUpload(request);
    poster = await preparePrivateVideoPoster({ images: env.IMAGES, bytes, contentType: request.headers.get("content-type") ?? "", creatorId, assetId });
  } catch (error) {
    const code = error instanceof Error && error.message === "poster_too_large" ? "poster_too_large" : "invalid_poster_image";
    return noStoreJson({ ok: false, error: code }, code === "poster_too_large" ? 413 : 400);
  }
  try {
    const stored = await env.PREVIEWS.put(poster.key, poster.bytes, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
      customMetadata: { creator_id: creatorId, asset_id: assetId, derivative: "video_poster_v1" },
    });
    if (!stored) throw new Error("poster_storage_failed");
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE assets SET preview_r2_key=? WHERE id=? AND creator_id=? AND source_available=1")
        .bind(poster.key, assetId, creatorId),
      identityAuditStatement(env.DB, humanAuditActor(context), "private_video_poster_saved", assetId, { width: poster.width, height: poster.height }),
    ]);
    if (results[0]?.meta?.changes !== 1) throw new Error("poster_asset_unavailable");
  } catch {
    // Retain the newly written private derivative on an uncertain D1 outcome.
    // The canonical video and any previously selected poster are untouched.
    return noStoreJson({ ok: false, error: "poster_save_needs_review" }, 503);
  }
  return noStoreJson({ ok: true, previewUrl: `/api/preview/${poster.objectId}` });
}
