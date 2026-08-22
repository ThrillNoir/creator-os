import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { detectImageType, localSharpProfileImageProcessor, profileImageProcessorAvailable, PROFILE_IMAGE_MAX_BYTES, validateImageUpload } from "../src/lib/profile-image-processing.ts";

test("native profile image processing stays disabled in the Workers runtime", () => {
  assert.equal(profileImageProcessorAvailable("Cloudflare-Workers"), false);
  assert.equal(profileImageProcessorAvailable("Node.js/22"), true);
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
  const result = await localSharpProfileImageProcessor.process({ bytes: source, declaredContentType: "image/jpeg", role: "avatar" });
  assert.equal(result.detectedContentType, "image/jpeg");
  assert.equal((await sharp(result.display.bytes).metadata()).format, "webp");
  assert.equal((await sharp(result.display.bytes).metadata()).exif, undefined);
  assert.equal(result.display.width, 512);
  assert.equal(result.preview.width, 128);
});
