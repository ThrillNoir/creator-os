import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { approveCreatorSocialAccountSql, auditApprovedCreatorSocialAccountSql } from "../src/lib/onboarding-account-review.ts";

test("account review activates only a pending creator-added profile in the active workspace", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE creator_onboarding_profiles(creator_id TEXT,workflow_state TEXT);
      CREATE TABLE operational_accounts(id TEXT,creator_id TEXT,account_kind TEXT,platform TEXT,is_active INTEGER,creator_visible INTEGER,publishing_authority TEXT,updated_at TEXT);
      CREATE TABLE creator_access_audit_events(id TEXT,creator_id TEXT,actor_email TEXT,actor_role TEXT,event_type TEXT,subject TEXT,detail TEXT);
      INSERT INTO creator_onboarding_profiles VALUES ('amber','active'),('birch','active'),('coral','draft');
      INSERT INTO operational_accounts VALUES
        ('amber-main','amber','social','instagram',1,1,'not_configured',NULL),
        ('amber-new','amber','social','instagram',0,1,'not_configured',NULL),
        ('amber-retired','amber','social','reddit',0,1,'blocked',NULL),
        ('amber-unsubmitted','amber','social','tiktok',0,1,'not_configured',NULL),
        ('birch-new','birch','social','instagram',0,1,'not_configured',NULL),
        ('coral-new','coral','social','reddit',0,1,'not_configured',NULL);
      INSERT INTO creator_access_audit_events(creator_id,subject,actor_role,event_type) VALUES
        ('amber','amber-new','creator','onboarding_operational_account_created'),
        ('amber','amber-retired','creator','onboarding_operational_account_created'),
        ('birch','birch-new','creator','onboarding_operational_account_created'),
        ('coral','coral-new','creator','onboarding_operational_account_created');
    `);
    const approve = db.prepare(approveCreatorSocialAccountSql);
    for (const id of ["amber-main", "amber-retired", "amber-unsubmitted", "birch-new", "coral-new"]) {
      assert.equal(approve.run(id, "amber").changes, 0, `${id} must not be activated by Amber's review`);
    }
    assert.equal(approve.run("amber-new", "amber").changes, 1);
    const audit = db.prepare(auditApprovedCreatorSocialAccountSql);
    assert.equal(audit.run("review", "amber", "admin@synthetic.invalid", "agency_admin", "amber-new", "{}").changes, 1);
    assert.equal(approve.run("amber-new", "amber").changes, 0, "the same approval cannot be replayed");
    assert.equal(audit.run("replay", "amber", "admin@synthetic.invalid", "agency_admin", "amber-new", "{}").changes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_access_audit_events WHERE event_type='creator_social_profile_approved'").get().count, 1);
    assert.equal(db.prepare("SELECT is_active FROM operational_accounts WHERE id='amber-new'").get().is_active, 1);
    assert.equal(db.prepare("SELECT workflow_state FROM creator_onboarding_profiles WHERE creator_id='amber'").get().workflow_state, "active");
  } finally { db.close(); }
});
