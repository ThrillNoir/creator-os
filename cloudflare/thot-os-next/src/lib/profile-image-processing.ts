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

type DecodedImageInfo = { format: string; fileSize: number; width: number; height: number };

/**
 * The editor gets an explicit capability value from its Server Component.
 * That keeps the file controls truthful when a local or protected runtime is
 * missing the Images binding. The upload route repeats this check immediately
 * before processing, since UI state is never an authorization boundary.
 */
export function profileImageProcessorAvailable(env: { IMAGES?: unknown } | null | undefined) {
  return Boolean(env?.IMAGES);
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

function hasChunk(bytes: Uint8Array, chunk: string) {
  const marker = new TextEncoder().encode(chunk);
  for (let index = 0; index <= bytes.length - marker.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < marker.length; offset += 1) {
      if (bytes[index + offset] !== marker[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

export function isPotentiallyAnimatedImage(bytes: Uint8Array, detectedType = detectImageType(bytes)) {
  // The accepted formats have stable animation markers. Reject rather than
  // flatten a multi-frame file so the stored source and preview stay honest.
  if (detectedType === "image/png") return hasChunk(bytes, "acTL");
  if (detectedType === "image/webp") return hasChunk(bytes, "ANIM");
  if (detectedType === "image/avif") return hasChunk(bytes, "moov");
  return false;
}

export function validateImageUpload(bytes: Uint8Array, declaredContentType: string) {
  if (!bytes.length) throw new Error("Choose a non-empty image file.");
  if (bytes.byteLength > PROFILE_IMAGE_MAX_BYTES) throw new Error("Images must be 12 MB or smaller.");
  const detected = detectImageType(bytes);
  if (!detected) throw new Error("Use a JPEG, PNG, WebP, or AVIF image.");
  if (declaredContentType !== detected) throw new Error("The image type does not match the uploaded file.");
  if (isPotentiallyAnimatedImage(bytes, detected)) throw new Error("Animated images are not supported.");
  return detected;
}

function assertDimensions(info: DecodedImageInfo) {
  if (!Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 || info.width * info.height > PROFILE_IMAGE_MAX_PIXELS) {
    throw new Error("Image dimensions are too large.");
  }
}

async function transformedImage(images: ImagesBinding, bytes: Uint8Array, transform: ImageTransform, quality: number) {
  const result = await images.input(byteStream(bytes)).transform(transform).output({ format: "image/webp", quality, anim: false });
  const outputBytes = new Uint8Array(await new Response(result.image()).arrayBuffer());
  if (!outputBytes.byteLength) throw new Error("Image processing failed.");
  const info = await images.info(byteStream(outputBytes));
  if (info.format !== "image/webp") throw new Error("Image processing failed.");
  assertDimensions(info);
  return {
    bytes: outputBytes,
    width: info.width,
    height: info.height,
    sha256: await sha256(outputBytes),
  };
}

/**
 * Uses the Images binding rather than a native Node addon. Re-encoding to
 * WebP applies EXIF orientation and discards source metadata, including GPS,
 * before a derivative can be attached to a profile draft.
 */
export class CloudflareProfileImageProcessor implements ProfileImageProcessor {
  private readonly images: ImagesBinding;

  constructor(images: ImagesBinding) {
    this.images = images;
  }

  async process({ bytes, declaredContentType, role }: { bytes: Uint8Array; declaredContentType: string; role: ProfileImageRole }): Promise<ProcessedProfileImage> {
    const detectedContentType = validateImageUpload(bytes, declaredContentType);
    const source = await this.images.info(byteStream(bytes));
    if (source.format !== detectedContentType) throw new Error("The image type does not match the uploaded file.");
    assertDimensions(source);

    const [display, preview, sourceSha256] = await Promise.all([
      transformedImage(
        this.images,
        bytes,
        role === "avatar"
          ? { width: 512, height: 512, fit: "cover" }
          : { width: 1280, height: 1280, fit: "scale-down" },
        role === "avatar" ? 86 : 84,
      ),
      transformedImage(
        this.images,
        bytes,
        role === "avatar"
          ? { width: 128, height: 128, fit: "cover" }
          : { width: 320, height: 320, fit: "scale-down" },
        role === "avatar" ? 78 : 76,
      ),
      sha256(bytes),
    ]);

    return { detectedContentType, width: source.width, height: source.height, sourceSha256, display, preview };
  }
}
