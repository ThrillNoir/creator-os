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
const moduleExports = {};
new Function("exports", "createNativeImagePreview", "safeFailureCode", "identityAuditStatement", "humanAuditActor", `${implementation}\nexports.ensureNativePreview = ensureNativePreview;`)(
  moduleExports,
  async () => { throw new Error("preview_transform_unavailable"); },
  (_error, fallback) => fallback,
  () => ({ run() {} }),
  () => ({}),
);

function fixture(existingJob = false) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE creators(id TEXT PRIMARY KEY);
    CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,preview_r2_key TEXT,media_r2_key TEXT);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,preview_failure_code TEXT,updated_at TEXT);
    CREATE TABLE asset_storage_objects(id TEXT,creator_id TEXT,asset_id TEXT,r2_etag TEXT,sha256 TEXT,source_revision TEXT,object_key TEXT);
    INSERT INTO creators VALUES ('creator-1');
    INSERT INTO assets VALUES ('asset-1','creator-1',NULL,'private/original');
    INSERT INTO asset_media_authorities VALUES ('asset-1','creator-1','r2_native','canonical_verified',NULL,CURRENT_TIMESTAMP);
    INSERT INTO asset_storage_objects VALUES ('object-1','creator-1','asset-1','etag-1','${"a".repeat(64)}','native:client-upload-1','private/original');
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
  const session = { ingest_kind: "native_image", storage_object_id: "object-1", object_key: "private/original", source_revision: "native:client-upload-1", asset_id: "asset-1" };
  return { sqlite, DB, queue, session, messages, close: () => sqlite.close() };
}

for (const existing of [false, true]) {
  test(`failed inline preview writes the migration-compatible recovery job${existing ? " on conflict" : ""}`, async () => {
    const state = fixture(existing);
    try {
      assert.equal(await moduleExports.ensureNativePreview(
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
