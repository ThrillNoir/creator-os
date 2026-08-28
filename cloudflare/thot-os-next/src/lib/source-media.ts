import "server-only";

import { createHash } from "node:crypto";
import { IsoBmffValidator } from "./iso-bmff-validator";
import { SOURCE_MEDIA_MAX_IMAGE_BYTES, SOURCE_MEDIA_MAX_IMAGE_DIMENSION, SOURCE_MEDIA_MAX_IMAGE_PIXELS, SOURCE_MEDIA_MAX_VIDEO_BYTES, detectedMime, sourceMediaMimeByExtension } from "./source-media-algorithms";
export * from "./source-media-algorithms";

export type SourceMediaMime = keyof typeof sourceMediaMimeByExtension;

export function noStoreHeaders(extra: HeadersInit = {}) {
  return { "cache-control": "private, no-store", "x-content-type-options": "nosniff", ...extra };
}

export function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders() });
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function validSourceFilename(value: unknown) {
  if (typeof value !== "string") return false;
  return value.length > 0 && value.length <= 512 && !/[\\/\u0000\r\n]/.test(value);
}

export function privateOriginalKey() {
  return `originals/v1/${crypto.randomUUID()}`;
}

export function safeFailureCode(error: unknown, fallback = "source_media_failed") {
  const raw = error instanceof Error ? error.message : fallback;
  const normalized = raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return (normalized || fallback).slice(0, 120);
}

function assertImageEnvelope(mime: string, first: Uint8Array, last: Uint8Array, total: number) {
  if (mime === "image/jpeg" && !(last.length >= 2 && last.at(-2) === 0xff && last.at(-1) === 0xd9)) throw new Error("source_media_image_invalid");
  if (mime === "image/png") {
    const ending = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    if (last.length < ending.length || !ending.every((value, index) => last[last.length - ending.length + index] === value)) throw new Error("source_media_image_invalid");
  }
  if (mime === "image/webp") {
    if (first.length < 12) throw new Error("source_media_image_invalid");
    const declared = new DataView(first.buffer, first.byteOffset, first.byteLength).getUint32(4, true) + 8;
    if (declared !== total) throw new Error("source_media_image_invalid");
  }
}

export async function hashAndValidateR2Object(bucket: R2Bucket, objectKey: string, images?: ImagesBinding, options: { allowVideo?: boolean } = {}) {
  const object = await bucket.get(objectKey);
  if (!object) throw new Error("source_object_missing");
  const hash = createHash("sha256");
  const firstBytes: number[] = [];
  let containerValidator: IsoBmffValidator | null = null;
  let videoDecisionMade = false;
  const undecidedChunks: Uint8Array[] = [];
  const reader = object.body.getReader();
  let byteCount = 0;
  let lastBytes = new Uint8Array();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = item.value;
      byteCount += chunk.byteLength;
      if (firstBytes.length < 512) firstBytes.push(...chunk.slice(0, 512 - firstBytes.length));
      const tailInput = new Uint8Array(lastBytes.length + chunk.length); tailInput.set(lastBytes); tailInput.set(chunk, lastBytes.length); lastBytes = tailInput.slice(Math.max(0, tailInput.length - 32));
      if (!videoDecisionMade) {
        undecidedChunks.push(chunk);
        const kind = detectedMime(Uint8Array.from(firstBytes));
        if (kind.startsWith("video/") || kind === "image/heic") {
          containerValidator = new IsoBmffValidator(kind);
          for (const pending of undecidedChunks) containerValidator.push(pending);
          undecidedChunks.length = 0; videoDecisionMade = true;
        } else if (kind.startsWith("image/") || firstBytes.length >= 96) {
          undecidedChunks.length = 0; videoDecisionMade = true;
        }
      } else if (containerValidator) containerValidator.push(chunk);
      hash.update(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const mime = detectedMime(Uint8Array.from(firstBytes));
  if (!mime) throw new Error("source_media_type_unsupported");
  const codec = containerValidator?.finish() ?? null;
  if (mime.startsWith("video/") && !options.allowVideo) throw new Error("source_media_decoder_required");
  let width: number | null = null;
  let height: number | null = null;
  if (mime.startsWith("image/")) {
    if (byteCount > SOURCE_MEDIA_MAX_IMAGE_BYTES) throw new Error("source_media_image_too_large");
    if (mime !== "image/heic") assertImageEnvelope(mime, Uint8Array.from(firstBytes), lastBytes, byteCount);
    if (!images) throw new Error("source_media_images_unavailable");
    const imageObject = await bucket.get(objectKey, { onlyIf: { etagMatches: object.etag } });
    if (!imageObject || !("body" in imageObject)) throw new Error("source_object_changed_during_verification");
    const info = await images.info(imageObject.body);
    if (!("width" in info) || !("height" in info) || info.format !== mime || !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 || info.width > SOURCE_MEDIA_MAX_IMAGE_DIMENSION || info.height > SOURCE_MEDIA_MAX_IMAGE_DIMENSION || info.width * info.height > SOURCE_MEDIA_MAX_IMAGE_PIXELS) throw new Error("source_media_image_invalid");
    width = info.width; height = info.height;
  }
  if (mime.startsWith("video/") && byteCount > SOURCE_MEDIA_MAX_VIDEO_BYTES) throw new Error("source_media_video_too_large");
  return { byteCount, sha256: hash.digest("hex"), detectedMime: mime, codec, width, height, r2Version: object.version, r2Etag: object.etag, object };
}

export type CreatorMediaSourceState = {
  active_backend: "dropbox" | "r2";
  migration_state: "dropbox" | "planned" | "transferring" | "verified" | "r2_active" | "rollback" | "retired";
  dropbox_fallback_enabled: number;
};

export async function getCreatorMediaSourceState(DB: D1Database, creatorId: string): Promise<CreatorMediaSourceState> {
  const state = await DB.prepare("SELECT active_backend,migration_state,dropbox_fallback_enabled FROM creator_media_source_states WHERE creator_id=?").bind(creatorId).first<CreatorMediaSourceState>();
  return state ?? { active_backend: "dropbox", migration_state: "dropbox", dropbox_fallback_enabled: 1 };
}

export function sourceMediaObjectHeaders(mime: string, bytes: number) {
  return noStoreHeaders({ "content-type": mime, "content-length": String(bytes), "content-disposition": "attachment" });
}
