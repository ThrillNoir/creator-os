import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import ts from "typescript";

const source = await readFile(new URL("../src/app/api/source-media/intents/[sessionId]/finalize/route.ts", import.meta.url), "utf8");
const start = source.indexOf("async function verifyAndPersist(");
const end = source.indexOf("\nasync function abortExpired(", start);
assert.ok(start >= 0 && end > start, "verifyAndPersist exists");
const implementation = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
new Function("exports", "hashAndValidateR2Object", "quarantine", "crypto", "humanAuditActor", "identityAuditStatement", "ensureNativePreview", `${implementation}\nexports.verifyAndPersist = verifyAndPersist;`)(
  moduleExports,
  async (_bucket, _key) => ({ byteCount: 42, sha256: "a".repeat(64), detectedMime: "image/jpeg", r2Version: "version-1", r2Etag: "etag-1" }),
  async () => {},
  globalThis.crypto,
  () => ({}),
  () => ({ run() {} }),
  async () => "failed",
);

for (const startingCount of [19, 20]) {
  test(`native image reconciliation counter stays within its limit from ${startingCount}`, async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`CREATE TABLE asset_ingest_sessions(
      id TEXT,creator_id TEXT,finalization_state TEXT,
      reconcile_attempts INTEGER CHECK(reconcile_attempts >= 0),updated_at TEXT
    );`);
    sqlite.prepare("INSERT INTO asset_ingest_sessions VALUES ('session-1','creator-1','completed_unreconciled',?,NULL)").run(startingCount);
    const DB = {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async run() { return { meta: sqlite.prepare(sql).run(...params) }; },
            };
          },
        };
      },
      async batch(statements) { return statements.map(() => ({ meta: { changes: 1 } })); },
    };
    const session = {
      id: "session-1", asset_id: "asset-1", storage_object_id: "object-1", object_key: "private/original",
      expected_sha256: "a".repeat(64), expected_bytes: 42, expected_mime_type: "image/jpeg", source_revision: "native:client-upload-1",
    };
    try {
      assert.equal(await moduleExports.verifyAndPersist(DB, {}, {}, {}, {}, session, "creator-1", { email: "creator@example.test", creator: { role: "creator" } }), "failed");
      assert.equal(sqlite.prepare("SELECT reconcile_attempts FROM asset_ingest_sessions WHERE id='session-1'").pluck().get(), 20);
    } finally {
      sqlite.close();
    }
  });
}
