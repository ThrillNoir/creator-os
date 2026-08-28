export const R2_MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
export const R2_MAX_MULTIPART_PART_BYTES = 5 * 1024 * 1024 * 1024;
export const R2_MAX_MULTIPART_PARTS = 10_000;
export const SOURCE_MEDIA_DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
export const SOURCE_MEDIA_MAX_BYTES = 10 * 1024 * 1024 * 1024;
export const SOURCE_MEDIA_MAX_IMAGE_BYTES = 64 * 1024 * 1024;
export const SOURCE_MEDIA_MAX_IMAGE_PIXELS = 100_000_000;
export const SOURCE_MEDIA_MAX_IMAGE_DIMENSION = 12_000;
export const SOURCE_MEDIA_SESSION_MINUTES = 30;

export const sourceMediaMimeByExtension: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime",
};

export function expectedMime(extension: string) { return sourceMediaMimeByExtension[extension.trim().toLowerCase()] ?? ""; }

export function detectedMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brands = [];
    for (let index = 8; index + 4 <= Math.min(bytes.length, 96); index += 4) brands.push(String.fromCharCode(...bytes.slice(index, index + 4)).toLowerCase());
    if (brands.some((brand) => ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand))) return "image/heic";
    if (brands.some((brand) => ["isom", "iso2", "avc1", "mp41", "mp42", "mp4v"].includes(brand))) return "video/mp4";
    if (brands.includes("qt  ")) return "video/quicktime";
  }
  return "";
}

export function expectedPartBytes(expectedBytes: number, partNumber: number, chunkBytes: number) {
  const partCount = Math.ceil(expectedBytes / chunkBytes);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > partCount) return 0;
  return partNumber === partCount ? expectedBytes - chunkBytes * (partCount - 1) : chunkBytes;
}

export function multipartPartSize(expectedBytes: number) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > SOURCE_MEDIA_MAX_BYTES) return 0;
  const required = Math.ceil(expectedBytes / R2_MAX_MULTIPART_PARTS); const mib = 1024 * 1024;
  const selected = Math.max(SOURCE_MEDIA_DEFAULT_CHUNK_BYTES, R2_MIN_MULTIPART_PART_BYTES, Math.ceil(required / mib) * mib);
  if (selected > R2_MAX_MULTIPART_PART_BYTES || Math.ceil(expectedBytes / selected) > R2_MAX_MULTIPART_PARTS) return 0;
  return selected;
}

export function immutableR2IdentityMatches(record: { byte_count: number; r2_version: string | null; r2_etag: string | null }, object: { size: number; version: string; etag: string } | null | undefined) {
  return Boolean(record.r2_version && record.r2_etag && object && object.size === record.byte_count && object.version === record.r2_version && object.etag === record.r2_etag);
}
