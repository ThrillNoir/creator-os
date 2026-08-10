import { readFile } from "node:fs/promises";
import path from "node:path";
import { creatorOwnsMediaPath, getCreator } from "@/lib/db";
import { verifySignedPublicMediaRequest } from "@/lib/public-media";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creator") ?? "";
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") ?? "";
  const relativePath = (await params).path.join("/");
  if (!verifySignedPublicMediaRequest({ creatorId, relativePath, expires, signature })) return new Response("Link expired or invalid", { status: 403 });
  const creator = getCreator(creatorId);
  if (!creator?.media_source || !creatorOwnsMediaPath(creatorId, relativePath)) return new Response("Media unavailable", { status: 404 });
  const source = path.resolve(creator.media_source);
  const requested = path.resolve(source, ...relativePath.split("/"));
  if (!requested.startsWith(`${source}${path.sep}`)) return new Response("Invalid media path", { status: 400 });
  const contentType = contentTypes[path.extname(requested).toLowerCase()];
  if (!contentType) return new Response("Unsupported media type", { status: 415 });
  try {
    return new Response(await readFile(requested), {
      headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" },
    });
  } catch {
    return new Response("Media unavailable", { status: 404 });
  }
}
