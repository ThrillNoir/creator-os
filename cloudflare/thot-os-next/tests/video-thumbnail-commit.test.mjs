import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { handleVideoThumbnailCommit } from "../src/lib/video-thumbnail-commit.ts";

const ASSET = "11111111-1111-4111-8111-111111111111";
const TOKEN = "synthetic-service-token-with-at-least-forty-characters-123";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const hex = (value) => createHash("sha256").update(value).digest("hex");
const posterKey = `creators/creator-one/assets/${hex(`creator-one:${ASSET}`)}/previews/${hex(JPEG)}.jpg`;
const source = { key: "originals/v1/synthetic", revision: "native:synthetic", version: "version-one",
  etag: "etag-one", bytes: 100, codec: "h265" };

function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,preview_r2_key TEXT,source_available INTEGER);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,canonical_storage_object_id TEXT);
    CREATE TABLE asset_video_playback_states(asset_id TEXT,creator_id TEXT,canonical_storage_object_id TEXT,state TEXT,source_codec TEXT);
    CREATE TABLE asset_storage_objects(id TEXT,asset_id TEXT,creator_id TEXT,provider TEXT,storage_role TEXT,bucket_role TEXT,
      ingest_status TEXT,object_key TEXT,source_revision TEXT,r2_etag TEXT,r2_version TEXT,byte_count INTEGER);
    CREATE TABLE service_principals(id TEXT,principal_name TEXT,status TEXT);
    CREATE TABLE service_principal_credentials(id TEXT,service_principal_id TEXT,token_hash TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE service_principal_creator_grants(service_principal_id TEXT,creator_id TEXT,status TEXT,capability TEXT);
    CREATE TABLE identity_audit_events(id TEXT,creator_id TEXT,actor_email TEXT,actor_role TEXT,event_type TEXT,subject TEXT,detail TEXT);
    INSERT INTO assets VALUES ('${ASSET}','creator-one',NULL,1);
    INSERT INTO asset_media_authorities VALUES ('${ASSET}','creator-one','r2_native','canonical_verified','storage-one');
    INSERT INTO asset_video_playback_states VALUES ('${ASSET}','creator-one','storage-one','canonical_verified','h265');
    INSERT INTO asset_storage_objects VALUES ('storage-one','${ASSET}','creator-one','r2','canonical_original','library_media',
      'verified','originals/v1/synthetic','native:synthetic','etag-one','version-one',100);
    INSERT INTO service_principals VALUES ('principal-one','thot-os-thumbnail-runner','active');
    INSERT INTO service_principal_credentials VALUES ('credential-one','principal-one','${hex(TOKEN)}','active',NULL);
    INSERT INTO service_principal_creator_grants VALUES ('principal-one','creator-one','active','library.thumbnail.commit');`);
  const prepare = (sql) => ({ bind(...params) { const stmt = sqlite.prepare(sql); return {
    async first() { return stmt.get(...params) ?? null; },
    async all() { return { results: stmt.all(...params) }; },
    async run() { return { meta: { changes: stmt.run(...params).changes } }; },
    runSync() { return { meta: { changes: stmt.run(...params).changes } }; },
  }; } });
  const DB = { prepare, async batch(statements) {
    return sqlite.transaction(() => statements.map((statement) => statement.runSync()))();
  } };
  let heads = 0; let gets = 0;
  let beforeGet;
  const object = { key: posterKey, size: JPEG.length, etag: "poster-etag", version: "poster-version",
    httpMetadata: { contentType: "image/jpeg" }, customMetadata: { creator_id: "creator-one",
      asset_id: ASSET, derivative: "video_poster_v1" } };
  const PREVIEWS = {
    async head(key) { heads++; return key === posterKey ? object : null; },
    async get(key, { onlyIf } = {}) {
      gets++;
      beforeGet?.();
      if (key !== posterKey || onlyIf?.etagMatches !== object.etag) return null;
      return { ...object, body: true, async arrayBuffer() { return JPEG.buffer.slice(0); } };
    },
  };
  return { sqlite, env: { DB, PREVIEWS }, get heads() { return heads; }, get gets() { return gets; },
    set beforeGet(callback) { beforeGet = callback; }, close() { sqlite.close(); } };
}

function request(input = {}, { token = TOKEN, capability = "library.thumbnail.commit" } = {}) {
  return new Request("https://staging.invalid/api/internal/video-thumbnail/commit", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
      "x-thot-os-service-capability": capability },
    body: JSON.stringify({ creatorId: "creator-one", assetId: ASSET, source, posterKey, ...input }) });
}

test("authenticated scoped commit, replay and audit change only the missing poster reference", async () => {
  const f = fixture();
  try {
    const first = await handleVideoThumbnailCommit(request(), f.env);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, "committed");
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets WHERE id=?").get(ASSET).preview_r2_key, posterKey);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM identity_audit_events").get().n, 1);
    const replay = await handleVideoThumbnailCommit(request(), f.env);
    assert.equal((await replay.json()).status, "already_committed");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM identity_audit_events").get().n, 1);
    assert.equal(f.heads, 1);
    assert.equal(f.gets, 1);
  } finally { f.close(); }
});

test("missing grant, wrong service token or capability never accesses the poster", async () => {
  const f = fixture();
  try {
    for (const req of [request({}, { token: "synthetic-wrong-token-with-at-least-forty-characters" }),
      request({}, { capability: "portfolio.publish" }),
      request({ creatorId: "creator-two", posterKey: posterKey.replace("creator-one", "creator-two") })]) {
      assert.equal((await handleVideoThumbnailCommit(req, f.env)).status, 404);
    }
    assert.equal(f.heads, 0);
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, null);
  } finally { f.close(); }
});

test("malformed and oversized requests fail before authorization or storage reads", async () => {
  const f = fixture();
  try {
    for (const input of [{ extra: true }, { source: { ...source, codec: "unknown" } },
      { source: { ...source, bytes: -1 } }, { posterKey: "other-key.jpg" }]) {
      assert.equal((await handleVideoThumbnailCommit(request(input), f.env)).status, 400);
    }
    const oversized = new Request("https://staging.invalid/api/internal/video-thumbnail/commit", {
      method: "POST", headers: { "Content-Type": "application/json", "content-length": "4097",
        Authorization: `Bearer ${TOKEN}`, "x-thot-os-service-capability": "library.thumbnail.commit" }, body: "{}",
    });
    assert.equal((await handleVideoThumbnailCommit(oversized, f.env)).status, 413);
    assert.equal(f.heads, 0);
  } finally { f.close(); }
});

test("unauthenticated and stalled request bodies cannot hold the endpoint indefinitely", async () => {
  const f = fixture();
  try {
    const stalled = () => new ReadableStream({ start() {} });
    const absentToken = new Request("https://staging.invalid/api/internal/video-thumbnail/commit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: stalled(), duplex: "half",
    });
    assert.equal((await handleVideoThumbnailCommit(absentToken, f.env, { bodyTimeoutMs: 20 })).status, 404);
    const slowValidToken = new Request("https://staging.invalid/api/internal/video-thumbnail/commit", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`,
        "x-thot-os-service-capability": "library.thumbnail.commit" }, body: stalled(), duplex: "half",
    });
    assert.equal((await handleVideoThumbnailCommit(slowValidToken, f.env, { bodyTimeoutMs: 20 })).status, 408);
    assert.equal(f.heads, 0);
  } finally { f.close(); }
});

