import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

const checksum = "a".repeat(64);
const attachmentId = "avatar-1";
const snapshot = {
  schemaVersion: 4,
  publishedVersionId: "version-1",
  creator: { slug: "adelaide", displayName: "Adelaide", headline: "", bio: "" },
  links: [], actions: [],
  appearance: { themeKey: "thot-noir", buttonStyle: "solid-rounded", backgroundMode: "solid", backgroundColor: "#111111", primaryColor: "#222222", textColor: "#eeeeee", cardColor: "#333333", radiusScale: "comfortable" },
  media: [{ id: attachmentId, href: `https://media.example/media/adelaide/version-1/${attachmentId}`, altText: "", contentType: "image/webp", imageRole: "avatar", checksum }],
};

function environment(value = snapshot, { objectMetadata, objectChecksum = checksum, contentType = "image/webp" } = {}) {
  const keys = [];
  return {
    keys,
    env: {
      PUBLIC_LINKS: { get: async () => value },
      PUBLIC_MEDIA: { get: async (key) => {
        keys.push(key);
        return { body: new Blob(["webp"]), httpMetadata: { contentType }, customMetadata: objectMetadata ?? { creatorSlug: "adelaide", versionId: "version-1", attachmentId, checksum, surface: "public_sfw", imageRole: "avatar" }, checksums: { sha256: Uint8Array.from(objectChecksum.match(/../g) ?? [], (part) => Number.parseInt(part, 16)).buffer } };
      } },
    },
  };
}

test("public media serves only a projected derivative with matching immutable metadata", async () => {
  const { env, keys } = environment();
  const response = await worker.fetch(new Request(`https://media.example/media/adelaide/version-1/${attachmentId}`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(keys, [`public-media/adelaide/version-1/${attachmentId}.webp`]);
});

test("public media rejects private keys, a foreign snapshot URL, and metadata or checksum mismatch", async () => {
  const routes = [
    `https://media.example/media/adelaide/version-1/${attachmentId}?objectKey=profile-private`,
    "https://media.example/media/adelaide/version-1/other",
    `https://media.example/media/adelaide/not-version/${attachmentId}`,
  ];
  for (const route of routes) assert.equal((await worker.fetch(new Request(route), environment().env)).status, 404);
  assert.equal((await worker.fetch(new Request(`https://media.example/media/adelaide/version-1/${attachmentId}`), environment(snapshot, { objectChecksum: "b".repeat(64) }).env)).status, 404);
  assert.equal((await worker.fetch(new Request(`https://media.example/media/adelaide/version-1/${attachmentId}`), environment(snapshot, { objectMetadata: { creatorSlug: "adelaide", versionId: "version-1", attachmentId, checksum, surface: "adult_profile", imageRole: "avatar" } }).env)).status, 404);
});
