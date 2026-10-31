import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createVideoThumbnailStorageAdapter, runVideoThumbnailBatch } from "../scripts/video-thumbnail-storage-adapter.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function dbPort(sqlite) {
  return { prepare(sql) {
    return { bind(...params) {
      const statement = sqlite.prepare(sql);
      return {
        async first() { return statement.get(...params) ?? null; },
        async all() { return { results: statement.all(...params) }; },
        async run() { const result = statement.run(...params); return { meta: { changes: result.changes } }; },
      };
    } };
  } };
}

function fixture(videos) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,preview_r2_key TEXT,source_available INTEGER);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,canonical_storage_object_id TEXT);
    CREATE TABLE asset_video_playback_states(asset_id TEXT,creator_id TEXT,canonical_storage_object_id TEXT,state TEXT,source_codec TEXT);
    CREATE TABLE asset_storage_objects(id TEXT,asset_id TEXT,creator_id TEXT,provider TEXT,storage_role TEXT,bucket_role TEXT,
      ingest_status TEXT,object_key TEXT,source_revision TEXT,r2_etag TEXT,r2_version TEXT,byte_count INTEGER);`);
  const originals = new Map();
  for (const [creatorId, assetId, codec, bytes] of videos) {
    const storageId = `storage-${assetId}`;
    const key = `originals/v1/${assetId}`;
    sqlite.prepare("INSERT INTO assets VALUES (?,?,NULL,1)").run(assetId, creatorId);
    sqlite.prepare("INSERT INTO asset_media_authorities VALUES (?,?,'r2_native','canonical_verified',?)").run(assetId, creatorId, storageId);
    sqlite.prepare("INSERT INTO asset_video_playback_states VALUES (?,?,?,'canonical_verified',?)").run(assetId, creatorId, storageId, codec);
    sqlite.prepare("INSERT INTO asset_storage_objects VALUES (?,?,?,'r2','canonical_original','library_media','verified',?,?,?,?,?)")
      .run(storageId, assetId, creatorId, key, `revision-${assetId}`, `etag-${assetId}`, `version-${assetId}`, bytes.length);
    originals.set(key, { key, version: `version-${assetId}`, etag: `etag-${assetId}`, size: bytes.length, bytes });
  }
  let sourceGets = 0;
  let posterPuts = 0;
  let onPut = null;
  let sourceOverride = null;
  let putError = null;
  const posters = new Map();
  const LIBRARY_MEDIA = {
    async head(key) { const item = originals.get(key); return item && { key, version: item.version, etag: item.etag, size: item.size }; },
    async get(key, options) {
      sourceGets++;
      const item = originals.get(key);
      if (!item || options?.onlyIf?.etagMatches !== item.etag) return null;
      return { key, version: item.version, etag: item.etag, size: item.size,
        body: Readable.from([sourceOverride ?? item.bytes]) };
    },
  };
  const PREVIEWS = {
    async head(key) { return posters.get(key) ?? null; },
    async put(key, bytes, options) {
      posterPuts++;
      if (putError) throw putError;
      onPut?.();
      const item = { key, bytes: Buffer.from(bytes), customMetadata: options.customMetadata };
      posters.set(key, item);
      return item;
    },
  };
  const adapter = createVideoThumbnailStorageAdapter({ DB: dbPort(sqlite), LIBRARY_MEDIA, PREVIEWS });
  return { sqlite, adapter, originals, posters, get sourceGets() { return sourceGets; },
    get posterPuts() { return posterPuts; }, set onPut(fn) { onPut = fn; },
    set sourceOverride(value) { sourceOverride = value; }, set putError(value) { putError = value; },
    close() { sqlite.close(); } };
}

function video(path, codec) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=320x180:rate=12", "-t", "2", "-threads", "2", "-c:v",
    codec === "h265" ? "libx265" : "libx264", "-preset", "ultrafast", "-y", path],
  { timeout: 60_000, stdio: "ignore" });
}

test("creator-scoped dry run and bounded generation persist one private JPEG per video", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-adapter-test-"));
  try {
    const h264 = join(directory, "h264.mp4"); const h265 = join(directory, "h265.mp4");
    video(h264, "h264"); video(h265, "h265");
    const aBytes = await readFile(h264); const bBytes = await readFile(h265);
    const f = fixture([["creator-one", A, "h264", aBytes], ["creator-two", B, "h265", bBytes]]);
    try {
      assert.equal(await f.adapter.loadSource("creator-one", B), null);
      const dry = await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one" });
      assert.equal(dry.dryRun, true);
      assert.deepEqual(dry.results.map((r) => r.status), ["planned"]);
      assert.equal(f.sourceGets, 0); assert.equal(f.posterPuts, 0);
      const one = await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one", execute: true });
      assert.deepEqual(one.results.map((r) => r.status), ["committed"]);
      assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets WHERE id=?").get(B).preview_r2_key, null);
      const two = await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-two", execute: true });
      assert.deepEqual(two.results.map((r) => r.status), ["committed"]);
      assert.equal(f.posters.size, 2);
      assert.equal(f.sourceGets, 2); assert.equal(f.posterPuts, 2);
      assert.deepEqual((await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one", execute: true })).results, []);
      assert.equal(f.posterPuts, 2);
      assert.deepEqual(f.originals.get(`originals/v1/${A}`).bytes, aBytes);
      assert.deepEqual(f.originals.get(`originals/v1/${B}`).bytes, bBytes);
    } finally { f.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("manual poster and source-revision races fail the D1 compare-and-swap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-adapter-test-"));
  try {
    const path = join(directory, "video.mp4"); video(path, "h265");
    const bytes = await readFile(path);
    for (const race of ["manual", "source"]) {
      const f = fixture([["creator-one", A, "h265", bytes]]);
      try {
        f.onPut = () => {
          if (race === "manual") f.sqlite.prepare("UPDATE assets SET preview_r2_key='manual-poster' WHERE id=?").run(A);
          else f.sqlite.prepare("UPDATE asset_storage_objects SET source_revision='new-revision' WHERE asset_id=?").run(A);
        };
        const run = await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one", execute: true });
        assert.deepEqual(run.results.map((r) => r.status), ["changed_before_commit"]);
        assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets WHERE id=?").get(A).preview_r2_key,
          race === "manual" ? "manual-poster" : null);
        assert.equal(f.posters.size, 1); // Content-addressed private orphan; safe bounded cleanup later.
      } finally { f.close(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("changed R2 identity, truncated input and poster put failure leave D1 untouched and scratch files gone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-adapter-test-"));
  try {
    const path = join(directory, "video.mp4"); video(path, "h265");
    const bytes = await readFile(path);
    for (const failure of ["identity", "truncated", "put"]) {
      const f = fixture([["creator-one", A, "h265", bytes]]);
      try {
        if (failure === "identity") f.originals.get(`originals/v1/${A}`).etag = "changed-etag";
        if (failure === "truncated") f.sourceOverride = bytes.subarray(0, bytes.length - 1);
        if (failure === "put") f.putError = new Error("poster_storage_failed");
        const scratchPrefix = `thot-poster-${process.pid}-`;
        const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith(scratchPrefix)));
        const run = await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one", execute: true });
        assert.deepEqual(run.results.map((r) => r.status), ["error"]);
        assert.equal(f.sqlite.prepare("SELECT preview_r2_key FROM assets WHERE id=?").get(A).preview_r2_key, null);
        assert.equal(f.posters.size, 0);
        const after = (await readdir(tmpdir())).filter((name) => name.startsWith(scratchPrefix));
        assert.deepEqual(after.filter((name) => !before.has(name)), []);
      } finally { f.close(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("batch limits defer oversized work and reject unsafe scope or caller-supplied poster keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-adapter-test-"));
  try {
    const path = join(directory, "video.mp4"); video(path, "h264");
    const bytes = await readFile(path);
    const f = fixture([["creator-one", A, "h264", bytes]]);
    try {
      const budget = await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one", execute: true,
        maxSourceBytes: bytes.length - 1 });
      assert.deepEqual(budget.results.map((r) => r.status), ["deferred_budget"]);
      assert.equal(f.sourceGets, 0); assert.equal(f.posterPuts, 0);
      assert.equal(budget.nextCursor, A);
      assert.deepEqual((await runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one", afterId: A })).results, []);
      await assert.rejects(runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-two/../one" }), /invalid_thumbnail_scope/);
      await assert.rejects(runVideoThumbnailBatch({ adapter: f.adapter, creatorId: "creator-one", maxItems: 26 }), /invalid_thumbnail_batch_limit/);
      const source = await f.adapter.loadSource("creator-one", A);
      await assert.rejects(f.adapter.commitPosterIfUnchanged(source, {
        objectId: "wrong", key: "creators/creator-one/assets/wrong/previews/wrong.jpg", bytes: Buffer.from([1]),
      }), /poster_identity_invalid/);
      assert.equal(f.posterPuts, 0);
    } finally { f.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
