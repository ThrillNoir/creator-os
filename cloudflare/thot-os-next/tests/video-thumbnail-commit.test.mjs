import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { handleVideoThumbnailCommit } from "../src/lib/video-thumbnail-commit.ts";

const ASSET = "11111111-1111-4111-8111-111111111111";
const TOKEN = "synthetic-service-token-with-at-least-forty-characters-123";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]);
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
    runSync() { return { meta: { changes: stmt.run(...params).changes } }; },
  }; } });
  const DB = { prepare, async batch(statements) { return sqlite.transaction(() => statements.map((s) => s.runSync()))(); } };
  const objects = new Map();
  let puts = 0; let gets = 0; let sourceHeads = 0; let beforePut; let beforeBatch;
  const PREVIEWS = {
    async head(key) { return objects.get(key) ?? null; },
    async put(key, bytes, options) {
      puts++; beforePut?.();
      if (objects.has(key)) return null;
      const object = { key, etag: "poster-etag", size: bytes.length, httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata, bytes: Uint8Array.from(bytes) };
      objects.set(key, object);
      return object;
    },
    async get(key, { onlyIf } = {}) {
      gets++;
      const object = objects.get(key);
      return object && onlyIf?.etagMatches === object.etag
        ? { ...object, body: true, async arrayBuffer() { return Uint8Array.from(object.bytes).buffer; } } : null;
    },
  };
  const LIBRARY_MEDIA = { async head(key) { sourceHeads++; return key === source.key
    ? { key, version: source.version, etag: source.etag, size: source.bytes } : null; } };
  const IMAGES = { async info() { return { format: "image/jpeg", width: 320, height: 180 }; } };
  const env = { DB: { ...DB, async batch(statements) { beforeBatch?.(); return DB.batch(statements); } }, PREVIEWS, LIBRARY_MEDIA, IMAGES };
  return { sqlite, env, objects, get puts() { return puts; }, get gets() { return gets; },
    get sourceHeads() { return sourceHeads; }, set beforePut(fn) { beforePut = fn; },
    set beforeBatch(fn) { beforeBatch = fn; }, close() { sqlite.close(); } };
}
function request(input = {}, { token = TOKEN, capability = "library.thumbnail.commit" } = {}) {
  return new Request("https://staging.invalid/api/internal/video-thumbnail/commit", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
      "x-thot-os-service-capability": capability, "x-thot-os-creator-id": "creator-one" },
    body: JSON.stringify({ creatorId: "creator-one", assetId: ASSET, source,
      contentType: "image/jpeg", posterBase64: Buffer.from(JPEG).toString("base64"), ...input }) });
}

test("scoped JPEG commit is conditional, idempotent, and audited once", async () => {
  const f = fixture();
  try {
    assert.equal((await (await handleVideoThumbnailCommit(request(), f.env)).json()).status, "committed");
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, posterKey);
    assert.equal(f.puts, 1);
    assert.equal((await (await handleVideoThumbnailCommit(request(), f.env)).json()).status, "already_committed");
    assert.equal(f.puts, 1); assert.equal(f.gets, 1);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM identity_audit_events").get().n, 1);
  } finally { f.close(); }
});

test("unauthorized token, capability, and foreign creator cannot read source or write poster", async () => {
  const f = fixture();
  try {
    for (const req of [request({}, { token: "synthetic-wrong-token-with-at-least-forty-characters" }),
      request({}, { capability: "portfolio.publish" }), request({ creatorId: "creator-two" })])
      assert.equal((await handleVideoThumbnailCommit(req, f.env)).status, 404);
    assert.equal(f.sourceHeads, 0); assert.equal(f.puts, 0);
  } finally { f.close(); }
});

test("invalid shape, arbitrary key, malformed JPEG, and oversized body are rejected", async () => {
  const f = fixture();
  try {
    for (const input of [{ extra: true }, { posterKey: "arbitrary.jpg" },
      { source: { ...source, codec: "unknown" } }, { posterBase64: Buffer.from("not a jpeg").toString("base64") },
      { posterBase64: "not-base64" }, { contentType: "image/png" }])
      assert.equal((await handleVideoThumbnailCommit(request(input), f.env)).status, 400);
    const oversized = request(); oversized.headers.set("content-length", String(20 * 1024 * 1024));
    assert.equal((await handleVideoThumbnailCommit(oversized, f.env)).status, 413);
    assert.equal(f.puts, 0);
  } finally { f.close(); }
});

