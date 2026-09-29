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

test("0050 through 0054 keep source ingestion, native authority, video intake, and cutover readiness creator-scoped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-source-media-"));
  let db;
  try {
    const migrations = path.join(root, "migrations"); const state = path.join(root, "state");
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({ name: "source-media-test", compatibility_date: "2026-08-28", d1_databases: [{ binding: "DB", database_name: "source-media-test", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }] }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "source-media-test", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    db = new Database(await findDatabase(state));
    db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('second','Second','second','S')").run();
    assert.deepEqual(db.prepare("SELECT COUNT(*) AS consumers,SUM(CASE WHEN status='compatible' THEN 1 ELSE 0 END) AS compatible FROM source_media_consumer_capabilities").get(), { consumers: 4, compatible: 0 });
    const evidence = "e".repeat(64);
    db.prepare("UPDATE source_media_consumer_capabilities SET status='compatible',worker_version='version',evidence_sha256=? WHERE service_name IN ('web','vault')").run(evidence);
    assert.equal(db.prepare("SELECT COUNT(*) AS ready FROM source_media_consumer_capabilities WHERE status='compatible' AND worker_version IS NOT NULL AND evidence_sha256 IS NOT NULL").get().ready, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS rows FROM creator_source_media_consumer_readiness WHERE creator_id IN ('adelaide','second')").get().rows, 8);
    assert.throws(() => db.prepare("UPDATE creator_source_media_consumer_readiness SET status='compatible' WHERE creator_id='adelaide' AND service_name='web'").run(), /CHECK constraint failed/);
    db.prepare("UPDATE creator_source_media_consumer_readiness SET status='compatible',worker_version='version',deployment_evidence_sha256=?,health_evidence_sha256=?,asset_coverage_sha256=?,verified_at=CURRENT_TIMESTAMP,reason_code='ready' WHERE creator_id='adelaide' AND service_name='web'").run(evidence, evidence, evidence);
    assert.deepEqual(db.prepare("SELECT status,reason_code FROM creator_source_media_consumer_readiness WHERE creator_id='adelaide' AND service_name='web'").get(), { status: "compatible", reason_code: "ready" });
    assert.deepEqual(db.prepare("SELECT active_backend,migration_state,dropbox_fallback_enabled FROM creator_media_source_states WHERE creator_id='second'").get(), { active_backend: "dropbox", migration_state: "dropbox", dropbox_fallback_enabled: 1 });
    db.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES ('source-a','adelaide','source-a.jpg','source-a.jpg','jpg',10,CURRENT_TIMESTAMP,'other',CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES ('source-b','second','source-b.jpg','source-b.jpg','jpg',10,CURRENT_TIMESTAMP,'other',CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES ('source-video','adelaide','native/source-video','source-video.mov','mov',10,CURRENT_TIMESTAMP,'native_direct',CURRENT_TIMESTAMP)").run();
    const checksum = "a".repeat(64);
    db.prepare("INSERT INTO asset_storage_objects (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status) VALUES ('object-a','adelaide','source-a','r2','canonical_original','library_media','originals/v1/a','source-a.jpg',10,'image/jpeg',?,'m1_direct','pending')").run(checksum);
    db.prepare("INSERT INTO asset_storage_objects (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status) VALUES ('object-video','adelaide','source-video','r2','canonical_original','library_media','originals/v1/video','source-video.mov',10,'application/octet-stream',?,'m1_direct','pending')").run(checksum);
    db.prepare("INSERT INTO asset_ingest_sessions (id,creator_id,asset_id,storage_object_id,expected_sha256,expected_bytes,expected_mime_type,status,expires_at,object_key,multipart_upload_id,chunk_bytes,actor_email,actor_role) VALUES ('session-a','adelaide','source-a','object-a',?,10,'image/jpeg','created',datetime('now','+30 minutes'),'originals/v1/a','temporary-id',8388608,'admin@example.test','agency_admin')").run(checksum);
    db.prepare("INSERT INTO asset_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES ('session-a','adelaide',1,10,'uploaded')").run();
    assert.deepEqual(db.prepare("SELECT finalization_state,reconcile_attempts FROM asset_ingest_sessions WHERE id='session-a'").get(), { finalization_state: "incomplete", reconcile_attempts: 0 });
    assert.throws(() => db.prepare("INSERT INTO asset_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES ('session-a','second',2,10,'uploaded')").run(), /asset_ingest_part_creator_mismatch/);
    db.prepare("INSERT INTO asset_video_ingest_sessions (id,creator_id,asset_id,storage_object_id,source_revision,expected_sha256,expected_bytes,expected_mime_type,status,expires_at,object_key,multipart_upload_id,chunk_bytes,actor_email,actor_role,client_upload_id) VALUES ('video-session','adelaide','source-video','object-video','native_video:upload-a',?,10,'video/quicktime','created',datetime('now','+8 hours'),'originals/v1/video','temporary-video-id',8388608,'admin@example.test','agency_admin','00000000-0000-4000-8000-000000000001')").run(checksum);
    db.prepare("INSERT INTO asset_video_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES ('video-session','adelaide',1,10,'uploaded')").run();
    db.prepare("INSERT INTO asset_video_playback_states (asset_id,creator_id,canonical_storage_object_id,state) VALUES ('source-video','adelaide','object-video','uploading')").run();
    assert.deepEqual(db.prepare("SELECT status,finalization_state,playback_provider FROM asset_video_ingest_sessions s JOIN asset_video_playback_states p ON p.asset_id=s.asset_id WHERE s.id='video-session'").get(), { status: "created", finalization_state: "incomplete", playback_provider: "none" });
    assert.throws(() => db.prepare("INSERT INTO asset_video_ingest_parts (session_id,creator_id,part_number,byte_count,status) VALUES ('video-session','second',2,10,'uploaded')").run(), /asset_video_ingest_part_creator_mismatch/);
    assert.throws(() => db.prepare("INSERT INTO asset_video_playback_states (asset_id,creator_id,canonical_storage_object_id,state) VALUES ('source-b','adelaide','object-video','uploading')").run(), /asset_video_playback_creator_mismatch/);
    assert.throws(() => db.prepare("INSERT INTO creator_media_source_events (id,creator_id,asset_id,actor_email,actor_role,event_type) VALUES ('cross','second','source-a','admin@example.test','agency_admin','intent_created')").run(), /creator_media_source_event_creator_mismatch/);
    assert.throws(() => db.prepare("UPDATE asset_storage_objects SET ingest_status='verified' WHERE id='object-a'").run(), /verified_r2_identity_required/);
    db.prepare("UPDATE asset_storage_objects SET ingest_status='verified',r2_version='version-a',r2_etag='etag-a' WHERE id='object-a'").run();
    assert.deepEqual(db.prepare("SELECT r2_version,r2_etag FROM asset_storage_objects WHERE id='object-a'").get(), { r2_version: "version-a", r2_etag: "etag-a" });
    db.prepare("INSERT INTO asset_media_authorities (asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state) VALUES ('source-a','adelaide','r2_native','cloudflare_direct','object-a','ingesting')").run();
    assert.deepEqual(db.prepare("SELECT authority_kind,ingest_channel,state FROM asset_media_authorities WHERE asset_id='source-a'").get(), { authority_kind: "r2_native", ingest_channel: "cloudflare_direct", state: "ingesting" });
    assert.throws(() => db.prepare("INSERT INTO asset_media_authorities (asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state) VALUES ('source-b','adelaide','r2_native','cloudflare_direct','object-a','ingesting')").run(), /asset_media_authority_creator_mismatch/);
    db.prepare("INSERT INTO asset_ingest_sessions (id,creator_id,asset_id,storage_object_id,source_revision,expected_sha256,expected_bytes,expected_mime_type,status,expires_at,object_key,multipart_upload_id,chunk_bytes,actor_email,actor_role,ingest_kind,client_upload_id) VALUES ('native-session-a','adelaide','source-a','object-a','native:upload-a',?,10,'image/jpeg','created',datetime('now','+30 minutes'),'originals/v1/a','temporary-native-id',8388608,'admin@example.test','agency_admin','native_image','upload-a')").run(checksum);
    assert.deepEqual(db.prepare("SELECT ingest_kind,client_upload_id FROM asset_ingest_sessions WHERE id='native-session-a'").get(), { ingest_kind: "native_image", client_upload_id: "upload-a" });
    assert.throws(() => db.prepare("INSERT INTO asset_ingest_sessions (id,creator_id,asset_id,storage_object_id,source_revision,expected_sha256,expected_bytes,expected_mime_type,status,expires_at,object_key,multipart_upload_id,chunk_bytes,actor_email,actor_role,ingest_kind,client_upload_id) VALUES ('native-session-b','adelaide','source-a','object-a','native:upload-b',?,10,'image/jpeg','created',datetime('now','+30 minutes'),'originals/v1/a','temporary-native-id-2',8388608,'admin@example.test','agency_admin','native_image','upload-a')").run(checksum), /UNIQUE constraint failed/);
    db.prepare("UPDATE asset_ingest_sessions SET status='uploading' WHERE id='session-a'").run();
    const firstClaim = db.prepare("UPDATE asset_ingest_sessions SET finalization_state='completing' WHERE id='session-a' AND finalization_state='incomplete' AND status IN ('created','uploading')").run();
    const duplicateClaim = db.prepare("UPDATE asset_ingest_sessions SET finalization_state='completing' WHERE id='session-a' AND finalization_state='incomplete' AND status IN ('created','uploading')").run();
    assert.equal(firstClaim.changes, 1); assert.equal(duplicateClaim.changes, 0);
    db.prepare("UPDATE asset_ingest_sessions SET finalization_state='completed_unreconciled',completed_r2_version='version-a',completed_r2_etag='etag-a' WHERE id='session-a'").run();
    assert.deepEqual(db.prepare("SELECT finalization_state,multipart_upload_id FROM asset_ingest_sessions WHERE id='session-a'").get(), { finalization_state: "completed_unreconciled", multipart_upload_id: "temporary-id" });
    db.prepare("UPDATE asset_ingest_sessions SET status='finalized',finalization_state='verified',multipart_upload_id=NULL WHERE id='session-a' AND finalization_state='completed_unreconciled'").run();
    assert.deepEqual(db.prepare("SELECT status,finalization_state,multipart_upload_id FROM asset_ingest_sessions WHERE id='session-a'").get(), { status: "finalized", finalization_state: "verified", multipart_upload_id: null });
    db.prepare("UPDATE creator_media_source_states SET active_backend='r2',migration_state='r2_active',dropbox_fallback_enabled=0 WHERE creator_id='adelaide'").run();
    assert.deepEqual(db.prepare("SELECT active_backend,migration_state,dropbox_fallback_enabled FROM creator_media_source_states WHERE creator_id='adelaide'").get(), { active_backend: "r2", migration_state: "r2_active", dropbox_fallback_enabled: 0 });
    db.prepare("INSERT INTO creator_media_source_cutover_receipts (id,creator_id,plan_sha256,git_sha,asset_coverage_sha256,readiness_evidence_sha256,applied_by,action) VALUES ('cutover:test','adelaide',?,?,?,?,?,'r2_cutover')").run(evidence, "b".repeat(40), evidence, evidence, "service:test");
    assert.equal(db.prepare("SELECT COUNT(*) AS receipts FROM creator_media_source_cutover_receipts WHERE creator_id='adelaide' AND action='r2_cutover'").get().receipts, 1);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally { db?.close(); await rm(root, { recursive: true, force: true }); }
});
