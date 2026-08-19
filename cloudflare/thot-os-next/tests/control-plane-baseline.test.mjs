import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { authorizeCreatorScope, selectableWorkspaceMemberships } from "../src/lib/authorization.ts";
import { integrationState } from "../src/lib/integration-health.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const admin = { creator_id: "adelaide", creator_name: "Adelaide", creator_initials: "A", role: "agency_admin" };
const operator = { creator_id: "thrill-noir", creator_name: "THRILL NOIR", creator_initials: "TN", role: "operator" };
const creator = { creator_id: "creator-only", creator_name: "Creator only", creator_initials: "CO", role: "creator" };

test("staff selection is membership scoped while creator portal identities remain fixed", () => {
  assert.deepEqual(selectableWorkspaceMemberships([admin, operator]).map((item) => item.creator_id), ["adelaide", "thrill-noir"]);
  assert.deepEqual(selectableWorkspaceMemberships([creator]), []);
  assert.equal(authorizeCreatorScope([admin, operator], "view", "thrill-noir", null).ok, true);
  assert.equal(authorizeCreatorScope([admin, operator], "view", "foreign", null).ok, false);
});

test("integration state derives a fail-closed operational summary", () => {
  const baseline = { connection_status: "connected", publishing_authority: "confirmed", warning_level: "none", provider_status: "active", provider_error: null };
  assert.equal(integrationState(baseline), "CONNECTED");
  assert.equal(integrationState({ ...baseline, connection_status: "needs_reconnection" }), "NEEDS_RECONNECT");
  assert.equal(integrationState({ ...baseline, connection_status: "not_connected" }), "NOT_CONNECTED");
  assert.equal(integrationState({ ...baseline, provider_status: "failed", provider_error: "no detail" }), "ERROR");
  assert.equal(integrationState({ ...baseline, connection_status: "needs_check", provider_status: "pending" }), "UNKNOWN");
});

test("canonical onboarding is agency-admin-only, idempotent and metadata-only", async () => {
  const [actions, onboarding, migration, health, overview] = await Promise.all([
    source("../src/app/identity-actions.ts"),
    source("../src/lib/creator-onboarding.ts"),
    source("../../thot-os-app/migrations/0030_canonical_control_plane.sql"),
    source("../src/app/health/route.ts"),
    source("../src/lib/control-plane.ts"),
  ]);
  assert.match(actions, /operatorMembership = identity\.memberships\.find\(\(membership\) => membership\.role === "agency_admin"\)/);
  assert.match(actions, /getOnboardingResult\(DB, request\)/);
  assert.match(actions, /INSERT INTO creators/);
  assert.match(actions, /creator_workspace_onboarded/);
  assert.doesNotMatch(actions, /INSERT INTO operational_accounts[\s\S]{0,500}onboardCreatorWorkspaceAction/);
  assert.match(onboarding, /idempotencyKey: `creator-onboarding:\$\{creatorId\}`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS creator_onboarding_receipts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS creator_exceptions/);
  assert.match(migration, /SOURCE_MISSING_POSSIBLE_DUPLICATE/);
  assert.match(overview, /creator_exceptions WHERE creator_id=\? AND status='open'/);
  assert.match(health, /SELECT name FROM d1_migrations/);
  assert.match(health, /bindings: \{ d1:/);
});

test("the agency overview turns live staging status into read-only navigation", async () => {
  const page = await source("../src/app/page.tsx");
  assert.match(page, /NEXT SAFE STEPS/);
  assert.match(page, /They do not initiate a connection, refresh a provider, publish content or change Dropbox/);
  assert.match(page, /href="\/accounts"/);
  assert.match(page, /href="\/library"/);
  assert.match(page, /href="\/operations"/);
  assert.match(page, /href="\/growth"/);
  assert.match(page, /href="\/creators"/);
  assert.match(page, /failedDeliveries/);
});
