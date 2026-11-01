import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import ts from "typescript";

const route = await readFile(new URL("../src/app/api/source-media/intents/[sessionId]/finalize/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../../thot-os-app/migrations/0022_asset_preview_queue.sql", import.meta.url), "utf8");
const start = route.indexOf("async function ensureNativePreview(");
const end = route.indexOf("\nasync function verifyAndPersist(", start);
assert.ok(start >= 0 && end > start, "ensureNativePreview exists");
const implementation = ts.transpileModule(route.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function loadEnsureNativePreview(createPreview = async () => { throw new Error("preview_transform_unavailable"); }) {
  const moduleExports = {};
  new Function("exports", "createNativeImagePreview", "safeFailureCode", "identityAuditStatement", "humanAuditActor", `${implementation}\nexports.ensureNativePreview = ensureNativePreview;`)(
    moduleExports, createPreview, (_error, fallback) => fallback, () => ({ run() {} }), () => ({}),
  );
  return moduleExports.ensureNativePreview;
}
const ensureNativePreview = loadEnsureNativePreview();

const postStart = route.indexOf("export async function POST(");
assert.ok(postStart >= 0, "finalize POST handler exists");
const postImplementation = ts.transpileModule(route.slice(postStart).replace("export async function", "async function"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function loadFinalizePost(state, ensurePreview, creatorId) {
  const noStoreJson = (body, status = 200) => Response.json(body, { status });
  return new Function("isSameOriginRequest", "validUuid", "noStoreJson", "requireCreatorContext", "cloudflareEnv", "ensureNativePreview",
    `${postImplementation}\nreturn POST;`)(
    () => true, () => true, noStoreJson,
    async () => ({ creator: { creator_id: creatorId } }),
    () => ({ DB: state.DB, LIBRARY_MEDIA: state.libraryMedia, PREVIEWS: {}, IMAGES: {}, PREVIEW_QUEUE: state.queue }),
    ensurePreview,
  );
}

function fixture(existingJob = false) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE creators(id TEXT PRIMARY KEY);
    CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,preview_r2_key TEXT,media_r2_key TEXT);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,preview_failure_code TEXT,updated_at TEXT);
    CREATE TABLE asset_storage_objects(id TEXT,creator_id TEXT,asset_id TEXT,r2_etag TEXT,sha256 TEXT,source_revision TEXT,object_key TEXT);
    CREATE TABLE asset_ingest_sessions(id TEXT,asset_id TEXT,creator_id TEXT,storage_object_id TEXT,object_key TEXT,source_revision TEXT,multipart_upload_id TEXT,expected_sha256 TEXT,expected_bytes INTEGER,expected_mime_type TEXT,chunk_bytes INTEGER,status TEXT,finalization_state TEXT,expires_at TEXT,ingest_kind TEXT);
    INSERT INTO creators VALUES ('creator-1');
    INSERT INTO assets VALUES ('asset-1','creator-1',NULL,'private/original');
    INSERT INTO asset_media_authorities VALUES ('asset-1','creator-1','r2_native','canonical_verified',NULL,CURRENT_TIMESTAMP);
    INSERT INTO asset_storage_objects VALUES ('object-1','creator-1','asset-1','etag-1','${"a".repeat(64)}','native:client-upload-1','private/original');
    INSERT INTO asset_ingest_sessions VALUES ('session-1','asset-1','creator-1','object-1','private/original','native:client-upload-1',NULL,'${"a".repeat(64)}',42,'image/jpeg',NULL,'finalized','verified','2099-01-01T00:00:00Z','native_image');
  `);
  sqlite.exec(migration);
  if (existingJob) sqlite.prepare(`INSERT INTO asset_preview_jobs(id,creator_id,asset_id,source_revision,status,attempts,last_error)
    VALUES ('preview:creator-1:asset-1','creator-1','asset-1','native:client-upload-1','failed',2,'old error')`).run();

  const wrap = (statement) => ({
    bind(...params) { return wrap({ sql: statement.sql, params }); },
    async first() { return sqlite.prepare(statement.sql).get(...(statement.params ?? [])) ?? null; },
    async run() { return sqlite.prepare(statement.sql).run(...(statement.params ?? [])); },
  });
  const DB = {
    prepare(sql) { return wrap({ sql }); },
    async batch(statements) {
      return sqlite.transaction(() => statements.map((statement) => statement.run()))();
    },
  };
  const messages = [];
  const queue = { async send(message) { messages.push(message); } };
  const libraryMedia = { resumeMultipartUpload() { throw new Error("retry must not reupload the original"); } };
  const session = { ingest_kind: "native_image", storage_object_id: "object-1", object_key: "private/original", source_revision: "native:client-upload-1", asset_id: "asset-1" };
  return { sqlite, DB, queue, libraryMedia, session, messages, close: () => sqlite.close() };
}

for (const existing of [false, true]) {
  test(`failed inline preview writes the migration-compatible recovery job${existing ? " on conflict" : ""}`, async () => {
    const state = fixture(existing);
    try {
      assert.equal(await ensureNativePreview(
        state.DB,
        {},
        {},
        {},
        state.queue,
        state.session,
        "creator-1",
        {},
      ), "failed");
      const job = state.sqlite.prepare("SELECT * FROM asset_preview_jobs").get();
      assert.equal(job.status, "queued");
      assert.equal(job.last_error, "native_preview_failed");
      assert.equal(job.source_revision, "native:client-upload-1");
      if (existing) assert.equal(job.attempts, 2);
      assert.deepEqual(state.messages, [{ creatorId: "creator-1", assetId: "asset-1", sourceRevision: "native:client-upload-1" }]);
      assert.equal(state.sqlite.prepare("SELECT state FROM asset_media_authorities").pluck().get(), "preview_failed");
    } finally {
      state.close();
    }
  });
}

test("failed preview enqueue can recover through the same finalized, creator-scoped session", async () => {
  const state = fixture();
  let transformFails = true;
  let previewCalls = 0;
  let enqueueAttempts = 0;
  const retryPreview = loadEnsureNativePreview(async () => {
    previewCalls++;
    if (transformFails) throw new Error("synthetic_transform_failure");
    return { objectKey: "private/preview", width: 64, height: 64 };
  });
  state.queue.send = async () => { enqueueAttempts++; throw new Error("synthetic_queue_failure"); };
  const request = new Request("https://creator.example.test/api/source-media/intents/session-1/finalize", { method: "POST" });
  const invoke = (creatorId) => loadFinalizePost(state, retryPreview, creatorId)(request, { params: Promise.resolve({ sessionId: "session-1" }) });
  try {
    const first = await invoke("creator-1");
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).preview, "failed");
    assert.equal(enqueueAttempts, 1);
    assert.equal(state.sqlite.prepare("SELECT status FROM asset_preview_jobs").pluck().get(), "queued");

    const foreign = await invoke("creator-2");
    assert.equal(foreign.status, 404);
    assert.equal(previewCalls, 1);
    assert.equal(enqueueAttempts, 1);

    transformFails = false;
    const retried = await invoke("creator-1");
    assert.equal(retried.status, 200);
    assert.deepEqual(await retried.json(), { ok: true, sessionId: "session-1", status: "finalized", replay: true, preview: "ready" });
    assert.equal(previewCalls, 2);
    assert.equal(enqueueAttempts, 1);
    assert.equal(state.sqlite.prepare("SELECT preview_r2_key FROM assets").pluck().get(), "private/preview");
    assert.equal(state.sqlite.prepare("SELECT state FROM asset_media_authorities").pluck().get(), "preview_ready");
    assert.equal(state.sqlite.prepare("SELECT status FROM asset_preview_jobs").pluck().get(), "ready");
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) FROM assets").pluck().get(), 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) FROM asset_storage_objects").pluck().get(), 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) FROM asset_ingest_sessions").pluck().get(), 1);
    assert.deepEqual(state.sqlite.prepare("SELECT creator_id,media_r2_key FROM assets").get(), { creator_id: "creator-1", media_r2_key: "private/original" });
  } finally { state.close(); }
});
