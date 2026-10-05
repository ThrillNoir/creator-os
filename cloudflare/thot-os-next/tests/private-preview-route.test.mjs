import assert from "node:assert/strict";
import test from "node:test";
import { createLocalD1, createMemoryR2, loadRouteHandler } from "./helpers/local-media-journey-fixture.mjs";

const OBJECT_ID = "a".repeat(64);
const DERIVATIVE_HASH = "b".repeat(64);
const PREVIEW_KEY = `creators/creator-a/assets/${OBJECT_ID}/previews/${DERIVATIVE_HASH}.jpg`;
const PREVIEW_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

async function fixture() {
  const { db, DB: rawDB } = await createLocalD1();
  let queryCount = 0;
  const DB = {
    prepare(sql) {
      queryCount++;
      return rawDB.prepare(sql);
    },
  };
  const previews = createMemoryR2();
  await previews.put(PREVIEW_KEY, PREVIEW_BYTES, { httpMetadata: { contentType: "image/jpeg" } });
  const originalGet = previews.get.bind(previews);
  let previewReads = 0;
  previews.get = async (...args) => { previewReads++; return originalGet(...args); };

  for (const creatorId of ["creator-a", "creator-b"]) {
    const assetId = `${creatorId}-asset`;
    const objectId = creatorId === "creator-a" ? OBJECT_ID : "c".repeat(64);
    const previewKey = `creators/${creatorId}/assets/${objectId}/previews/${DERIVATIVE_HASH}.jpg`;
    const storageId = `${creatorId}-storage`;
    db.prepare(`INSERT INTO assets
      (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,source_available,indexed_at,preview_r2_key)
      VALUES (?,?,?,?,'jpg',4,CURRENT_TIMESTAMP,'native_direct',1,CURRENT_TIMESTAMP,?)`)
      .run(assetId, creatorId, `${assetId}.jpg`, `${assetId}.jpg`, previewKey);
    db.prepare(`INSERT INTO asset_storage_objects
      (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status,r2_version,r2_etag)
      VALUES (?,?,?,'r2','canonical_original','library_media',?, ?,4,'image/jpeg',?,'m1_direct','verified','version-1','etag-1')`)
      .run(storageId, creatorId, assetId, `${creatorId}/original`, `${assetId}.jpg`, OBJECT_ID);
    db.prepare(`INSERT INTO asset_media_authorities
      (asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state)
      VALUES (?,?,'r2_native','cloudflare_direct',?,'preview_ready')`)
      .run(assetId, creatorId, storageId);
  }

  let activeCreator = "creator-a";
  let authenticated = true;
  const handler = await loadRouteHandler("src/app/api/preview/[objectId]/route.ts", "GET", {
    requireCreatorContext: async () => {
      if (!authenticated) throw new Error("NOT_FOUND");
      return { creator: { creator_id: activeCreator } };
    },
    cloudflareEnv: () => ({ DB, PREVIEWS: previews }),
  });
  return {
    db, handler,
    setCreator(value) { activeCreator = value; },
    setAuthenticated(value) { authenticated = value; },
    get queryCount() { return queryCount; },
    get previewReads() { return previewReads; },
    close() { db.close(); },
  };
}

test("private creator preview is no-store and lookup denies unauthenticated and foreign creators", async () => {
  const state = await fixture();
  try {
    const response = await state.handler(new Request("https://thot-os.test/api/preview/" + OBJECT_ID), {
      params: Promise.resolve({ objectId: OBJECT_ID }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PREVIEW_BYTES);
    assert.equal(state.queryCount, 1);
    assert.equal(state.previewReads, 1);

    state.setAuthenticated(false);
    const priorQueries = state.queryCount;
    await assert.rejects(state.handler(new Request("https://thot-os.test/api/preview/" + OBJECT_ID), {
      params: Promise.resolve({ objectId: OBJECT_ID }),
    }), /NOT_FOUND/);
    assert.equal(state.queryCount, priorQueries, "unauthenticated request stops before private D1 or R2 reads");
    assert.equal(state.previewReads, 1);

    state.setAuthenticated(true);
    state.setCreator("creator-b");
    const foreign = await state.handler(new Request("https://thot-os.test/api/preview/" + OBJECT_ID), {
      params: Promise.resolve({ objectId: OBJECT_ID }),
    });
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), { ok: false, error: "not_found" });
    assert.equal(state.previewReads, 1, "foreign ID does not reach R2");
  } finally {
    state.close();
  }
});
