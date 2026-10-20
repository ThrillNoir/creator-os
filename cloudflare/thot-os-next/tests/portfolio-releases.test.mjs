import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

const migration = readFileSync(new URL("../../thot-os-app/migrations/0067_creator_portfolio_releases.sql", import.meta.url), "utf8");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE creators (id TEXT PRIMARY KEY);
    CREATE TABLE users (email TEXT PRIMARY KEY);
    CREATE TABLE creator_adult_profile_versions (id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,UNIQUE(id,creator_id));
    INSERT INTO creators(id) VALUES ('adelaide'),('other');
    INSERT INTO users(email) VALUES ('creator@example.test');
    INSERT INTO creator_adult_profile_versions(id,creator_id) VALUES ('adult-a','adelaide'),('adult-b','other');`);
  db.exec(migration);
  return db;
}

test("an approved Portfolio release is creator and adult-profile scoped and keeps its approved manifest immutable", () => {
  const db = fixture();
  try {
    const insert = db.prepare(`INSERT INTO creator_portfolio_release_versions
      (id,creator_id,adult_profile_version_id,status,manifest_json,approved_by) VALUES (?,?,?,'approved',?,?)`);
    const manifest = JSON.stringify({ schemaVersion: 1, cards: [{ id: "public-card" }] });
    assert.throws(() => insert.run("release-foreign", "adelaide", "adult-b", manifest, "creator@example.test"), /FOREIGN KEY/);
    insert.run("release-a", "adelaide", "adult-a", manifest, "creator@example.test");
    assert.equal(db.prepare("SELECT status FROM creator_portfolio_release_versions WHERE id='release-a'").get().status, "approved");
    assert.throws(() => db.prepare("UPDATE creator_portfolio_release_versions SET manifest_json=? WHERE id='release-a'").run("{}"), /portfolio_release_approval_immutable/);
    assert.throws(() => db.prepare("UPDATE creator_portfolio_release_versions SET adult_profile_version_id='adult-b' WHERE id='release-a'").run(), /portfolio_release_approval_immutable/);
    db.prepare("UPDATE creator_portfolio_release_versions SET status='published',published_at=CURRENT_TIMESTAMP WHERE id='release-a'").run();
    insert.run("release-a2", "adelaide", "adult-a", manifest, "creator@example.test");
    insert.run("release-a3", "adelaide", "adult-a", manifest, "creator@example.test");
    db.prepare("UPDATE creator_portfolio_release_versions SET status='publishing' WHERE id='release-a2'").run();
    assert.throws(() => db.prepare("UPDATE creator_portfolio_release_versions SET status='withdrawing' WHERE id='release-a3'").run(), /UNIQUE/);
    db.prepare("INSERT INTO creator_portfolio_release_events(id,creator_id,release_version_id,actor,event_type) VALUES ('event-a','adelaide','release-a','creator@example.test','approved')").run();
    assert.throws(() => db.prepare("INSERT INTO creator_portfolio_release_events(id,creator_id,release_version_id,actor,event_type) VALUES ('event-b','other','release-a','creator@example.test','approved')").run(), /FOREIGN KEY/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally { db.close(); }
});
