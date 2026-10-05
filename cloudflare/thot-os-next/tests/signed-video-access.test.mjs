import assert from "node:assert/strict";
import test from "node:test";
import { createLocalD1, createMemoryR2, loadRouteHandler } from "./helpers/local-media-journey-fixture.mjs";
import { immutableR2IdentityMatches, parseSingleRange } from "../src/lib/source-media-algorithms.ts";

const ASSET_A = "10000000-0000-4000-8000-000000000001";
const ASSET_B = "20000000-0000-4000-8000-000000000002";
const NOT_READY = "30000000-0000-4000-8000-000000000003";
const VIDEO_UID_A = "stream-video-id-a-123";
const VIDEO_UID_B = "stream-video-id-b-123";
const VIDEO_BYTES = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

function noStoreHeaders(extra = {}) {
  return { "cache-control": "private, no-store", "x-content-type-options": "nosniff", ...extra };
}
function noStoreJson(body, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders() });
}
function streamPlaybackAvailable(env) { return env.R2_STREAM_PLAYBACK_ENABLED === "1" && Boolean(env.STREAM); }
function validStreamVideoId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value); }
function streamIframeUrl(details, token) {
  const hls = new URL(details.hlsPlaybackUrl);
  if (hls.protocol !== "https:" || !hls.hostname.endsWith(".cloudflarestream.com")) throw new Error("stream_playback_origin_invalid");
  return `https://${hls.hostname}/${encodeURIComponent(token)}/iframe`;
}

async function fixture() {
  const { db, DB: rawDB } = await createLocalD1();
  let queryCount = 0;
  const DB = {
    prepare(sql) {
      queryCount++;
      const statement = rawDB.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.bind(...args).first(); },
        async run() { const result = await statement.bind(...args).run(); return { meta: { changes: Number(result.meta.changes) } }; },
      };
    },
  };
  const LIBRARY_MEDIA = createMemoryR2();
  let storageReads = 0;
  for (const [creatorId, assetId, playbackState, provider, externalId] of [
    ["creator-a", ASSET_A, "playback_ready", "stream", VIDEO_UID_A],
    ["creator-b", ASSET_B, "playback_ready", "stream", VIDEO_UID_B],
    ["creator-a", NOT_READY, "canonical_verified", "none", null],
  ]) {
    const objectId = `${creatorId}-${assetId}`;
    const objectKey = `originals/v1/${objectId}`;
    const storageId = `storage-${objectId}`;
    await LIBRARY_MEDIA.put(objectKey, VIDEO_BYTES, { httpMetadata: { contentType: "video/mp4" } });
    const metadata = await LIBRARY_MEDIA.head(objectKey);
    db.prepare(`INSERT INTO assets
      (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,source_available,indexed_at)
      VALUES (?,?,?,?,?, ?,CURRENT_TIMESTAMP,'native_direct',1,CURRENT_TIMESTAMP)`)
      .run(assetId, creatorId, `${objectId}.mp4`, `${objectId}.mp4`, "mp4", VIDEO_BYTES.length);
    db.prepare(`INSERT INTO asset_storage_objects
      (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status,r2_version,r2_etag)
      VALUES (?,?,?,'r2','canonical_original','library_media',?,?,?,'video/mp4',?,'m1_direct','verified',?,?)`)
      .run(storageId, creatorId, assetId, objectKey, `${objectId}.mp4`, VIDEO_BYTES.length, "a".repeat(64), metadata.version, metadata.etag);
    db.prepare(`INSERT INTO asset_media_authorities
      (asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state)
      VALUES (?,?,'r2_native','cloudflare_direct',?,'canonical_verified')`)
      .run(assetId, creatorId, storageId);
    db.prepare(`INSERT INTO asset_video_playback_states
      (asset_id,creator_id,canonical_storage_object_id,state,playback_provider,playback_external_id)
      VALUES (?,?,?,?,?,?)`)
      .run(assetId, creatorId, storageId, playbackState, provider, externalId);
  }

  const originalHead = LIBRARY_MEDIA.head.bind(LIBRARY_MEDIA);
  const originalGet = LIBRARY_MEDIA.get.bind(LIBRARY_MEDIA);
  LIBRARY_MEDIA.head = async (...args) => { storageReads++; return originalHead(...args); };
  LIBRARY_MEDIA.get = async (...args) => { storageReads++; return originalGet(...args); };
  let activeCreator = "creator-a";
  let activeRole = "viewer";
  let authenticated = true;
  let requiredPermission = null;
  const requireCreatorContext = async (permission) => {
    requiredPermission = permission ?? "view";
    if (!authenticated) throw new Error("NOT_FOUND");
    return { creator: { creator_id: activeCreator, role: activeRole }, email: `${activeCreator}@example.test` };
  };
  const env = {
    DB, LIBRARY_MEDIA,
    R2_STREAM_PLAYBACK_ENABLED: "1",
    STREAM: { video(id) {
      providerReads++;
      return {
        async details() { return { id, readyToStream: true, requireSignedURLs: true, hlsPlaybackUrl: `https://customer.cloudflarestream.com/${id}/manifest/video.m3u8` }; },
        async generateToken() { tokenCalls++; return "fixture-signed-stream-token"; },
      };
    } },
  };
  let providerReads = 0;
  let tokenCalls = 0;
  const common = { requireCreatorContext, cloudflareEnv: () => env, noStoreJson };
  const download = await loadRouteHandler("src/app/api/source-media/videos/[assetId]/download/route.ts", "GET", {
    ...common, parseSingleRange, immutableR2IdentityMatches, noStoreHeaders,
  });
  const playbackToken = await loadRouteHandler("src/app/api/source-media/videos/[assetId]/playback-token/route.ts", "GET", {
    ...common, streamIframeUrl, streamPlaybackAvailable, validStreamVideoId,
  });
  return {
    db, download, playbackToken,
    setCreator(value) { activeCreator = value; },
    setRole(value) { activeRole = value; },
    setAuthenticated(value) { authenticated = value; },
    get queryCount() { return queryCount; },
    get storageReads() { return storageReads; },
    get providerReads() { return providerReads; },
    get tokenCalls() { return tokenCalls; },
    get requiredPermission() { return requiredPermission; },
    close() { db.close(); },
  };
}

