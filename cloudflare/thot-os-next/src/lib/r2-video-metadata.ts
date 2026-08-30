import { createHash } from "node:crypto";
import { IsoBmffValidator, isoBmffBoxHeader } from "./iso-bmff-validator.ts";
import { detectedMime } from "./source-media-algorithms.ts";

const MAX_TOP_LEVEL_BOXES = 256;

export function completedR2MultipartEtag(partEtags: string[]) {
  if (!partEtags.length || partEtags.length > 10_000 || partEtags.some((etag) => !/^[a-f0-9]{32}$/i.test(etag))) return null;
  const hash = createHash("md5");
  for (const etag of partEtags) hash.update(Buffer.from(etag, "hex"));
  return `${hash.digest("hex")}-${partEtags.length}`;
}

async function rangeObject(bucket: R2Bucket, key: string, etag: string, offset: number, length: number) {
  const object = await bucket.get(key, { onlyIf: { etagMatches: etag }, range: { offset, length } });
  if (!object || !("body" in object)) throw new Error("source_object_changed_during_verification");
  return object;
}

async function rangeBytes(bucket: R2Bucket, key: string, etag: string, offset: number, length: number) {
  const bytes = new Uint8Array(await (await rangeObject(bucket, key, etag, offset, length)).arrayBuffer());
  if (bytes.length !== length) throw new Error("source_media_container_invalid");
  return bytes;
}

async function pushRange(validator: IsoBmffValidator, bucket: R2Bucket, key: string, etag: string, offset: number, length: number) {
  if (!length) return;
  const object = await rangeObject(bucket, key, etag, offset, length);
  const reader = object.body.getReader();
  let received = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      received += item.value.byteLength;
      if (received > length) throw new Error("source_media_container_invalid");
      validator.push(item.value);
    }
  } finally { reader.releaseLock(); }
  if (received !== length) throw new Error("source_media_container_invalid");
}

export async function validateR2VideoMetadata(bucket: R2Bucket, key: string, expected: {
  assetId: string;
  bytes: number;
  creatorId: string;
  mimeType: string;
  multipartEtag: string;
  sessionId: string;
  sha256: string;
}) {
  const object = await bucket.head(key);
  if (!object) throw new Error("source_object_missing");
  if (object.size !== expected.bytes
    || object.etag !== expected.multipartEtag
    || object.customMetadata?.expected_sha256 !== expected.sha256) throw new Error("source_media_verification_failed");
  if (object.httpMetadata?.contentType !== expected.mimeType
    || object.customMetadata?.creator_id !== expected.creatorId
    || object.customMetadata?.asset_id !== expected.assetId
    || object.customMetadata?.source_session !== expected.sessionId) throw new Error("source_media_metadata_mismatch");

  const signature = await rangeBytes(bucket, key, object.etag, 0, Math.min(512, object.size));
  if (detectedMime(signature) !== expected.mimeType) throw new Error("source_media_type_unsupported");

  const validator = new IsoBmffValidator(expected.mimeType);
  let offset = 0;
  let boxes = 0;
  while (offset < object.size) {
    if (++boxes > MAX_TOP_LEVEL_BOXES) throw new Error("source_media_container_invalid");
    const available = Math.min(16, object.size - offset);
    const rawHeader = await rangeBytes(bucket, key, object.etag, offset, available);
    const header = isoBmffBoxHeader(rawHeader);
    if (!header || header.size > object.size - offset) throw new Error("source_media_container_invalid");
    validator.push(rawHeader.subarray(0, header.headerBytes));
    const payloadBytes = header.size - header.headerBytes;
    if (header.type === "ftyp" || header.type === "moov") await pushRange(validator, bucket, key, object.etag, offset + header.headerBytes, payloadBytes);
    else validator.skipPayload(payloadBytes);
    offset += header.size;
  }
  const codec = validator.finish();
  return { byteCount: object.size, codec, detectedMime: expected.mimeType, r2Etag: object.etag, r2Version: object.version, sha256: expected.sha256 };
}
