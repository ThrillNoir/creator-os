import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import Database from "better-sqlite3";
import test from "node:test";

test("a saved video remains metadata-reconcilable after the historical attempt counter reaches 20", async () => {
  const source = await readFile(new URL("../src/app/api/source-media/videos/intents/[sessionId]/finalize/route.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function verifyAndPersist(");
  const end = source.indexOf("\nexport async function POST(", start);
  const code = stripTypeScriptTypes(source.slice(start, end));
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`CREATE TABLE asset_video_ingest_sessions(id TEXT PRIMARY KEY,creator_id TEXT,finalization_state TEXT,reconcile_attempts INTEGER CHECK(reconcile_attempts BETWEEN 0 AND 20),updated_at TEXT);
      INSERT INTO asset_video_ingest_sessions VALUES ('session','own','completed_unreconciled',20,NULL);`);
    let metadataChecks = 0;
    let persisted = 0;
    const verify = new Function("completedR2MultipartEtag", "validateR2VideoMetadata", "safeFailureCode", "terminalValidationFailures", "quarantine", "humanAuditActor", "identityAuditStatement", `${code}; return verifyAndPersist;`)(
      () => "etag-1",
      async () => {
        metadataChecks++;
        return { byteCount: 10, detectedMime: "video/mp4", codec: "h264", r2Version: "version", r2Etag: "etag-1", clientSha256: "a".repeat(64), checksumProvenance: "client_declared" };
      },
      () => "failure", new Set(), () => {}, () => ({}), () => ({}),
    );
    const DB = {
      prepare(sql) { return { bind(...args) { return { async run() { return { meta: sqlite.prepare(sql).run(...args) }; } }; } }; },
      async batch() { persisted++; },
    };
    const session = { id: "session", object_key: "opaque-key", expected_bytes: 10, expected_mime_type: "video/mp4", expected_sha256: "a".repeat(64) };
    assert.equal(await verify(DB, {}, session, [{ etag: "etag" }], "own", { email: "own@example.test", creator: { role: "creator" } }), "h264");
    assert.equal(sqlite.prepare("SELECT reconcile_attempts FROM asset_video_ingest_sessions").pluck().get(), 20);
    assert.equal(metadataChecks, 1);
    assert.equal(persisted, 1);
    assert.equal(sqlite.prepare("SELECT finalization_state FROM asset_video_ingest_sessions").pluck().get(), "verifying");
  } finally { sqlite.close(); }
});
