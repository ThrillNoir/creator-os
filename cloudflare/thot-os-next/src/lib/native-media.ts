import "server-only";

import { expectedMime, validSourceFilename } from "./source-media";

export const NATIVE_IMAGE_MAX_FILES = 20;

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function validClientUploadId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function nativeImageDetails(filename: unknown, mimeType: unknown) {
  const name = typeof filename === "string" ? filename.trim() : "";
  const mime = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!validSourceFilename(name) || !extension || !mime.startsWith("image/") || expectedMime(extension) !== mime) return null;
  return { filename: name, extension, mimeType: mime };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Native previews are private re-encoded derivatives.  The canonical R2
 * original is not used as an image URL, and the generated key contains only
 * creator and opaque asset identity.
 */
export async function createNativeImagePreview(input: {
  libraryMedia: R2Bucket;
  previews: R2Bucket;
  images: ImagesBinding;
  creatorId: string;
  assetId: string;
  objectKey: string;
  expectedEtag: string;
  sourceSha256: string;
}) {
  const source = await input.libraryMedia.get(input.objectKey, { onlyIf: { etagMatches: input.expectedEtag } });
  if (!source || !("body" in source)) throw new Error("source_object_changed_during_preview");
  const sourceBytes = new Uint8Array(await source.arrayBuffer());
  if (!sourceBytes.byteLength) throw new Error("source_object_missing");
  const transformed = await input.images.input(byteStream(sourceBytes))
    .transform({ width: 720, height: 720, fit: "scale-down" })
    .output({ format: "image/jpeg", quality: 84, anim: false });
  const bytes = new Uint8Array(await new Response(transformed.image()).arrayBuffer());
  if (!bytes.byteLength) throw new Error("native_preview_empty");
  const info = await input.images.info(byteStream(bytes));
  if (info.format !== "image/jpeg" || !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1) throw new Error("native_preview_invalid");
  const objectId = await sha256(`${input.creatorId}:${input.assetId}`);
  const objectKey = `creators/${input.creatorId}/assets/${objectId}/previews/${input.sourceSha256}.jpg`;
  await input.previews.put(objectKey, bytes, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
    customMetadata: { creator_id: input.creatorId, asset_id: input.assetId, source_sha256: input.sourceSha256, derivative: "native_preview_v1" },
  });
  return { objectKey, width: info.width, height: info.height };
}
