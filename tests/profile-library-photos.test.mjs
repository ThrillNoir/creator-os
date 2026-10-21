import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";

const migrations = new URL("../cloudflare/thot-os-app/migrations/", import.meta.url);
function fixture() {
  const db = new Database(":memory:");
  for (const name of readdirSync(migrations).filter((item) => item.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(name, migrations), "utf8"));
  db.exec(`
    INSERT INTO creators(id,name,slug,initials) VALUES ('alice','Alice','alice','A'),('bob','Bob','bob','B');
    INSERT INTO users(email,display_name) VALUES ('creator@example.test','Creator');
    INSERT INTO creator_public_profiles(id,creator_id,slug,created_by) VALUES ('p-alice','alice','alice','creator@example.test');
    INSERT INTO creator_public_profile_versions(id,profile_id,creator_id,version_number,display_name,content_checksum,created_by)
      VALUES ('v-alice','p-alice','alice',1,'Alice','${"a".repeat(64)}','creator@example.test');
    INSERT INTO creator_adult_profiles(id,creator_id,created_by) VALUES ('adult-alice','alice','creator@example.test');
    INSERT INTO creator_adult_profile_versions(id,profile_id,creator_id,version_number,content_checksum,created_by)
      VALUES ('av-alice','adult-alice','alice',1,'${"a".repeat(64)}','creator@example.test');
    INSERT INTO assets(id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at,media_r2_key)
      VALUES ('photo-alice','alice','photo.jpg','photo.jpg','jpg',1024,'2026-10-21','image','2026-10-21','originals/v1/alice');
    INSERT INTO asset_storage_objects(id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,
      byte_count,verified_mime_type,sha256,source_provider,ingest_status,r2_version,r2_etag)
      VALUES ('source-alice','alice','photo-alice','r2','canonical_original','library_media','originals/v1/alice','photo.jpg',
      1024,'image/jpeg','${"b".repeat(64)}','m1_direct','verified','version-1','etag-1');
    INSERT INTO asset_media_authorities(asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state)
      VALUES ('photo-alice','alice','r2_native','cloudflare_direct','source-alice','canonical_verified');
    INSERT INTO creator_profile_library_photo_derivatives(id,creator_id,asset_id,storage_object_id,source_sha256,
      source_r2_version,source_r2_etag,display_object_key,display_sha256,preview_object_key,preview_sha256)
      VALUES ('derivative-alice','alice','photo-alice','source-alice','${"b".repeat(64)}','version-1','etag-1',
      'profile-library/alice/display.webp','${"c".repeat(64)}','profile-library/alice/preview.webp','${"d".repeat(64)}');
  `);
  return db;
}

test("Library profile selections require a creator and surface grant, then remain draft-scoped", () => {
  const db = fixture();
  const insert = db.prepare(`INSERT INTO creator_profile_library_photo_selections
    (id,creator_id,surface,public_profile_version_id,derivative_id,position) VALUES (?,?,?,?,?,?)`);
  assert.throws(() => insert.run("selection-one", "alice", "public_sfw", "v-alice", "derivative-alice", 0), /profile_library_selection_invalid/);
  db.prepare("INSERT INTO creator_profile_library_photo_grants (creator_id,asset_id,surface,confirmed_by) VALUES (?,?,?,?)")
    .run("alice", "photo-alice", "public_sfw", "creator@example.test");
  insert.run("selection-one", "alice", "public_sfw", "v-alice", "derivative-alice", 0);
  assert.throws(() => insert.run("selection-two", "alice", "public_sfw", "v-alice", "derivative-alice", 1), /UNIQUE/);
  assert.throws(() => db.prepare(`INSERT INTO creator_profile_library_photo_selections
    (id,creator_id,surface,adult_profile_version_id,derivative_id,position) VALUES (?,?,?,?,?,?)`)
    .run("adult-selection", "alice", "adult_profile", "av-alice", "derivative-alice", 0), /profile_library_selection_invalid/);
  assert.throws(() => insert.run("foreign", "bob", "public_sfw", "v-alice", "derivative-alice", 1), /FOREIGN KEY|profile_library_selection_invalid/);
  db.prepare("UPDATE creator_public_profile_versions SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=?")
    .run("creator@example.test", "v-alice");
  assert.throws(() => db.prepare("DELETE FROM creator_profile_library_photo_selections WHERE id=?").run("selection-one"), /profile_library_selection_requires_draft/);
  db.close();
});

