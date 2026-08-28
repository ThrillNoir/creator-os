import "server-only";

import { createHash } from "node:crypto";

export const SOURCE_MEDIA_CHUNK_BYTES = 8 * 1024 * 1024;
export const SOURCE_MEDIA_MAX_BYTES = 5 * 1024 * 1024 * 1024 * 1024;
export const SOURCE_MEDIA_SESSION_MINUTES = 30;

export const sourceMediaMimeByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

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

export function expectedMime(extension: string) {
  return sourceMediaMimeByExtension[extension.trim().toLowerCase()] ?? "";
}

export function validSourceFilename(value: unknown) {
  if (typeof value !== "string") return false;
  return value.length > 0 && value.length <= 512 && !/[\\/\u0000\r\n]/.test(value);
}

export function detectedMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (["isom", "iso2", "avc1", "mp41", "mp42", "mp4v"].includes(brand)) return "video/mp4";
    if (["qt  "].includes(brand)) return "video/quicktime";
  }
  // QuickTime commonly stores `qt  ` in a compatible-brand field rather than
  // the major brand. The format is still ISO BMFF and can be verified here.
  for (let index = 8; index + 4 <= Math.min(bytes.length, 96); index += 4) {
    if (String.fromCharCode(...bytes.slice(index, index + 4)) === "qt  ") return "video/quicktime";
  }
  return "";
}

export function expectedPartBytes(expectedBytes: number, partNumber: number, chunkBytes: number) {
  const partCount = Math.ceil(expectedBytes / chunkBytes);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > partCount) return 0;
  return partNumber === partCount ? expectedBytes - chunkBytes * (partCount - 1) : chunkBytes;
}

export function privateOriginalKey() {
  return `originals/v1/${crypto.randomUUID()}`;
}

export function safeFailureCode(error: unknown, fallback = "source_media_failed") {
  const raw = error instanceof Error ? error.message : fallback;
  const normalized = raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return (normalized || fallback).slice(0, 120);
}

export async function hashAndDetectR2Object(bucket: R2Bucket, objectKey: string) {
  const object = await bucket.get(objectKey);
  if (!object) throw new Error("source_object_missing");
  const hash = createHash("sha256");
  const firstBytes: number[] = [];
  const reader = object.body.getReader();
  let byteCount = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = item.value;
      byteCount += chunk.byteLength;
      if (firstBytes.length < 96) firstBytes.push(...chunk.slice(0, 96 - firstBytes.length));
      hash.update(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return { byteCount, sha256: hash.digest("hex"), detectedMime: detectedMime(Uint8Array.from(firstBytes)), object };
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
