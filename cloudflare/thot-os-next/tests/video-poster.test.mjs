import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { preparePrivateVideoPoster, readVideoPosterUpload, VIDEO_POSTER_MAX_BYTES } from "../src/lib/video-poster.ts";
import { privatePortfolioImageObjectId } from "../src/lib/portfolio-preview.ts";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, ...new Uint8Array(8)]);
const hash = (value) => createHash("sha256").update(value).digest("hex");

function imagesFixture() {
  return {
    async info(stream) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      assert.deepEqual(bytes, jpeg);
      return { format: "image/jpeg", width: 1, height: 1, fileSize: bytes.length };
    },
    input(stream) {
      return {
        transform(options) {
          assert.deepEqual(options, { width: 960, height: 960, fit: "scale-down" });
          return {
            output(options) {
              assert.deepEqual(options, { format: "image/jpeg", quality: 84, anim: false });
              return { image: () => stream };
            },
          };
        },
      };
    },
  };
}

test("private video poster uses a creator and asset scoped revisioned key", async () => {
  const poster = await preparePrivateVideoPoster({
    images: imagesFixture(), bytes: jpeg, contentType: "image/jpeg", creatorId: "creator-a", assetId: "video-a",
  });
  const objectId = hash("creator-a:video-a");
  assert.equal(poster.key, `creators/creator-a/assets/${objectId}/previews/${hash(jpeg)}.jpg`);
  assert.equal(privatePortfolioImageObjectId(poster.key), objectId);
  assert.deepEqual(poster.bytes, jpeg);
  assert.deepEqual([poster.width, poster.height], [1, 1]);
  assert.notEqual(objectId, hash("creator-b:video-a"));
});

test("poster upload rejects empty and oversized bodies before image processing", async () => {
  const valid = new Request("http://localhost/poster", { method: "POST", body: jpeg });
  assert.deepEqual(await readVideoPosterUpload(valid), jpeg);
  await assert.rejects(readVideoPosterUpload(new Request("http://localhost/poster", { method: "POST", body: "" })), /poster_empty/);
  const tooLarge = new Request("http://localhost/poster", { method: "POST", body: jpeg,
    headers: { "content-length": String(VIDEO_POSTER_MAX_BYTES + 1) } });
  await assert.rejects(readVideoPosterUpload(tooLarge), /poster_too_large/);
  await assert.rejects(preparePrivateVideoPoster({
    images: imagesFixture(), bytes: jpeg, contentType: "image/png", creatorId: "creator-a", assetId: "video-a",
  }), /image type does not match/);
});
