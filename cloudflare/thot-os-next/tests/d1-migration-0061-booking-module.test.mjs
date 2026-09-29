import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const migration = path.resolve(import.meta.dirname, "../../thot-os-app/migrations/0061_creator_booking_module.sql");

test("0061 stores booking settings only against the owning draft profile version", async () => {
  const db = new Database(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE creators (id TEXT PRIMARY KEY); CREATE TABLE creator_public_profile_versions (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, creator_id TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(id,creator_id), FOREIGN KEY(creator_id) REFERENCES creators(id));");
    db.exec(await readFile(migration, "utf8"));
    db.prepare("INSERT INTO creators (id) VALUES ('adelaide')").run();
    db.prepare("INSERT INTO creators (id) VALUES ('second')").run();
    db.prepare("INSERT INTO creator_public_profile_versions (id,profile_id,creator_id,status) VALUES ('booking-draft','booking-profile','adelaide','draft')").run();
    db.prepare("INSERT INTO creator_public_profile_versions (id,profile_id,creator_id,status) VALUES ('booking-published','booking-profile','adelaide','approved')").run();
    db.prepare("INSERT INTO creator_public_profile_versions (id,profile_id,creator_id,status) VALUES ('other-draft','other-profile','second','draft')").run();
    db.prepare("INSERT INTO creator_booking_configs (profile_version_id,creator_id,config_json) VALUES ('booking-draft','adelaide',?)").run('{"enabled":false,"label":"Booking enquiry","rules":"","wear":[],"extras":[]}');
    assert.throws(() => db.prepare("UPDATE creator_booking_configs SET profile_version_id='booking-published' WHERE profile_version_id='booking-draft'").run(), /booking_config_requires_draft_version/);
    assert.throws(() => db.prepare("UPDATE creator_booking_configs SET profile_version_id='other-draft',creator_id='second' WHERE profile_version_id='booking-draft'").run(), /booking_config_requires_draft_version/);
    db.prepare("UPDATE creator_public_profile_versions SET status='approved' WHERE id='booking-draft'").run();
    assert.throws(() => db.prepare("UPDATE creator_booking_configs SET config_json='{}' WHERE profile_version_id='booking-draft'").run(), /booking_config_requires_draft_version/);
    assert.throws(() => db.prepare("INSERT INTO creator_booking_configs (profile_version_id,creator_id,config_json) VALUES ('booking-draft','adelaide','{}')").run(), /booking_config_requires_draft_version/);
    assert.throws(() => db.prepare("DELETE FROM creator_booking_configs WHERE profile_version_id='booking-draft'").run(), /booking_config_requires_draft_version/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    db.close();
  }
});
