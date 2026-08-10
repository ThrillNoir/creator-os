import { readFile } from "node:fs/promises";
import path from "node:path";
import { creatorOwnsMediaPath, getSourcePath } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const relativeParts = (await params).path;
  const relativePath = relativeParts.join("/");
  const creator = await getActiveCreator();
  if (!creatorOwnsMediaPath(creator.id, relativePath)) return new Response("Media unavailable", { status: 404 });
  const source = path.resolve(getSourcePath(creator.id));
  const requested = path.resolve(source, ...relativeParts);
  if (!requested.startsWith(`${source}${path.sep}`)) {
    return new Response("Invalid media path", { status: 400 });
  }

  const contentType = contentTypes[path.extname(requested).toLowerCase()];
  if (!contentType) return new Response("Unsupported media type", { status: 415 });

  try {
    const download = new URL(request.url).searchParams.get("download") === "1";
    const filename = path.basename(requested);
    return new Response(await readFile(requested), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        ...(download
          ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }
          : {}),
      },
    });
  } catch {
    return new Response("Media unavailable", { status: 404 });
  }
}
