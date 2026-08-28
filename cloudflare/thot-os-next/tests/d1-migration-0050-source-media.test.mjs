import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const appRoot = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.resolve(appRoot, "../thot-os-app/migrations");
const wrangler = path.resolve(appRoot, "node_modules/.bin/wrangler");

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) { const nested = await findDatabase(candidate); if (nested) return nested; }
    else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") return candidate;
  }
  return null;
}

test("0050 keeps multipart state and source cutover records creator-scoped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-source-media-"));
  let db;
  try {
    const migrations = path.join(root, "migrations"); const state = path.join(root, "state");
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({ name: "source-media-test", compatibility_date: "2026-08-28", d1_databases: [{ binding: "DB", database_name: "source-media-test", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }] }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "source-media-test", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
    assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    db = new Database(await findDatabase(state));
    db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('second','Second','second','S')").run();
    assert.deepEqual(db.prepare("SELECT active_backend,migration_state,dropbox_fallback_enabled FROM creator_media_source_states WHERE creator_id='second'").get(), { active_backend: "dropbox", migration_state: "dropbox", dropbox_fallback_enabled: 1 });
    db.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES ('source-a','adelaide','source-a.jpg','source-a.jpg','jpg',10,CURRENT_TIMESTAMP,'other',CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES ('source-b','second','source-b.jpg','source-b.jpg','jpg',10,CURRENT_TIMESTAMP,'other',CURRENT_TIMESTAMP)").run();
    const checksum = "a".repeat(64);
    db.prepare("INSERT INTO asset_storage_objects (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status) VALUES ('object-a','adelaide','source-a','r2','canonical_original','library_media','originals/v1/a','source-a.jpg',10,'image/jpeg',?,'m1_direct','pending')").run(checksum);
    db.prepare("INSERT INTO asset_ingest_sessions (id,creator_id,asset_id,storage_object_id,expected_sha256,expected_bytes,expected_mime_type,status,expires_at,object_key,multipart_upload_id,chunk_bytes,actor_email,actor_role) VALUES ('session-a','adelaide','source-a','object-a',?,10,'image/jpeg','created',datetime('now','+30 minutes'),'originals/v1/a','temporary-id',8388608,'admin@example.test','agency_admin')").run(checksum);
    db.prepare("INSERT INTO asset_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES ('session-a','adelaide',1,10,'uploaded')").run();
    assert.throws(() => db.prepare("INSERT INTO asset_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES ('session-a','second',2,10,'uploaded')").run(), /asset_ingest_part_creator_mismatch/);
    assert.throws(() => db.prepare("INSERT INTO creator_media_source_events (id,creator_id,asset_id,actor_email,actor_role,event_type) VALUES ('cross','second','source-a','admin@example.test','agency_admin','intent_created')").run(), /creator_media_source_event_creator_mismatch/);
    db.prepare("UPDATE creator_media_source_states SET active_backend='r2',migration_state='r2_active',dropbox_fallback_enabled=0 WHERE creator_id='adelaide'").run();
    assert.deepEqual(db.prepare("SELECT active_backend,migration_state,dropbox_fallback_enabled FROM creator_media_source_states WHERE creator_id='adelaide'").get(), { active_backend: "r2", migration_state: "r2_active", dropbox_fallback_enabled: 0 });
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally { db?.close(); await rm(root, { recursive: true, force: true }); }
});
