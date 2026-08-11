import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { authorizeCreatorScope, creatorRoleLabel, selectCreatorMembership } from "../src/lib/authorization.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const adelaideAdmin = { creator_id: "adelaide", creator_name: "Adelaide", creator_initials: "A", role: "agency_admin" };
const fixtureAdmin = { creator_id: "staging-authz-fixture", creator_name: "Staging Authorization Fixture", creator_initials: "S", role: "agency_admin" };

test("agency administrator labels and creator selection remain membership-derived", () => {
  assert.equal(creatorRoleLabel("agency_admin"), "Agency administrator");
  assert.equal(selectCreatorMembership([adelaideAdmin, fixtureAdmin], null, "staging-authz-fixture")?.creator_id, "staging-authz-fixture");
  assert.equal(selectCreatorMembership([adelaideAdmin, fixtureAdmin], "unauthorized", null), null);
  assert.deepEqual(authorizeCreatorScope([adelaideAdmin, fixtureAdmin], "manage_identity", "unauthorized", null), { ok: false, status: 404 });
  assert.equal(authorizeCreatorScope([adelaideAdmin, fixtureAdmin], "manage_identity", "adelaide", "unauthorized").status, 200);
});

test("the administrator page is scoped, explicit and credential-redacted", async () => {
  const page = await source("../src/app/creators/page.tsx");
  assert.match(page, /requireCreatorContext\("manage_identity", requestedCreatorId\)/);
  assert.match(page, /scope\.role='agency_admin'/);
  assert.match(page, /scope\.status='active'/);
  assert.match(page, /Agency administrator/);
  assert.match(page, /SELECTED CREATOR WORKSPACE/);
  assert.match(page, /Administrative view only/);
  assert.match(page, /switching never impersonates the creator|administrative actions remain attributed to you/i);
  assert.match(page, /Pause all AI messaging/);
  assert.match(page, /disabled>Not enabled/);
  assert.match(page, /unixepoch\(bc\.expires_at\)>unixepoch\(CURRENT_TIMESTAMP\)/);
  assert.doesNotMatch(page, /token_hash/);
  assert.doesNotMatch(page, /SELECT[^\n]+installation_id/i);
  assert.match(page, /identity_audit_events WHERE creator_id=\?/);
  for (const table of ["asset_classification_events", "social_post_events", "reddit_community_events", "vault_upload_events", "messaging_audit_events"]) {
    assert.match(page, new RegExp(`${table} WHERE creator_id=\\?`));
  }
});

test("administrative mutations derive actor role and require destructive confirmation", async () => {
  const actions = await source("../src/app/identity-actions.ts");
  assert.doesNotMatch(actions, /formData\.get\(["']actor_?role["']\)/);
  assert.match(actions, /humanAuditActor\(\{ email: identity\.email, creator: membership \}\)/);
  assert.match(actions, /creator_workspace_selected/);
  assert.match(actions, /requireCreatorContext\("manage_identity", creatorId\)/);
  assert.match(actions, /requireConfirmation\(formData, "revoke-bridge"\)/);
  assert.match(actions, /requireConfirmation\(formData, "suspend-membership"\)/);
  assert.match(actions, /bridge_credentials_revoked[\s\S]*confirmed: true/);
  assert.match(actions, /creator_membership_suspended[\s\S]*confirmed: true/);
  assert.match(actions, /identityAuditStatement/);
  assert.doesNotMatch(actions, /actor_role\s*=|actorRole\s*=/);
});

test("forged headers, cookies and roles do not become administrator authorization", async () => {
  const [access, authorization, actions] = await Promise.all([
    source("../src/lib/access.ts"),
    source("../src/lib/authorization.ts"),
    source("../src/app/identity-actions.ts"),
  ]);
  assert.match(access, /cf-access-jwt-assertion/);
  assert.doesNotMatch(access, /cf-access-authenticated-user-email/);
  assert.match(access, /crypto\.subtle\.verify/);
  assert.doesNotMatch(authorization, /headers\(|cookies\(|formData/);
  assert.doesNotMatch(actions, /membershipRoles\.has\([^)]*actor/i);
  assert.deepEqual(authorizeCreatorScope([{ ...adelaideAdmin, role: "viewer" }], "manage_identity", "adelaide", null), { ok: false, status: 404 });
});
