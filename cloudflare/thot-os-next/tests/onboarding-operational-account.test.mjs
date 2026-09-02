import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";

test("Reddit operational account creation binds every SQL placeholder", async () => {
  const source = await readFile(new URL("../src/app/onboarding/actions.ts", import.meta.url), "utf8");
  const sql = source.match(/DB\.prepare\(`(INSERT INTO operational_accounts[\s\S]*?)`\)\.bind\(id, creatorId, platform/)?.[1];
  assert.ok(sql);
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE operational_accounts (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority,account_kind,login_email,profile_url,account_purpose,is_active,connection_method,creator_visible,administrator_notes,capabilities_json,private_upload_destination)`);
    db.prepare(sql).run("account-1", "creator-1", "reddit", "Main Reddit", "u/example", "social", "creator@example.com", "https://reddit.com/u/example", "Publishing", 1, "OAuth", 1, "", "[]", "");
    assert.deepEqual(db.prepare("SELECT creator_id,platform,label,account_kind,is_active,creator_visible,publishing_authority FROM operational_accounts").get(), { creator_id: "creator-1", platform: "reddit", label: "Main Reddit", account_kind: "social", is_active: 1, creator_visible: 1, publishing_authority: "not_configured" });
  } finally { db.close(); }
});

test("activation enables only creator-submitted pending accounts", async () => {
  const source = await readFile(new URL("../src/app/onboarding/actions.ts", import.meta.url), "utf8");
  const sql = source.match(/DB\.prepare\("(UPDATE operational_accounts SET is_active=1[^"]+)"\)\.bind\(creatorId\)/)?.[1];
  assert.ok(sql);
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE operational_accounts (id TEXT,creator_id TEXT,account_kind TEXT,creator_visible INTEGER,is_active INTEGER,publishing_authority TEXT,updated_at TEXT);
      CREATE TABLE creator_access_audit_events (creator_id TEXT,subject TEXT,actor_role TEXT,event_type TEXT);
      CREATE TABLE creator_onboarding_profiles (creator_id TEXT,workflow_state TEXT,adult_verification_status TEXT,contract_status TEXT,consent_status TEXT);
      CREATE TABLE creator_compliance_records (creator_id TEXT,adult_verified_at TEXT);`);
    db.prepare("INSERT INTO creator_onboarding_profiles VALUES (?,?,?,?,?)").run("creator-1", "active", "verified", "active", "recorded");
    db.prepare("INSERT INTO creator_compliance_records VALUES (?,?)").run("creator-1", "verified-at");
    db.prepare("INSERT INTO operational_accounts VALUES (?,?,?,?,?,?,?)").run("creator-account", "creator-1", "social", 1, 0, "not_configured", "old");
    db.prepare("INSERT INTO operational_accounts VALUES (?,?,?,?,?,?,?)").run("admin-account", "creator-1", "social", 1, 0, "not_configured", "old");
    db.prepare("INSERT INTO creator_access_audit_events VALUES (?,?,?,?)").run("creator-1", "creator-account", "creator", "onboarding_operational_account_created");
    db.prepare(sql).run("creator-1");
    assert.equal(db.prepare("SELECT is_active FROM operational_accounts WHERE id='creator-account'").pluck().get(), 1);
    assert.equal(db.prepare("SELECT is_active FROM operational_accounts WHERE id='admin-account'").pluck().get(), 0);
  } finally { db.close(); }
});