function params(assetId) { return { params: Promise.resolve({ assetId }) }; }
function request(assetId, headers = {}) { return new Request(`https://thot-os.test/api/source-media/videos/${assetId}/download`, { headers }); }

test("video source download is view-scoped, verified, and no-store; foreign and unverified source stay inaccessible", async () => {
  const state = await fixture();
  try {
    const response = await state.download(request(ASSET_A), params(ASSET_A));
    assert.equal(response.status, 200);
    assert.equal(state.requiredPermission, "view", "a read-only viewer may inspect its own source video");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(response.headers.get("content-disposition"), "attachment");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), VIDEO_BYTES);
    assert.equal(state.storageReads, 2, "successful access verifies the canonical object and then fetches it");

    const ranged = await state.download(request(ASSET_A, { range: "bytes=2-5" }), params(ASSET_A));
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("cache-control"), "private, no-store");
    assert.equal(ranged.headers.get("content-range"), `bytes 2-5/${VIDEO_BYTES.length}`);
    assert.deepEqual(new Uint8Array(await ranged.arrayBuffer()), VIDEO_BYTES.slice(2, 6));

    state.setAuthenticated(false);
    const queryBeforeAnonymous = state.queryCount;
    await assert.rejects(state.download(request(ASSET_A), params(ASSET_A)), /NOT_FOUND/);
    assert.equal(state.queryCount, queryBeforeAnonymous, "anonymous access stops before D1 or R2 reads");
    assert.equal(state.storageReads, 4, "anonymous access stops before R2 reads");

    state.setAuthenticated(true);
    state.setCreator("creator-b");
    const storageBeforeForeign = state.storageReads;
    const foreign = await state.download(request(ASSET_A), params(ASSET_A));
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), { ok: false, error: "video_original_unavailable" });
    assert.equal(state.storageReads, storageBeforeForeign, "foreign creator cannot reach R2");

    state.setCreator("creator-a");
    state.db.prepare("UPDATE asset_storage_objects SET ingest_status='pending' WHERE asset_id=?").run(ASSET_A);
    const missingVerified = await state.download(request(ASSET_A), params(ASSET_A));
    assert.equal(missingVerified.status, 404);
    assert.deepEqual(await missingVerified.json(), { ok: false, error: "video_original_unavailable" });
    assert.equal(state.storageReads, storageBeforeForeign, "unverified original does not reach R2");
  } finally { state.close(); }
});

test("Stream playback token is view-scoped, creator-bound, readiness-gated, and no-store", async () => {
  const state = await fixture();
  try {
    const response = await state.playbackToken(request(ASSET_A), params(ASSET_A));
    assert.equal(response.status, 200);
    assert.equal(state.requiredPermission, "view", "a viewer may play a ready video in its workspace");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.iframeUrl, "https://customer.cloudflarestream.com/fixture-signed-stream-token/iframe");
    assert.equal(state.providerReads, 1);
    assert.equal(state.tokenCalls, 1);

    state.setAuthenticated(false);
    const queryBeforeAnonymous = state.queryCount;
    await assert.rejects(state.playbackToken(request(ASSET_A), params(ASSET_A)), /NOT_FOUND/);
    assert.equal(state.queryCount, queryBeforeAnonymous, "anonymous access stops before D1 and Stream");
    assert.equal(state.providerReads, 1);

    state.setAuthenticated(true);
    state.setCreator("creator-b");
    const foreign = await state.playbackToken(request(ASSET_A), params(ASSET_A));
    assert.equal(foreign.status, 409);
    assert.deepEqual(await foreign.json(), { ok: false, error: "playback_not_ready" });
    assert.equal(state.providerReads, 1, "foreign asset never reaches Stream");

    state.setCreator("creator-a");
    const unready = await state.playbackToken(request(NOT_READY), params(NOT_READY));
    assert.equal(unready.status, 409);
    assert.deepEqual(await unready.json(), { ok: false, error: "playback_not_ready" });
    assert.equal(state.providerReads, 1, "non-ready playback never reaches Stream");
  } finally { state.close(); }
});
