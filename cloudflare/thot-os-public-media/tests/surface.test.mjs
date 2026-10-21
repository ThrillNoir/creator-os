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

test("v5 gallery media requires its ordered projection and exact copied metadata", async () => {
  const projected = structuredClone(snapshot);
  projected.schemaVersion = 5;
  projected.media[0].position = 0;
  projected.media.push({ id: "gallery-2", href: "https://media.example/media/adelaide/version-1/gallery-2", altText: "", contentType: "image/webp", imageRole: "gallery", checksum, position: 1 });
  const route = "https://media.example/media/adelaide/version-1/gallery-2";
  const metadata = { creatorSlug: "adelaide", versionId: "version-1", attachmentId: "gallery-2", checksum, surface: "public_sfw", imageRole: "gallery" };
  assert.equal((await worker.fetch(new Request(route), environment(projected, { objectMetadata: metadata }).env)).status, 200);
  projected.media[1].position = 0;
  assert.equal((await worker.fetch(new Request(route), environment(projected, { objectMetadata: metadata }).env)).status, 404);
  projected.media[1].position = 1;
  projected.media[1].id = attachmentId;
  projected.media[1].href = `https://media.example/media/adelaide/version-1/${attachmentId}`;
  assert.equal((await worker.fetch(new Request(`https://media.example/media/adelaide/version-1/${attachmentId}`), environment(projected).env)).status, 404);
  projected.media[1].id = "gallery-2";
  projected.media[1].href = route;
  assert.equal((await worker.fetch(new Request(route), environment(projected, { objectMetadata: { ...metadata, imageRole: "avatar" } }).env)).status, 404);
});

test("live media serves only configured creators and redirects its legacy host", async () => {
  const projected = structuredClone(snapshot);
  projected.media[0].href = `https://www.thathuboverthere.com/media/adelaide/version-1/${attachmentId}`;
  const live = environment(projected).env;
  live.LIVE_PUBLIC_CREATOR_SLUGS = "adelaide";
  assert.equal((await worker.fetch(new Request(`https://www.thathuboverthere.com/media/adelaide/version-1/${attachmentId}`), live)).status, 200);
  assert.equal((await worker.fetch(new Request(`https://www.thathuboverthere.com/media/fixture/version-1/${attachmentId}`), live)).status, 404);
  const moved = await worker.fetch(new Request(`https://public-profile-staging.thathuboverthere.com/media/adelaide/version-1/${attachmentId}?download=1`), live);
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get("location"), `https://www.thathuboverthere.com/media/adelaide/version-1/${attachmentId}?download=1`);
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

test("public media rejects malformed creators and serves no cacheable error responses", async () => {
  const invalid = structuredClone(snapshot);
  invalid.creator = { slug: "adelaide" };
  const response = await worker.fetch(new Request(`https://media.example/media/adelaide/version-1/${attachmentId}`), environment(invalid).env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const method = await worker.fetch(new Request(`https://media.example/media/adelaide/version-1/${attachmentId}`, { method: "POST" }), environment().env);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("cache-control"), "no-store");
});

test("public media rejects reserved creator slugs before reading the projected object", async () => {
  const reserved = structuredClone(snapshot);
  reserved.creator.slug = "messages";
  reserved.media[0].href = `https://media.example/media/messages/version-1/${attachmentId}`;
  const { env, keys } = environment(reserved, { objectMetadata: { creatorSlug: "messages", versionId: "version-1", attachmentId, checksum, surface: "public_sfw", imageRole: "avatar" } });
  const response = await worker.fetch(new Request(`https://media.example/media/messages/version-1/${attachmentId}`), env);
  assert.equal(response.status, 404);
  assert.deepEqual(keys, []);
});
