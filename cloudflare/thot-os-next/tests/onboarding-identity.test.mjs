import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import {
  complianceIdentityChanged,
  INVALIDATE_COMPLIANCE_IDENTITY_SQL,
  RESET_IDENTITY_VERIFICATION_SQL,
  SAVE_COMPLIANCE_IDENTITY_SQL,
} from "../src/lib/onboarding-identity.ts";

test("private identity changes invalidate only the changed creator and reopen identity review", async () => {
  const actions = await readFile(new URL("../src/app/onboarding/actions.ts", import.meta.url), "utf8");
  const sectionSql = actions.match(/DB\.prepare\(`(INSERT INTO creator_onboarding_sections[\s\S]*?reviewed_at=NULL)`\)/)?.[1];
  const profileSql = actions.match(/DB\.prepare\("(UPDATE creator_onboarding_profiles SET workflow_state=CASE WHEN \? THEN 'draft'[^"]+)"\)/)?.[1];
  assert.ok(sectionSql);
  assert.ok(profileSql);
  assert.match(actions, /if \(changed\) await changedSection\(identity\.creator\.creator_id, "identity", identity\.email, true\)/);

  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE creator_compliance_records (creator_id TEXT PRIMARY KEY,legal_name TEXT,date_of_birth TEXT,adult_verified_at TEXT,updated_at TEXT);
      CREATE TABLE creator_onboarding_profiles (creator_id TEXT PRIMARY KEY,adult_verification_status TEXT,workflow_state TEXT,updated_at TEXT);
      CREATE TABLE creator_onboarding_sections (creator_id TEXT,section_key TEXT,status TEXT,updated_by TEXT,updated_at TEXT,reviewed_at TEXT,PRIMARY KEY(creator_id,section_key));`);
    db.prepare("INSERT INTO creator_compliance_records VALUES (?,?,?,?,?)").run("creator-1", "Ada Lovelace", "1815-12-10", "verified-at", "old");
    db.prepare("INSERT INTO creator_compliance_records VALUES (?,?,?,?,?)").run("creator-2", "Grace Hopper", "1906-12-09", "other-verified-at", "old");
    db.prepare("INSERT INTO creator_onboarding_profiles VALUES (?,?,?,?)").run("creator-1", "verified", "active", "old");
    db.prepare("INSERT INTO creator_onboarding_profiles VALUES (?,?,?,?)").run("creator-2", "verified", "active", "old");
    db.prepare("INSERT INTO creator_onboarding_sections VALUES (?,?,?,?,?,?)").run("creator-1", "identity", "complete", "admin@example.com", "old", "old");

    const save = db.prepare(SAVE_COMPLIANCE_IDENTITY_SQL);
    const invalidate = db.prepare(INVALIDATE_COMPLIANCE_IDENTITY_SQL);
    const reset = db.prepare(RESET_IDENTITY_VERIFICATION_SQL);
    const writeIdentity = (creatorId, legalName, dateOfBirth) => {
      const previous = db.prepare("SELECT legal_name AS legalName,date_of_birth AS dateOfBirth FROM creator_compliance_records WHERE creator_id=?").get(creatorId);
      const changed = complianceIdentityChanged(previous, { legalName, dateOfBirth });
      db.transaction(() => {
        save.run(creatorId, legalName, dateOfBirth);
        if (changed) { invalidate.run(creatorId); reset.run(creatorId); }
      })();
      return changed;
    };

    assert.equal(writeIdentity("creator-1", "Ada Lovelace", "1815-12-10"), false);
    assert.deepEqual(db.prepare("SELECT legal_name,date_of_birth,adult_verified_at FROM creator_compliance_records WHERE creator_id='creator-1'").get(), { legal_name: "Ada Lovelace", date_of_birth: "1815-12-10", adult_verified_at: "verified-at" });
    assert.equal(writeIdentity("creator-1", "Ada Byron Lovelace", "1815-12-10"), true);
    db.prepare(sectionSql).run("creator-1", "identity", "draft", "creator@example.com", 1);
    db.prepare(profileSql).run(1, "creator-1");
    assert.deepEqual(db.prepare("SELECT legal_name,adult_verified_at FROM creator_compliance_records WHERE creator_id='creator-1'").get(), { legal_name: "Ada Byron Lovelace", adult_verified_at: null });
    assert.equal(db.prepare("SELECT adult_verification_status,workflow_state FROM creator_onboarding_profiles WHERE creator_id='creator-1'").get().adult_verification_status, "submitted");
    assert.equal(db.prepare("SELECT status FROM creator_onboarding_sections WHERE creator_id='creator-1' AND section_key='identity'").pluck().get(), "draft");
    assert.deepEqual(db.prepare("SELECT legal_name,adult_verified_at FROM creator_compliance_records WHERE creator_id='creator-2'").get(), { legal_name: "Grace Hopper", adult_verified_at: "other-verified-at" });
  } finally { db.close(); }
});
