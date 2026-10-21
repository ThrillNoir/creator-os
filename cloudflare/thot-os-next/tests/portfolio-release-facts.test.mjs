import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/portfolio-release-facts.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test("Portfolio preflight reads only this creator's media and attached-person consent facts", async () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,extension TEXT,source_available INTEGER);
      CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT);
      CREATE TABLE asset_people(asset_id TEXT,creator_id TEXT,person_id INTEGER);
      CREATE TABLE people(id INTEGER PRIMARY KEY,creator_id TEXT,consent_status TEXT);
      CREATE TABLE asset_paid_consent_attestations(asset_id TEXT,creator_id TEXT,person_id INTEGER,revoked_at TEXT);
      CREATE TABLE asset_video_playback_states(asset_id TEXT,creator_id TEXT,canonical_storage_object_id TEXT,source_codec TEXT,state TEXT);
      CREATE TABLE asset_storage_objects(id TEXT,asset_id TEXT,creator_id TEXT,provider TEXT,storage_role TEXT,bucket_role TEXT,
        ingest_status TEXT,byte_count INTEGER,verified_mime_type TEXT,r2_version TEXT,r2_etag TEXT);
      INSERT INTO assets VALUES ('clip-a','creator-a','mp4',1),('clip-b','creator-b','mp4',1);
      INSERT INTO asset_media_authorities VALUES ('clip-a','creator-a','r2_native','canonical_verified');
      INSERT INTO asset_video_playback_states VALUES ('clip-a','creator-a','object-a','h265','canonical_verified');
      INSERT INTO asset_storage_objects VALUES ('object-a','clip-a','creator-a','r2','canonical_original','library_media','verified',1000,'video/mp4','v1','etag');
      INSERT INTO people VALUES (1,'creator-a','recorded');
      INSERT INTO asset_people VALUES ('clip-a','creator-a',1);`);
    const exports = {};
    const creatorPrepare = (_DB, creatorId, sql) => ({ bind(...ids) { return { all() { return { results: db.prepare(sql.replaceAll("@creator", "?")).all(creatorId, ...ids) }; } }; } });
    new Function("require", "exports", code)((name) => {
      if (name === "server-only") return {};
      if (name === "./cloudflare") return { cloudflareEnv: () => ({ DB: db }) };
      if (name === "./creator-db") return { creatorPrepare };
      throw new Error(`Unexpected import ${name}`);
    }, exports);
    const facts = await exports.getPortfolioReleaseFacts("creator-a", ["clip-a", "clip-b"]);
    assert.equal(facts["clip-a"].source_codec, "h265");
    assert.equal(facts["clip-a"].canonical_ready, 1);
    assert.equal(facts["clip-a"].missing_consent_count, 1);
    assert.equal(facts["clip-b"], undefined);
    db.exec("INSERT INTO asset_paid_consent_attestations VALUES ('clip-a','creator-a',1,NULL)");
    assert.equal((await exports.getPortfolioReleaseFacts("creator-a", ["clip-a"]))["clip-a"].missing_consent_count, 0);
  } finally { db.close(); }
});
