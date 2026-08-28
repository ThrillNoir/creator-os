import "server-only";

import { expectedMime, validSourceFilename } from "./source-media";
import { SOURCE_MEDIA_MAX_VIDEO_BYTES } from "./source-media-algorithms";

export const NATIVE_VIDEO_EXTENSIONS = new Set(["mp4", "mov"]);

export function validClientUploadId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function nativeVideoDetails(filename: unknown, mimeType: unknown) {
  const name = typeof filename === "string" ? filename.trim() : "";
  const mime = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!validSourceFilename(name) || !NATIVE_VIDEO_EXTENSIONS.has(extension) || expectedMime(extension) !== mime) return null;
  return { filename: name, extension, mimeType: mime };
}

export function validNativeVideoBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= SOURCE_MEDIA_MAX_VIDEO_BYTES;
}
