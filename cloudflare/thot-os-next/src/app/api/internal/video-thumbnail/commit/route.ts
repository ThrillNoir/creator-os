import { cloudflareEnv } from "@/lib/cloudflare";
import { handleVideoThumbnailCommit } from "@/lib/video-thumbnail-commit";

export async function POST(request: Request) {
  const env = cloudflareEnv() as CloudflareEnv & { PREVIEWS?: R2Bucket; LIBRARY_MEDIA?: R2Bucket; IMAGES?: ImagesBinding };
  if (!env.DB || !env.PREVIEWS || !env.LIBRARY_MEDIA || !env.IMAGES) return Response.json({ ok: false }, { status: 503,
    headers: { "cache-control": "private, no-store" } });
  return handleVideoThumbnailCommit(request, { DB: env.DB, PREVIEWS: env.PREVIEWS,
    LIBRARY_MEDIA: env.LIBRARY_MEDIA, IMAGES: env.IMAGES });
}
