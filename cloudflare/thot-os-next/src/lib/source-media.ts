import "server-only";

import { createHash } from "node:crypto";
import { SOURCE_MEDIA_MAX_IMAGE_BYTES, SOURCE_MEDIA_MAX_IMAGE_DIMENSION, SOURCE_MEDIA_MAX_IMAGE_PIXELS, detectedMime, sourceMediaMimeByExtension } from "./source-media-algorithms";
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

class IsoBmffValidator {
  constructor(private readonly mime: string) {}
  private pending = new Uint8Array();
  private payloadRemaining = 0;
  private boxCount = 0;
  private firstBox = true;
  private sawFtyp = false;
  private sawMoov = false;
  private sawMeta = false;
  private sawMdat = false;

  push(input: Uint8Array) {
    let offset = 0;
    while (offset < input.length) {
      if (this.payloadRemaining > 0) {
        const skipped = Math.min(this.payloadRemaining, input.length - offset);
        this.payloadRemaining -= skipped;
        offset += skipped;
        continue;
      }
      const needed = 16 - this.pending.length;
      const take = Math.min(needed, input.length - offset);
      const next = new Uint8Array(this.pending.length + take);
      next.set(this.pending); next.set(input.subarray(offset, offset + take), this.pending.length);
      this.pending = next; offset += take;
      if (this.pending.length < 8) continue;
      const view = new DataView(this.pending.buffer, this.pending.byteOffset, this.pending.byteLength);
      const size32 = view.getUint32(0);
      const headerBytes = size32 === 1 ? 16 : 8;
      if (this.pending.length < headerBytes) continue;
      const type = String.fromCharCode(...this.pending.subarray(4, 8));
      if (!/^[\x20-\x7e]{4}$/.test(type)) throw new Error("source_media_container_invalid");
      const size = size32 === 1 ? Number(view.getBigUint64(8)) : size32;
      if (!Number.isSafeInteger(size) || size < headerBytes) throw new Error("source_media_container_invalid");
      if (this.firstBox && type !== "ftyp") throw new Error("source_media_container_invalid");
      this.firstBox = false;
      this.boxCount += 1;
      if (this.boxCount > 100_000) throw new Error("source_media_container_invalid");
      if (type === "ftyp") this.sawFtyp = true;
      if (type === "moov") {
        if (size > 256 * 1024 * 1024) throw new Error("source_media_metadata_too_large");
        this.sawMoov = true;
      }
      if (type === "meta") { if (size > 256 * 1024 * 1024) throw new Error("source_media_metadata_too_large"); this.sawMeta = true; }
      if (type === "mdat") this.sawMdat = true;
      this.payloadRemaining = size - headerBytes;
      const remainder = this.pending.subarray(headerBytes);
      this.pending = new Uint8Array();
      if (remainder.length) this.push(remainder);
    }
  }

  finish() {
    if (this.pending.length || this.payloadRemaining || !this.sawFtyp || !this.sawMdat || (this.mime.startsWith("video/") ? !this.sawMoov : !this.sawMeta)) throw new Error("source_media_container_invalid");
  }
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

export async function hashAndValidateR2Object(bucket: R2Bucket, objectKey: string, images: ImagesBinding) {
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
  if (mime.startsWith("video/")) throw new Error("source_media_decoder_required");
  if (containerValidator) containerValidator.finish();
  let width: number | null = null;
  let height: number | null = null;
  if (mime.startsWith("image/")) {
    if (byteCount > SOURCE_MEDIA_MAX_IMAGE_BYTES) throw new Error("source_media_image_too_large");
    if (mime !== "image/heic") assertImageEnvelope(mime, Uint8Array.from(firstBytes), lastBytes, byteCount);
    const imageObject = await bucket.get(objectKey, { onlyIf: { etagMatches: object.etag } });
    if (!imageObject || !("body" in imageObject)) throw new Error("source_object_changed_during_verification");
    const info = await images.info(imageObject.body);
    if (!("width" in info) || !("height" in info) || info.format !== mime || !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 || info.width > SOURCE_MEDIA_MAX_IMAGE_DIMENSION || info.height > SOURCE_MEDIA_MAX_IMAGE_DIMENSION || info.width * info.height > SOURCE_MEDIA_MAX_IMAGE_PIXELS) throw new Error("source_media_image_invalid");
    width = info.width; height = info.height;
  }
  return { byteCount, sha256: hash.digest("hex"), detectedMime: mime, width, height, r2Version: object.version, r2Etag: object.etag, object };
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
