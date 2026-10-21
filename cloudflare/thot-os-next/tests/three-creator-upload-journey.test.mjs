import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { detectedMime, expectedPartBytes, multipartPartSize, SOURCE_MEDIA_MAX_IMAGE_BYTES,
  SOURCE_MEDIA_MAX_IMAGE_DIMENSION, SOURCE_MEDIA_MAX_IMAGE_PIXELS, SOURCE_MEDIA_MAX_VIDEO_BYTES } from "../src/lib/source-media-algorithms.ts";
import { IsoBmffValidator } from "../src/lib/iso-bmff-validator.ts";
import { createHashValidator, createLocalD1, createMemoryR2, loadRouteHandler, noStoreJson, ownPng } from "./helpers/local-media-journey-fixture.mjs";

const creators = ["creator-a", "creator-b", "creator-c"];
const imageHash = createHash("sha256").update(ownPng).digest("hex");
const imageMime = "image/png";
const source = readFile(new URL("../src/lib/source-media.ts", import.meta.url), "utf8");
function request(path, body, contentType = "application/json") {
  return new Request(`https://local.example.test${path}`, {
    method: "POST", headers: { origin: "https://local.example.test", "content-type": contentType }, body,
  });
}

test("three synthetic creator uploads use real intent, part and finalize routes without crossing scopes", async () => {
  const { db, DB } = await createLocalD1();
  db.prepare("INSERT INTO creators(id,name,slug,initials) VALUES ('creator-c','Synthetic C','synthetic-c','C')").run();
  const libraryMedia = createMemoryR2();
  const previews = createMemoryR2();
  let activeCreator = creators[0];
  const env = {
    DB, LIBRARY_MEDIA: libraryMedia, PREVIEWS: previews,
    IMAGES: { info: async () => ({ width: 64, height: 64, format: imageMime }) },
    PREVIEW_QUEUE: { send: async () => {} },
  };
  const dependencies = {
    isSameOriginRequest: (input) => input.headers.get("origin") === "https://local.example.test",
    noStoreJson,
    requireCreatorContext: async () => ({ creator: { creator_id: activeCreator, role: "creator" }, email: `${activeCreator}@example.invalid` }),
    cloudflareEnv: () => env,
    humanAuditActor: () => ({ actor: "synthetic-creator", role: "creator" }),
    identityAuditStatement: (database, _actor, eventType) => database.prepare("INSERT INTO fixture_audit(event) VALUES(?)").bind(eventType),
    rejectClientActorRole: () => {},
    nativeImageDetails: (name, mime) => name.endsWith(".png") && mime === imageMime ? { filename: name, extension: "png", mimeType: mime } : null,
    validClientUploadId: (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
    isSha256: (value) => /^[a-f0-9]{64}$/.test(value),
    multipartPartSize,
    expectedPartBytes,
    validSourceFilename: (value) => typeof value === "string" && value.length > 0 && !/[\\/]/.test(value),
    privateOriginalKey: () => `synthetic-private/${crypto.randomUUID()}`,
    safeFailureCode: () => "synthetic_failure",
    SOURCE_MEDIA_MAX_IMAGE_BYTES,
    SOURCE_MEDIA_SESSION_MINUTES: 30,
    buildNativeImageTerminalStatements: () => [],
    createNativeImagePreview: async ({ libraryMedia: sourceBucket, previews: previewBucket, objectKey, expectedEtag, creatorId, sourceSha256 }) => {
      const original = await sourceBucket.get(objectKey, { onlyIf: { etagMatches: expectedEtag } });
      assert.deepEqual(new Uint8Array(await original.arrayBuffer()), ownPng);
      const previewKey = `creators/${creatorId}/assets/${sourceSha256}/previews/${sourceSha256}.jpg`;
      await previewBucket.put(previewKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])); // synthetic derivative stub
      return { objectKey: previewKey, width: 64, height: 64 };
    },
  };
  const hashAndValidateR2Object = await createHashValidator(await source, {
    detectedMime, IsoBmffValidator,
    constants: { SOURCE_MEDIA_MAX_IMAGE_BYTES, SOURCE_MEDIA_MAX_IMAGE_DIMENSION, SOURCE_MEDIA_MAX_IMAGE_PIXELS, SOURCE_MEDIA_MAX_VIDEO_BYTES },
  });
  const imageIntent = await loadRouteHandler("src/app/api/source-media/native/intents/route.ts", "POST", dependencies);
  const imagePart = await loadRouteHandler("src/app/api/source-media/intents/[sessionId]/parts/[partNumber]/route.ts", "PUT", dependencies);
  const imageFinalize = await loadRouteHandler("src/app/api/source-media/intents/[sessionId]/finalize/route.ts", "POST", { ...dependencies, hashAndValidateR2Object });
  try {
    const tooLarge = await imageIntent(request("/api/source-media/native/intents", JSON.stringify({
      filename: "oversize.png", bytes: SOURCE_MEDIA_MAX_IMAGE_BYTES + 1, sha256: imageHash,
      mimeType: imageMime, clientUploadId: crypto.randomUUID(),
    })));
    assert.equal(tooLarge.status, 400, "oversized declared input is rejected before storage");
    const sessions = [];
    for (const creatorId of creators) {
      activeCreator = creatorId;
      const response = await imageIntent(request("/api/source-media/native/intents", JSON.stringify({
        filename: "synthetic.png", bytes: ownPng.length, sha256: imageHash,
        mimeType: imageMime, clientUploadId: crypto.randomUUID(),
      })));
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      const { sessionId, assetId } = await response.json();
      sessions.push({ creatorId, sessionId, assetId });
      const part = await imagePart(new Request(`https://local.example.test/api/source-media/intents/${sessionId}/parts/1`, {
        method: "PUT", headers: { origin: "https://local.example.test", "content-type": imageMime, "content-length": String(ownPng.length) }, body: ownPng,
      }), { params: Promise.resolve({ sessionId, partNumber: "1" }) });
      assert.equal(part.status, 200);
      const finalized = await imageFinalize(request(`/api/source-media/intents/${sessionId}/finalize`), { params: Promise.resolve({ sessionId }) });
      assert.equal(finalized.status, 200, JSON.stringify(await finalized.clone().json()));
      assert.equal((await finalized.json()).preview, "ready");
      const row = await DB.prepare("SELECT a.creator_id,ma.state,a.preview_r2_key FROM assets a JOIN asset_media_authorities ma ON ma.asset_id=a.id WHERE a.id=?").bind(assetId).first();
      assert.equal(row.creator_id, creatorId);
      assert.equal(row.state, "preview_ready");
      assert.match(row.preview_r2_key, new RegExp(`^creators/${creatorId}/assets/`));
    }
    activeCreator = creators[0];
    const foreign = await imageFinalize(request(`/api/source-media/intents/${sessions[1].sessionId}/finalize`), {
      params: Promise.resolve({ sessionId: sessions[1].sessionId }),
    });
    assert.equal(foreign.status, 404);
    assert.equal((await DB.prepare("SELECT COUNT(DISTINCT creator_id) AS count FROM asset_media_authorities WHERE authority_kind='r2_native'").first()).count, 3);
  } finally { db.close(); }
});
