import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";
import { authorizeCreatorScope, roleCan } from "../src/lib/authorization.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const requiredSections = ["identity", "social_profiles", "paid_platforms", "brand_voice", "positioning", "about_me"];

function match(sourceText, pattern, label) {
  const result = sourceText.match(pattern)?.[1];
  assert.ok(result, `Could not find production ${label}`);
  return result;
}

function syntheticDatabase() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE creators (id TEXT PRIMARY KEY, name TEXT, slug TEXT, initials TEXT, accent TEXT, status TEXT);
    CREATE TABLE users (email TEXT PRIMARY KEY COLLATE NOCASE, display_name TEXT, status TEXT);
    CREATE TABLE creator_memberships (
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email) ON DELETE CASCADE,
      role TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (creator_id, user_email)
    );
    CREATE TABLE identity_audit_events (id TEXT PRIMARY KEY, creator_id TEXT REFERENCES creators(id), actor_email TEXT, actor_role TEXT, event_type TEXT, subject TEXT, detail TEXT);
    CREATE TABLE creator_onboarding_profiles (
      creator_id TEXT PRIMARY KEY REFERENCES creators(id), stage_name TEXT DEFAULT '', adult_verification_status TEXT DEFAULT 'not_started',
      contract_status TEXT DEFAULT 'not_started', consent_status TEXT DEFAULT 'not_recorded', workflow_state TEXT DEFAULT 'draft', updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE creator_compliance_records (creator_id TEXT PRIMARY KEY REFERENCES creators(id), legal_name TEXT DEFAULT '', date_of_birth TEXT DEFAULT '', adult_verified_at TEXT, activated_by TEXT, activated_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE creator_onboarding_sections (creator_id TEXT, section_key TEXT, status TEXT, updated_by TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT, PRIMARY KEY (creator_id, section_key));
    CREATE TABLE operational_accounts (id TEXT PRIMARY KEY, creator_id TEXT REFERENCES creators(id), platform TEXT, label TEXT, account_kind TEXT, creator_visible INTEGER, is_active INTEGER, publishing_authority TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE creator_access_audit_events (id TEXT PRIMARY KEY, creator_id TEXT, actor_email TEXT, actor_role TEXT, event_type TEXT, subject TEXT, detail TEXT);
    CREATE TABLE vault_credentials (
      id TEXT PRIMARY KEY, creator_id TEXT, account_id TEXT, credential_group TEXT, label TEXT, username TEXT, login_email TEXT,
      shared_with_creator INTEGER, status TEXT, updated_at TEXT, last_native_password_confirmation_at TEXT, notes TEXT
    );
  `);
  return db;
}

test("synthetic creator invitation claim reaches reviewed activation with production SQL and isolation", async () => {
  const [migration, identityActions, onboardingActions, accessPage] = await Promise.all([
    source("../../thot-os-app/migrations/0056_creator_invitations.sql"),
    source("../src/app/identity-actions.ts"),
    source("../src/app/onboarding/actions.ts"),
    source("../src/app/access/page.tsx"),
  ]);
  const db = syntheticDatabase();
  try {
    db.exec(migration);
    db.exec("INSERT INTO creators VALUES ('new-creator','Synthetic Creator','new-creator','SC','#6f4df6','active'),('other-creator','Other Creator','other-creator','OC','#6f4df6','active')");
    db.exec("INSERT INTO users VALUES ('admin@example.test','Agency Admin','active')");
    db.prepare("INSERT INTO creator_memberships VALUES (?,?,?,?)").run("new-creator", "admin@example.test", "agency_admin", "active");

    const claimSelect = match(identityActions, /DB\.prepare\("(SELECT id,creator_id,invited_email FROM creator_invitations[^\"]+)"\)/, "invitation lookup");
    const createUser = match(identityActions, /DB\.prepare\("(INSERT OR IGNORE INTO users[^\"]+)"\)/, "claim user insert");
    const acceptInvitation = match(identityActions, /DB\.prepare\("(UPDATE creator_invitations SET status='accepted'[^\"]+)"\)/, "invitation acceptance");
    const createMembership = match(identityActions, /DB\.prepare\("(INSERT INTO creator_memberships \(creator_id,user_email,role,status\) SELECT[^\"]+)"\)/, "creator membership insert");
    const claimAudit = match(identityActions, /DB\.prepare\("(INSERT INTO identity_audit_events[^\"]+)"\)\.bind\(crypto\.randomUUID\(\), invitation\.creator_id, identity\.email, "creator", "creator_invitation_accepted"/, "claim audit");
    const createProfile = match(identityActions, /DB\.prepare\("(INSERT INTO creator_onboarding_profiles \(creator_id,stage_name\) VALUES \(\?,\?\))"\)/, "onboarding profile insert");
    const digest = async (token) => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const token = "a".repeat(64);
    const hash = await digest(token);
    const expiredHash = await digest("b".repeat(64));
    const revokedHash = await digest("c".repeat(64));
    const insertInvitation = db.prepare("INSERT INTO creator_invitations (id,creator_id,invited_email,token_hash,expires_at,created_by) VALUES (?,?,?,?,?,?)");
    insertInvitation.run("invite-1", "new-creator", "new.creator@example.test", hash, "2099-01-01", "admin@example.test");
    insertInvitation.run("invite-expired", "new-creator", "expired@example.test", expiredHash, "2000-01-01", "admin@example.test");
    insertInvitation.run("invite-revoked", "new-creator", "revoked@example.test", revokedHash, "2099-01-01", "admin@example.test");
    db.prepare("UPDATE creator_invitations SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id='invite-revoked'").run();
    assert.equal(db.prepare(claimSelect).get(expiredHash), undefined);
    assert.equal(db.prepare(claimSelect).get(revokedHash), undefined);

    const wrongIdentity = "different@example.test";
    const wrongInvite = db.prepare(claimSelect).get(hash);
    assert.equal(wrongInvite.invited_email.toLowerCase() === wrongIdentity, false);
    assert.equal(db.prepare("SELECT status FROM creator_invitations WHERE id='invite-1'").pluck().get(), "pending");
    assert.equal(db.prepare("SELECT COUNT(*) FROM creator_memberships WHERE user_email=?").pluck().get(wrongIdentity), 0);

    const identity = "New.Creator@Example.Test";
    const invitation = db.prepare(claimSelect).get(hash);
    assert.equal(invitation.invited_email.toLowerCase(), identity.toLowerCase());
    db.transaction(() => {
      db.prepare(createUser).run(identity, identity);
      db.prepare(acceptInvitation).run(identity, invitation.id);
      db.prepare(createMembership).run(invitation.creator_id, identity, invitation.id);
      db.prepare(claimAudit).run("audit-claim", invitation.creator_id, identity, "creator", "creator_invitation_accepted", invitation.id, JSON.stringify({ metadataOnly: true }));
    })();
    assert.equal(db.prepare("SELECT status FROM creator_invitations WHERE id='invite-1'").pluck().get(), "accepted");
    assert.equal(db.prepare(claimSelect).get(hash), undefined, "accepted invitations cannot be claimed again");
    assert.equal(db.prepare("SELECT role FROM creator_memberships WHERE creator_id='new-creator' AND lower(user_email)=lower(?)").pluck().get(identity), "creator");
    assert.equal(db.prepare("SELECT detail FROM identity_audit_events WHERE id='audit-claim'").pluck().get(), JSON.stringify({ metadataOnly: true }));
    assert.equal(db.prepare("SELECT COUNT(*) FROM creator_invitations WHERE token_hash=?").pluck().get(token), 0);

    db.prepare(createProfile).run("new-creator", "Synthetic Creator");
    db.prepare("UPDATE creator_onboarding_profiles SET adult_verification_status='verified',contract_status='active',consent_status='recorded' WHERE creator_id='new-creator'").run();
    db.prepare("INSERT INTO creator_compliance_records (creator_id,legal_name,date_of_birth,adult_verified_at) VALUES (?,?,?,?)").run("new-creator", "Synthetic Legal Name", "1990-01-01", "2026-09-02");
    const insertAccount = db.prepare("INSERT INTO operational_accounts (id,creator_id,platform,label,account_kind,creator_visible,is_active,publishing_authority) VALUES (?,?,?,?,?,?,?,?)");
    insertAccount.run("new-paid", "new-creator", "onlyfans", "Synthetic Paid", "paid", 1, 0, "not_configured");
    insertAccount.run("other-paid", "other-creator", "onlyfans", "Other Paid", "paid", 1, 0, "not_configured");
    db.prepare("INSERT INTO creator_access_audit_events VALUES (?,?,?,?,?,?,?)").run("audit-account", "new-creator", identity, "creator", "onboarding_operational_account_created", "new-paid", "{}");
    for (const key of requiredSections) db.prepare("INSERT INTO creator_onboarding_sections (creator_id,section_key,status,updated_by) VALUES (?,?,?,?)").run("new-creator", key, "creator_review", identity);

    const completeCheck = `(SELECT COUNT(*) FROM creator_onboarding_sections s WHERE s.creator_id=creator_onboarding_profiles.creator_id AND s.status='complete' AND s.section_key IN (${requiredSections.map((key) => `'${key}'`).join(",")}))=${requiredSections.length}`;
    const activateProfile = match(onboardingActions, /DB\.prepare\(`(UPDATE creator_onboarding_profiles SET workflow_state='active'[^`]*)`\)\.bind\(creatorId\)/, "profile activation SQL").replace('${requiredSectionsCompleteSql("creator_onboarding_profiles")}', completeCheck);
    const activateAccount = match(onboardingActions, /DB\.prepare\(`(UPDATE operational_accounts SET is_active=1[^`]*)`\)\.bind\(creatorId\)/, "account activation SQL").replace('${requiredSectionsCompleteSql("p")}', completeCheck.replace("creator_onboarding_profiles", "p"));
    const activateCompliance = match(onboardingActions, /DB\.prepare\(`(UPDATE creator_compliance_records SET activated_by=\?[^`]*)`\)\.bind\(identity\.email,creatorId\)/, "compliance activation SQL").replace('${requiredSectionsCompleteSql("p")}', completeCheck.replace("creator_onboarding_profiles", "p"));
    assert.equal(db.prepare(activateProfile).run("new-creator").changes, 0);
    assert.equal(db.prepare("SELECT workflow_state FROM creator_onboarding_profiles WHERE creator_id='new-creator'").pluck().get(), "draft");

    const reviewSection = match(onboardingActions, /cloudflareEnv\(\)\.DB\.prepare\(`(INSERT INTO creator_onboarding_sections[^`]*)`\)\.bind\(creatorId,section,status,identity\.email\)/, "section review SQL");
    const reviewProfile = "UPDATE creator_onboarding_profiles SET workflow_state='admin_review',updated_at=CURRENT_TIMESTAMP WHERE creator_id=?";
    for (const key of requiredSections) {
      db.prepare(reviewSection).run("new-creator", key, "complete", "admin@example.test");
      db.prepare(reviewProfile).run("new-creator");
    }
    db.transaction(() => {
      db.prepare(activateProfile).run("new-creator");
      db.prepare(activateAccount).run("new-creator");
      db.prepare(activateCompliance).run("admin@example.test", "new-creator");
    })();
    assert.equal(db.prepare("SELECT workflow_state FROM creator_onboarding_profiles WHERE creator_id='new-creator'").pluck().get(), "active");
    assert.deepEqual(db.prepare("SELECT is_active,publishing_authority FROM operational_accounts WHERE id='new-paid'").get(), { is_active: 1, publishing_authority: "not_configured" });
    assert.deepEqual(db.prepare("SELECT is_active,publishing_authority FROM operational_accounts WHERE id='other-paid'").get(), { is_active: 0, publishing_authority: "not_configured" });
    assert.equal(db.prepare("SELECT activated_by FROM creator_compliance_records WHERE creator_id='new-creator'").pluck().get(), "admin@example.test");

    const changedSection = match(onboardingActions, /DB\.prepare\(`(INSERT INTO creator_onboarding_sections[^`]*)`\)\n    \.bind\(creatorId, section, isCreator \? "draft" : "admin_review", email, isCreator \? 1 : 0\)/, "section change SQL");
    const changedProfile = match(onboardingActions, /DB\.prepare\("(UPDATE creator_onboarding_profiles SET workflow_state=CASE WHEN \? THEN 'draft' ELSE 'admin_review' END[^\"]+)"\)\.bind\(isCreator \? 1 : 0, creatorId\)/, "workflow change SQL");
    db.prepare(changedSection).run("new-creator", "paid_platforms", "draft", identity, 1);
    db.prepare(changedProfile).run(1, "new-creator");
    assert.equal(db.prepare("SELECT status FROM creator_onboarding_sections WHERE creator_id='new-creator' AND section_key='paid_platforms'").pluck().get(), "draft");
    assert.equal(db.prepare("SELECT workflow_state FROM creator_onboarding_profiles WHERE creator_id='new-creator'").pluck().get(), "draft");

    const credentialQuery = match(accessPage, /DB\.prepare\(`(SELECT vc\.id,vc\.credential_group,[\s\S]*?ORDER BY vc\.credential_group,vc\.updated_at DESC)`\)\.bind\(context\.creator\.creator_id\)/, "credential listing SQL");
    const creatorCredentialQuery = credentialQuery.replace('${context.creator.role === "creator" ? "AND vc.shared_with_creator=1" : ""}', "AND vc.shared_with_creator=1");
    const adminCredentialQuery = credentialQuery.replace('${context.creator.role === "creator" ? "AND vc.shared_with_creator=1" : ""}', "");
    db.prepare("INSERT INTO vault_credentials VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("own-shared", "new-creator", "new-paid", "paid", "Shared", "creator", "", 1, "active", "2026-09-02", null, "");
    db.prepare("INSERT INTO vault_credentials VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("own-private", "new-creator", null, "other", "Private", "admin", "", 0, "active", "2026-09-02", null, "private");
    db.prepare("INSERT INTO vault_credentials VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("foreign-shared", "other-creator", "other-paid", "paid", "Foreign", "other", "", 1, "active", "2026-09-02", null, "");
    assert.deepEqual(db.prepare(creatorCredentialQuery).all("new-creator").map(({ id }) => id), ["own-shared"]);
    assert.deepEqual(db.prepare(adminCredentialQuery).all("new-creator").map(({ id }) => id), ["own-private", "own-shared"]);
    assert.equal(Object.hasOwn(db.prepare(creatorCredentialQuery).get("new-creator"), "ciphertext"), false);

    const memberships = [{ creator_id: "new-creator", creator_name: "Synthetic", creator_initials: "SC", role: "creator" }, { creator_id: "new-creator", creator_name: "Synthetic", creator_initials: "SC", role: "viewer" }];
    assert.equal(roleCan("creator", "mutate"), true);
    assert.equal(roleCan("viewer", "mutate"), false);
    assert.equal(authorizeCreatorScope([memberships[0]], "mutate", "other-creator", null).status, 404);
    assert.equal(authorizeCreatorScope([memberships[1]], "mutate", "new-creator", null).status, 404);
  } finally {
    db.close();
  }
});