test("unauthenticated and stalled bodies cannot hold the endpoint", async () => {
  const f = fixture();
  try {
    const stalled = () => new ReadableStream({ start() {} });
    const absent = new Request("https://staging.invalid/api/internal/video-thumbnail/commit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: stalled(), duplex: "half" });
    assert.equal((await handleVideoThumbnailCommit(absent, f.env, { bodyTimeoutMs: 20 })).status, 404);
    const slow = new Request("https://staging.invalid/api/internal/video-thumbnail/commit", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`,
        "x-thot-os-service-capability": "library.thumbnail.commit", "x-thot-os-creator-id": "creator-one" }, body: stalled(), duplex: "half" });
    assert.equal((await handleVideoThumbnailCommit(slow, f.env, { bodyTimeoutMs: 20 })).status, 408);
  } finally { f.close(); }
});

test("source identity change and manual selection prevent poster storage", async () => {
  const f = fixture();
  try {
    f.sqlite.prepare("UPDATE asset_storage_objects SET r2_version='changed'").run();
    assert.equal((await handleVideoThumbnailCommit(request(), f.env)).status, 409);
    f.sqlite.prepare("UPDATE asset_storage_objects SET r2_version='version-one'").run();
    f.env.LIBRARY_MEDIA.head = async () => ({ key: source.key, version: "changed", etag: source.etag, size: source.bytes });
    assert.equal((await handleVideoThumbnailCommit(request(), f.env)).status, 409);
    f.sqlite.prepare("UPDATE assets SET preview_r2_key='manual.jpg'").run();
    assert.equal((await (await handleVideoThumbnailCommit(request(), f.env)).json()).error, "poster_already_selected");
    assert.equal(f.puts, 0);
  } finally { f.close(); }
});

test("manual and source races after conditional put win the D1 CAS; orphan is retained safely", async () => {
  for (const [sql, expected] of [["UPDATE assets SET preview_r2_key='manual-race.jpg'", "poster_already_selected"],
    ["UPDATE asset_storage_objects SET r2_etag='changed'", "source_changed"]]) {
    const f = fixture();
    try {
      f.beforeBatch = () => f.sqlite.prepare(sql).run();
      assert.equal((await (await handleVideoThumbnailCommit(request(), f.env)).json()).error, expected);
      assert.equal(f.puts, 1); assert.equal(f.objects.size, 1);
      assert.notEqual(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, posterKey);
    } finally { f.close(); }
  }
});

test("storage failure, D1 failure and existing-key mismatch fail closed", async () => {
  const f = fixture();
  try {
    f.env.PREVIEWS.put = async () => { throw new Error("storage failed"); };
    assert.equal((await handleVideoThumbnailCommit(request(), f.env)).status, 503);
    f.env.PREVIEWS.put = async (key, bytes, options) => {
      f.objects.set(key, { key, etag: "poster-etag", size: bytes.length, httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata, bytes: Uint8Array.from(bytes) }); return f.objects.get(key); };
    f.env.DB.batch = async () => { throw new Error("D1 failed"); };
    assert.equal((await (await handleVideoThumbnailCommit(request(), f.env)).json()).error, "commit_uncertain");
    assert.equal(f.objects.size, 1);
    f.objects.get(posterKey).bytes[5] ^= 1;
    assert.equal((await (await handleVideoThumbnailCommit(request(), f.env)).json()).error, "poster_invalid");
  } finally { f.close(); }
});

test("conditional put collision reuses only identical existing bytes and never overwrites", async () => {
  for (const mismatch of [false, true]) {
    const f = fixture();
    try {
      f.env.PREVIEWS.put = async (key, bytes, options) => {
        assert.equal(options.onlyIf.etagDoesNotMatch, "*");
        const existingBytes = Uint8Array.from(bytes);
        if (mismatch) existingBytes[5] ^= 1;
        f.objects.set(key, { key, etag: "winning-etag", size: bytes.length,
          httpMetadata: options.httpMetadata, customMetadata: options.customMetadata, bytes: existingBytes });
        return null;
      };
      const result = await handleVideoThumbnailCommit(request(), f.env);
      assert.equal(result.status, mismatch ? 409 : 200);
      assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key,
        mismatch ? null : posterKey);
    } finally { f.close(); }
  }
});

test("R2 original changing after poster upload prevents the reference update", async () => {
  const f = fixture();
  try {
    let heads = 0;
    f.env.LIBRARY_MEDIA.head = async (key) => ({ key, version: ++heads === 1 ? source.version : "changed",
      etag: source.etag, size: source.bytes });
    const result = await handleVideoThumbnailCommit(request(), f.env);
    assert.equal((await result.json()).error, "source_changed");
    assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets").get().preview_r2_key, null);
    assert.equal(f.objects.size, 1);
  } finally { f.close(); }
});
