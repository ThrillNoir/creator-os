import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { CloudflareProfileImageProcessor, detectImageType, isPotentiallyAnimatedImage, profileImageProcessorAvailable, PROFILE_IMAGE_MAX_BYTES, validateImageUpload } from "../src/lib/profile-image-processing.ts";

function streamFrom(bytes) {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

async function streamBytes(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function imageBinding() {
  return {
    async info(stream) {
      const bytes = await streamBytes(stream);
      const metadata = await sharp(bytes).metadata();
      return { format: `image/${metadata.format}`, fileSize: bytes.byteLength, width: metadata.width, height: metadata.height };
    },
    input(stream) {
      const source = streamBytes(stream);
      const transforms = [];
      const transformer = {
        transform(options) { transforms.push(options); return transformer; },
        async output(options) {
          let pipeline = sharp(await source, { animated: false }).rotate();
          for (const transform of transforms) {
            pipeline = pipeline.resize(transform.width, transform.height, { fit: transform.fit, withoutEnlargement: transform.fit === "scale-down" });
          }
          const result = await pipeline.webp({ quality: options.quality }).toBuffer();
          return { image: () => streamFrom(result) };
        },
      };
      return transformer;
    },
  };
}

test("profile image editing is offered only when the server has its Images binding", () => {
  assert.equal(profileImageProcessorAvailable(undefined), false);
  assert.equal(profileImageProcessorAvailable({}), false);
  assert.equal(profileImageProcessorAvailable({ IMAGES: imageBinding() }), true);
});

test("profile image validation rejects non-images and declared-type mismatches", () => {
  assert.equal(detectImageType(new TextEncoder().encode("<svg></svg>")), null);
  assert.throws(() => validateImageUpload(new TextEncoder().encode("<html>bad</html>"), "text/html"), /JPEG, PNG, WebP, or AVIF/);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.throws(() => validateImageUpload(jpeg, "image/png"), /does not match/);
  assert.throws(() => validateImageUpload(new Uint8Array(PROFILE_IMAGE_MAX_BYTES + 1), "image/jpeg"), /12 MB/);
});

test("local profile derivatives are re-encoded WebP without source metadata", async () => {
  const source = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#7655f6" } })
    .withMetadata({ exif: { IFD0: { Copyright: "private metadata" } } })
    .jpeg()
    .toBuffer();
  const result = await new CloudflareProfileImageProcessor(imageBinding()).process({ bytes: source, declaredContentType: "image/jpeg", role: "avatar" });
  assert.equal(result.detectedContentType, "image/jpeg");
  assert.equal((await sharp(result.display.bytes).metadata()).format, "webp");
  assert.equal((await sharp(result.display.bytes).metadata()).exif, undefined);
  assert.equal(result.display.width, 512);
  assert.equal(result.preview.width, 128);
});

test("profile image validation rejects animated PNG, WebP, and AVIF markers", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x61, 0x63, 0x54, 0x4c, 0x00]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x41, 0x4e, 0x49, 0x4d]);
  const avif = new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x6d, 0x6f, 0x6f, 0x76]);
  assert.equal(isPotentiallyAnimatedImage(png), true);
  assert.equal(isPotentiallyAnimatedImage(webp), true);
  assert.equal(isPotentiallyAnimatedImage(avif), true);
  assert.throws(() => validateImageUpload(webp, "image/webp"), /Animated/);
});