test("a linked person needs an explicit grant for this profile use", () => {
  const db = fixture();
  db.prepare("INSERT INTO people(id,creator_id,display_name) VALUES (?,?,?)").run(7, "alice", "Collaborator");
  db.prepare("INSERT INTO asset_people(asset_id,creator_id,person_id) VALUES (?,?,?)").run("photo-alice", "alice", 7);
  db.prepare("INSERT INTO creator_profile_library_photo_grants (creator_id,asset_id,surface,confirmed_by) VALUES (?,?,?,?)")
    .run("alice", "photo-alice", "public_sfw", "creator@example.test");
  const insert = db.prepare(`INSERT INTO creator_profile_library_photo_selections
    (id,creator_id,surface,public_profile_version_id,derivative_id,position) VALUES (?,?,?,?,?,?)`);
  assert.throws(() => insert.run("selection-one", "alice", "public_sfw", "v-alice", "derivative-alice", 0), /profile_library_selection_invalid/);
  db.prepare(`INSERT INTO creator_profile_library_subject_grants
    (creator_id,asset_id,person_id,surface,evidence_note,confirmed_by) VALUES (?,?,?,?,?,?)`)
    .run("alice", "photo-alice", 7, "public_sfw", "Recorded permission for public profile", "creator@example.test");
  insert.run("selection-one", "alice", "public_sfw", "v-alice", "derivative-alice", 0);
  assert.throws(() => db.prepare(`INSERT INTO creator_profile_library_subject_grants
    (creator_id,asset_id,person_id,surface,evidence_note,confirmed_by) VALUES (?,?,?,?,?,?)`)
    .run("bob", "photo-alice", 7, "public_sfw", "Invalid", "creator@example.test"), /profile_library_subject_scope_invalid/);
  db.close();
});

test("a new private draft can carry forward a published photo without changing the live selection", () => {
  const db = fixture();
  db.prepare("INSERT INTO creator_profile_library_photo_grants (creator_id,asset_id,surface,confirmed_by) VALUES (?,?,?,?)")
    .run("alice", "photo-alice", "public_sfw", "creator@example.test");
  db.prepare(`INSERT INTO creator_profile_library_photo_selections
    (id,creator_id,surface,public_profile_version_id,derivative_id,position) VALUES (?,?,?,?,?,?)`)
    .run("live-photo", "alice", "public_sfw", "v-alice", "derivative-alice", 0);
  db.prepare("UPDATE creator_public_profile_versions SET status='published',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=?")
    .run("creator@example.test", "v-alice");
  db.prepare(`INSERT INTO creator_public_profile_versions(id,profile_id,creator_id,version_number,display_name,content_checksum,created_by)
    VALUES ('v-next','p-alice','alice',2,'Alice','${"a".repeat(64)}','creator@example.test')`).run();
  db.prepare(`INSERT INTO creator_profile_library_photo_selections
    (id,creator_id,surface,public_profile_version_id,derivative_id,position)
    SELECT 'draft-photo',creator_id,surface,'v-next',derivative_id,position
    FROM creator_profile_library_photo_selections WHERE public_profile_version_id='v-alice'`).run();
  db.prepare("DELETE FROM creator_profile_library_photo_selections WHERE id='draft-photo'").run();
  assert.equal(db.prepare("SELECT count(*) AS count FROM creator_profile_library_photo_selections WHERE id='live-photo'").get().count, 1);
  db.close();
});

test("publication rechecks rights and the exact canonical source", async () => {
  const db = fixture();
  db.prepare("INSERT INTO creator_profile_library_photo_grants (creator_id,asset_id,surface,confirmed_by) VALUES (?,?,?,?)")
    .run("alice", "photo-alice", "public_sfw", "creator@example.test");
  db.prepare(`INSERT INTO creator_profile_library_photo_selections
    (id,creator_id,surface,public_profile_version_id,derivative_id,position) VALUES (?,?,?,?,?,?)`)
    .run("selection-one", "alice", "public_sfw", "v-alice", "derivative-alice", 0);
  const source = readFileSync(new URL("../cloudflare/thot-os-public-links-control/src/index.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function loadLibraryProfileMedia("), source.indexOf("/** Revocation is driven"));
  const load = new Function(`return (${stripTypeScriptTypes(body)})`)();
  const env = { DB: { prepare(sql) {
    const statement = db.prepare(sql);
    return { bind(...args) { return { first: async () => statement.get(...args), all: async () => ({ results: statement.all(...args) }) }; } };
  } } };
  const ready = await load(env, "public_sfw", "alice", "v-alice");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].image_role, "avatar");
  db.prepare("UPDATE creator_profile_library_photo_grants SET revoked_at=CURRENT_TIMESTAMP WHERE creator_id=? AND asset_id=? AND surface=?")
    .run("alice", "photo-alice", "public_sfw");
  await assert.rejects(load(env, "public_sfw", "alice", "v-alice"), /permission checks/);
  db.prepare("UPDATE creator_profile_library_photo_grants SET revoked_at=NULL WHERE creator_id=? AND asset_id=? AND surface=?")
    .run("alice", "photo-alice", "public_sfw");
  db.prepare("UPDATE asset_storage_objects SET r2_etag='changed' WHERE id='source-alice'").run();
  await assert.rejects(load(env, "public_sfw", "alice", "v-alice"), /source or permission checks/);
  db.close();
});
