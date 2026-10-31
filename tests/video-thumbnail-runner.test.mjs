import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createThumbnailStateStore, parseThumbnailRunnerArgs, runThumbnailMindCommand, thumbnailTarget } from "../scripts/video-thumbnail-mind-runner.mjs";
import { createRemoteD1Port, createRemoteR2Port, createRemotePosterCommitPort } from "../scripts/video-thumbnail-remote-ports.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const CONFIG = { name: "thot-os-staging", account_id: "3e7cfa6efb7a97825f1dc24515410c63",
  d1_databases: [{ binding: "DB", database_name: "thot-os-staging", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f" }],
  r2_buckets: [{ binding: "LIBRARY_MEDIA", bucket_name: "thot-os-library-media-staging" },
    { binding: "PREVIEWS", bucket_name: "thot-os-previews-staging" }] };

function fixture(bytes) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,preview_r2_key TEXT,source_available INTEGER);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,canonical_storage_object_id TEXT);
    CREATE TABLE asset_video_playback_states(asset_id TEXT,creator_id TEXT,canonical_storage_object_id TEXT,state TEXT,source_codec TEXT);
    CREATE TABLE asset_storage_objects(id TEXT,asset_id TEXT,creator_id TEXT,provider TEXT,storage_role TEXT,bucket_role TEXT,
      ingest_status TEXT,object_key TEXT,source_revision TEXT,r2_etag TEXT,r2_version TEXT,byte_count INTEGER);
    INSERT INTO assets VALUES ('${A}','creator-one',NULL,1);
    INSERT INTO asset_media_authorities VALUES ('${A}','creator-one','r2_native','canonical_verified','storage-one');
    INSERT INTO asset_video_playback_states VALUES ('${A}','creator-one','storage-one','canonical_verified','h265');
    INSERT INTO asset_storage_objects VALUES ('storage-one','${A}','creator-one','r2','canonical_original','library_media',
      'verified','originals/v1/synthetic','native:synthetic','etag-one','version-one',${bytes.length});`);
  let gets = 0; let puts = 0;
  const posters = new Map();
  const DB = { prepare(sql) { return { bind(...params) { const statement = sqlite.prepare(sql); return {
    async first() { return statement.get(...params) ?? null; },
    async all() { return { results: statement.all(...params) }; },
    async run() { return { meta: { changes: statement.run(...params).changes } }; },
  }; } }; } };
  const original = { key: "originals/v1/synthetic", etag: "etag-one", version: "version-one", size: bytes.length };
  const LIBRARY_MEDIA = {
    async head() { return original; },
    async get() { gets++; return { ...original, body: Readable.from([bytes]) }; },
  };
  const PREVIEWS = {
    async head(key) { return posters.get(key) ?? null; },
    async put(key, jpeg, { customMetadata }) { puts++; const entry = { key, bytes: jpeg, customMetadata }; posters.set(key, entry); return entry; },
  };
  const portFactory = { d1: () => DB, r2: ({ bucket }) => bucket === "thot-os-library-media-staging" ? LIBRARY_MEDIA : PREVIEWS,
    commit: () => ({ async commit(source, jpeg) { const key = `creators/${source.creatorId}/assets/${createHash("sha256").update(`${source.creatorId}:${source.assetId}`).digest("hex")}/previews/${createHash("sha256").update(jpeg).digest("hex")}.jpg`; await PREVIEWS.put(key, jpeg, { customMetadata: { creator_id: source.creatorId, asset_id: source.assetId, derivative: "video_poster_v1" } }); const result = await DB.prepare(`UPDATE assets SET preview_r2_key=?
      WHERE id=? AND creator_id=? AND preview_r2_key IS NULL AND EXISTS
      (SELECT 1 FROM asset_storage_objects WHERE asset_id=? AND creator_id=? AND object_key=? AND source_revision=? AND r2_etag=? AND r2_version=? AND byte_count=?)`)
      .bind(key, source.assetId, source.creatorId, source.assetId, source.creatorId, source.sourceKey,
        source.sourceRevision, source.etag, source.version, source.bytes).run();
      return result.meta.changes === 1; } }) };
  const state = new Map();
  const stateStore = { async read(creatorId) { return state.get(creatorId) ?? { afterId: "" }; },
    async write(creatorId, value) { state.set(creatorId, value); } };
  return { sqlite, portFactory, stateStore, get gets() { return gets; }, get puts() { return puts; }, close() { sqlite.close(); } };
}

test("CLI defaults to a read-only exact plan and rejects wrong target or ungated writes", async () => {
  assert.equal(parseThumbnailRunnerArgs(["--creator", "creator-one"]).mode, "plan");
  assert.throws(() => thumbnailTarget({ ...CONFIG, name: "thot-os-production" }), /thumbnail_target_mismatch/);
  assert.throws(() => parseThumbnailRunnerArgs(["--creator", "creator-one", "--tick", "--after", A]), /thumbnail_argument_invalid/);
  let requested = 0;
  await assert.rejects(runThumbnailMindCommand({ argv: ["--creator", "creator-one", "--apply", "thumbnail:0123456789abcdef"],
    env: {}, config: CONFIG, readToken: () => "synthetic-read", portFactory: { d1() { requested++; } } }), /thumbnail_apply_not_enabled/);
  assert.equal(requested, 0);
});

test("optional timer cursor file is local, private, and rejects invalid creator scopes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-timer-state-test-"));
  try {
    const store = createThumbnailStateStore({ root: directory });
    assert.deepEqual(await store.read("creator-one"), { afterId: "" });
    await store.write("creator-one", { afterId: A });
    assert.deepEqual(await store.read("creator-one"), { afterId: A });
    const { stat } = await import("node:fs/promises");
    assert.equal((await stat(join(directory, "creator-one.json"))).mode & 0o777, 0o600);
    await assert.rejects(store.read("../another-creator"), /thumbnail_argument_invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("one-shot plan ID protects source identity; optional tick advances and wraps without duplicate posters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-runner-test-"));
  try {
    const file = join(directory, "video.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc2=size=320x180:rate=12", "-t", "2", "-threads", "2", "-c:v", "libx265",
      "-preset", "ultrafast", "-y", file], { timeout: 60_000, stdio: "ignore" });
    const f = fixture(await readFile(file));
    const argv = ["--creator", "creator-one"];
    const writeEnv = { THOT_THUMBNAIL_ALLOW_APPLY: "1", THOT_THUMBNAIL_TIMER_ENABLED: "1",
      THOT_THUMBNAIL_SERVICE_TOKEN: "synthetic-service-token", THOT_THUMBNAIL_ACCESS_CLIENT_ID: "synthetic-access-id",
      THOT_THUMBNAIL_ACCESS_CLIENT_SECRET: "synthetic-access-secret",
      THOT_THUMBNAIL_SOURCE_R2_KEY_ID: "synthetic-source-key",
      THOT_THUMBNAIL_SOURCE_R2_SECRET: "synthetic-source-secret",
      };
    const common = { config: CONFIG, portFactory: f.portFactory, stateStore: f.stateStore, readToken: () => "synthetic-read" };
    try {
      const plan = await runThumbnailMindCommand({ ...common, argv, env: {} });
      assert.equal(plan.candidates.length, 1);
      assert.equal(plan.candidates[0].codec, "h265");
      assert.equal(f.gets, 0); assert.equal(f.puts, 0);
      await assert.rejects(runThumbnailMindCommand({ ...common, argv: [...argv, "--apply", "thumbnail:0000000000000000"], env: writeEnv }), /thumbnail_plan_changed/);
      assert.equal(f.gets, 0);
      const applied = await runThumbnailMindCommand({ ...common, argv: [...argv, "--apply", plan.planId], env: writeEnv });
      assert.deepEqual(applied.results.map((item) => item.status), ["committed"]);
      assert.match(applied.receiptId, /^thumbnail-receipt:[0-9a-f]{16}$/);
      assert.equal(f.gets, 1); assert.equal(f.puts, 1);
      await assert.rejects(runThumbnailMindCommand({ ...common, argv: [...argv, "--apply", plan.planId], env: writeEnv }), /thumbnail_plan_changed/);
      const tick = await runThumbnailMindCommand({ ...common, argv: [...argv, "--tick"], env: writeEnv });
      assert.deepEqual(tick.results, []);
      assert.match(tick.receiptId, /^thumbnail-receipt:[0-9a-f]{16}$/);
      assert.equal(f.puts, 1);
      assert.equal((await f.stateStore.read("creator-one")).afterId, "");
    } finally { f.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("one-shot H.264 traverses mocked D1 and R2 HTTP ports without changing the original", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-remote-runner-test-"));
  try {
    const file = join(directory, "video.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc2=size=320x180:rate=12", "-t", "2", "-threads", "2", "-c:v", "libx264",
      "-preset", "ultrafast", "-y", file], { timeout: 60_000, stdio: "ignore" });
    const bytes = await readFile(file);
    const f = fixture(bytes);
    f.sqlite.prepare("UPDATE asset_video_playback_states SET source_codec='h264'").run();
    const posters = new Map();
    let sourceGets = 0; let posterPuts = 0;
    const d1Fetch = async (request) => {
      assert.equal(request.headers.get("authorization")?.startsWith("Bearer "), true);
      if (request.method === "GET") return Response.json({ success: true, errors: [],
        result: { uuid: CONFIG.d1_databases[0].database_id, name: "thot-os-staging" } });
      const { sql, params } = await request.json();
      const statement = f.sqlite.prepare(sql);
      const select = /^SELECT/i.test(sql);
      const result = select ? { results: statement.all(...params), changes: 0 }
        : { results: [], changes: statement.run(...params).changes };
      return Response.json({ success: true, errors: [], result: [{ success: true,
        results: result.results, meta: { changes: result.changes } }] });
    };
    const sourceKey = "/thot-os-library-media-staging/originals/v1/synthetic";
    const r2Fetch = async (request) => {
      assert.ok(request.headers.get("authorization"));
      const path = new URL(request.url).pathname;
      if (path === sourceKey) {
        if (request.method === "GET") {
          sourceGets++;
          assert.equal(request.headers.get("if-match"), '"etag-one"');
        } else assert.equal(request.method, "HEAD");
        return new Response(request.method === "HEAD" ? null : bytes, { headers: {
          "content-length": String(bytes.length), etag: '"etag-one"', "x-amz-version-id": "version-one",
        } });
      }
      assert.ok(path.startsWith("/thot-os-previews-staging/creators/creator-one/assets/"));
      if (request.method === "HEAD") {
        const stored = posters.get(path);
        return stored ? new Response(null, { headers: {
          "content-length": String(stored.length), etag: '"poster-etag"',
          "x-amz-meta-creator_id": "creator-one", "x-amz-meta-asset_id": A,
          "x-amz-meta-derivative": "video_poster_v1",
        } }) : new Response(null, { status: 404 });
      }
      assert.equal(request.method, "PUT");
      assert.equal(request.headers.get("if-none-match"), "*");
      posterPuts++;
      posters.set(path, new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { headers: { etag: '"poster-etag"' } });
    };
    const commitFetch = async (request) => {
      assert.equal(new URL(request.url).pathname, "/api/internal/video-thumbnail/commit");
      assert.equal(request.headers.get("x-thot-os-service-capability"), "library.thumbnail.commit");
      assert.equal(request.headers.get("cf-access-client-id"), "synthetic-access-id");
      const { creatorId, assetId, source, posterBase64, contentType } = await request.json();
      assert.equal(contentType, "image/jpeg");
      const jpeg = Buffer.from(posterBase64, "base64");
      const posterKey = `creators/${creatorId}/assets/${createHash("sha256").update(`${creatorId}:${assetId}`).digest("hex")}/previews/${createHash("sha256").update(jpeg).digest("hex")}.jpg`;
      posterPuts++; posters.set(`/thot-os-previews-staging/${posterKey}`, jpeg);
      const outcome = f.sqlite.prepare(`UPDATE assets SET preview_r2_key=? WHERE id=? AND creator_id=?
        AND preview_r2_key IS NULL AND EXISTS (SELECT 1 FROM asset_storage_objects WHERE asset_id=?
        AND creator_id=? AND object_key=? AND source_revision=? AND r2_etag=? AND r2_version=? AND byte_count=?)`)
        .run(posterKey, assetId, creatorId, assetId, creatorId, source.key, source.revision,
          source.etag, source.version, source.bytes);
      return Response.json({ ok: true, status: outcome.changes === 1 ? "committed" : "already_committed" });
    };
    const portFactory = {
      d1: (options) => createRemoteD1Port({ ...options, apiBase: "https://d1.invalid/client/v4", fetchImpl: d1Fetch }),
      r2: (options) => createRemoteR2Port({ ...options, endpoint: "https://r2.invalid", fetchImpl: r2Fetch }),
      commit: (options) => createRemotePosterCommitPort({ ...options, fetchImpl: commitFetch }),
    };
    const writeEnv = { THOT_THUMBNAIL_ALLOW_APPLY: "1", THOT_THUMBNAIL_SERVICE_TOKEN: "synthetic-service-token",
      THOT_THUMBNAIL_ACCESS_CLIENT_ID: "synthetic-access-id", THOT_THUMBNAIL_ACCESS_CLIENT_SECRET: "synthetic-access-secret",
      THOT_THUMBNAIL_SOURCE_R2_KEY_ID: "synthetic-source-key", THOT_THUMBNAIL_SOURCE_R2_SECRET: "synthetic-source-secret",
      };
    try {
      const common = { config: CONFIG, portFactory, argv: ["--creator", "creator-one"] };
      const plan = await runThumbnailMindCommand({ ...common, env: {}, readToken: () => "synthetic-read" });
      assert.equal(sourceGets, 0); assert.equal(posterPuts, 0);
      const result = await runThumbnailMindCommand({ ...common, argv: [...common.argv, "--apply", plan.planId], env: writeEnv });
      assert.deepEqual(result.results.map((item) => item.status), ["committed"]);
      assert.equal(sourceGets, 1); assert.equal(posterPuts, 1);
      assert.deepEqual(await readFile(file), bytes);
      assert.ok(f.sqlite.prepare("SELECT preview_r2_key FROM assets WHERE id=?").get(A).preview_r2_key);
    } finally { f.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
