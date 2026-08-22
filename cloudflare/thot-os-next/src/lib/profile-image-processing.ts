import { createHash } from "node:crypto";

export const PROFILE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const PROFILE_IMAGE_MAX_PIXELS = 20_000_000;
export type ProfileImageSurface = "public_sfw" | "adult_profile";
export type ProfileImageRole = "avatar" | "background";
export type DetectedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

export type ProcessedProfileImage = {
  detectedContentType: DetectedImageType;
  width: number;
  height: number;
  sourceSha256: string;
  display: { bytes: Uint8Array; width: number; height: number; sha256: string };
  preview: { bytes: Uint8Array; width: number; height: number; sha256: string };
};

export interface ProfileImageProcessor {
  process(input: { bytes: Uint8Array; declaredContentType: string; role: ProfileImageRole }): Promise<ProcessedProfileImage>;
}

export function profileImageProcessorAvailable(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  // sharp requires a native Node addon. Cloudflare Workers exposes Node API
  // compatibility, but cannot load this addon. Keep the adapter available to
  // local Node development and fail closed in workerd/staging.
  return userAgent !== "Cloudflare-Workers";
}

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

export function detectImageType(bytes: Uint8Array): DetectedImageType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

export function validateImageUpload(bytes: Uint8Array, declaredContentType: string) {
  if (!bytes.length) throw new Error("Choose a non-empty image file.");
  if (bytes.byteLength > PROFILE_IMAGE_MAX_BYTES) throw new Error("Images must be 12 MB or smaller.");
  const detected = detectImageType(bytes);
  if (!detected) throw new Error("Use a JPEG, PNG, WebP, or AVIF image.");
  if (declaredContentType !== detected) throw new Error("The image type does not match the uploaded file.");
  return detected;
}

export const localSharpProfileImageProcessor: ProfileImageProcessor = {
  async process({ bytes, declaredContentType, role }) {
    const detectedContentType = validateImageUpload(bytes, declaredContentType);
    const sharp = (await import("sharp")).default;
    const source = sharp(bytes, { animated: false, limitInputPixels: PROFILE_IMAGE_MAX_PIXELS, failOn: "error" });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > PROFILE_IMAGE_MAX_PIXELS) throw new Error("Image dimensions are too large.");
    if ((metadata.pages ?? 1) > 1) throw new Error("Animated images are not supported.");
    const display = role === "avatar"
      ? await source.clone().rotate().resize(512, 512, { fit: "cover", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true })
      : await source.clone().rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
    const preview = role === "avatar"
      ? await source.clone().rotate().resize(128, 128, { fit: "cover", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true })
      : await source.clone().rotate().resize(320, 320, { fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer({ resolveWithObject: true });
    return {
      detectedContentType,
      width: metadata.width,
      height: metadata.height,
      sourceSha256: sha256(bytes),
      display: { bytes: display.data, width: display.info.width, height: display.info.height, sha256: sha256(display.data) },
      preview: { bytes: preview.data, width: preview.info.width, height: preview.info.height, sha256: sha256(preview.data) },
    };
  },
};
