import { validateImageUpload } from "./profile-image-processing.ts";

export const VIDEO_POSTER_MAX_BYTES = 12 * 1024 * 1024;
const VIDEO_POSTER_MAX_PIXELS = 20_000_000;

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

async function hexDigest(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function videoPosterIdentity(creatorId: string, assetId: string, bytes: Uint8Array) {
  const objectId = await hexDigest(`${creatorId}:${assetId}`);
  const revision = await hexDigest(bytes);
  return { objectId, key: `creators/${creatorId}/assets/${objectId}/previews/${revision}.jpg` };
}

export async function readVideoPosterUpload(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > VIDEO_POSTER_MAX_BYTES) throw new Error("poster_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("poster_empty");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > VIDEO_POSTER_MAX_BYTES) { await reader.cancel(); throw new Error("poster_too_large"); }
    chunks.push(value);
  }
  if (!length) throw new Error("poster_empty");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function preparePrivateVideoPoster(input: {
  images: ImagesBinding;
  bytes: Uint8Array;
  contentType: string;
  creatorId: string;
  assetId: string;
}) {
  const detected = validateImageUpload(input.bytes, input.contentType);
  const source = await input.images.info(byteStream(input.bytes));
  if (source.format !== detected || !Number.isInteger(source.width) || !Number.isInteger(source.height)
    || source.width < 1 || source.height < 1 || source.width * source.height > VIDEO_POSTER_MAX_PIXELS) throw new Error("poster_invalid_dimensions");
  const transformed = await input.images.input(byteStream(input.bytes))
    .transform({ width: 960, height: 960, fit: "scale-down" })
    .output({ format: "image/jpeg", quality: 84, anim: false });
  const bytes = new Uint8Array(await new Response(transformed.image()).arrayBuffer());
  const info = await input.images.info(byteStream(bytes));
  if (!bytes.length || info.format !== "image/jpeg" || !Number.isInteger(info.width) || !Number.isInteger(info.height)
    || info.width < 1 || info.height < 1) throw new Error("poster_processing_failed");
  const { objectId, key } = await videoPosterIdentity(input.creatorId, input.assetId, bytes);
  return {
    bytes,
    width: info.width,
    height: info.height,
    objectId,
    key,
  };
}