test("changed source and selected manual poster fail without overwriting it", async () => {
  const f = fixture();
  try {
    f.sqlite.prepare("UPDATE asset_storage_objects SET r2_version='new-version'").run();
    assert.equal((await handleVideoThumbnailCommit(request(), f.env)).status, 409);
    assert.equal(f.heads, 0);
    f.sqlite.prepare("UPDATE asset_storage_objects SET r2_version='version-one'").run();
    f.sqlite.prepare("UPDATE assets SET preview_r2_key='manual-poster.jpg'").run();
    const manual = await handleVideoThumbnailCommit(request(), f.env);
    assert.equal(manual.status, 409);
    assert.equal((await manual.json()).error, "poster_already_selected");
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, "manual-poster.jpg");
  } finally { f.close(); }
});

test("manual selection racing after poster fetch wins the conditional update", async () => {
  const f = fixture();
  try {
    f.beforeGet = () => f.sqlite.prepare("UPDATE assets SET preview_r2_key='manual-race.jpg'").run();
    const result = await handleVideoThumbnailCommit(request(), f.env);
    assert.equal(result.status, 409);
    assert.equal((await result.json()).error, "poster_already_selected");
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, "manual-race.jpg");
  } finally { f.close(); }
});

test("source changing during poster fetch prevents the conditional update", async () => {
  const f = fixture();
  try {
    f.beforeGet = () => f.sqlite.prepare("UPDATE asset_storage_objects SET r2_etag='new-etag'").run();
    const result = await handleVideoThumbnailCommit(request(), f.env);
    assert.equal(result.status, 409);
    assert.equal((await result.json()).error, "source_changed");
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, null);
  } finally { f.close(); }
});

test("poster key and object metadata must match creator, asset, JPEG bytes and source", async () => {
  const f = fixture();
  try {
    const badKey = posterKey.replace(hex(JPEG), "0".repeat(64));
    assert.equal((await handleVideoThumbnailCommit(request({ posterKey: badKey }), f.env)).status, 409);
    f.env.PREVIEWS.head = async () => ({ key: posterKey, size: JPEG.length, etag: "poster-etag", version: "poster-version",
      httpMetadata: { contentType: "image/jpeg" }, customMetadata: { creator_id: "creator-two",
        asset_id: ASSET, derivative: "video_poster_v1" } });
    assert.equal((await handleVideoThumbnailCommit(request(), f.env)).status, 409);
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, null);
  } finally { f.close(); }
});
