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
    db.prepare(sql).run("account-1", "creator-1", "reddit", "Main Reddit", "u/example", "not_configured", "social", "creator@example.com", "https://reddit.com/u/example", "Publishing", 1, "OAuth", 1, "", "[]", "");
    assert.deepEqual(db.prepare("SELECT creator_id,platform,label,account_kind,is_active,creator_visible,publishing_authority FROM operational_accounts").get(), { creator_id: "creator-1", platform: "reddit", label: "Main Reddit", account_kind: "social", is_active: 1, creator_visible: 1, publishing_authority: "not_configured" });
  } finally { db.close(); }
});
