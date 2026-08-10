import assert from "node:assert/strict";
import test from "node:test";
import { authorizeCreatorScope, roleCan, selectCreatorMembership } from "../src/lib/authorization.ts";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const adelaide = { creator_id: "adelaide", creator_name: "Adelaide", creator_initials: "AS", role: "creator" };
const secondCreator = { creator_id: "second", creator_name: "Second Creator", creator_initials: "SC", role: "viewer" };

test("same-creator membership resolves and permits creator work", () => {
  const selected = selectCreatorMembership([adelaide], "adelaide", null);
  assert.equal(selected?.creator_id, "adelaide");
  assert.equal(authorizeCreatorScope([adelaide], "view", "adelaide", null).status, 200);
  assert.equal(roleCan(selected.role, "view"), true);
  assert.equal(roleCan(selected.role, "mutate"), true);
});

test("an unassigned creator scope is concealed", () => {
  assert.equal(selectCreatorMembership([adelaide], "second", null), null);
  assert.deepEqual(authorizeCreatorScope([adelaide], "view", "second", null), { ok: false, status: 404 });
});

test("creator-role identities cannot use a cookie to enter another membership", () => {
  const selected = selectCreatorMembership([adelaide, secondCreator], null, "second");
  assert.equal(selected?.creator_id, "adelaide");
  assert.equal(selectCreatorMembership([adelaide, secondCreator], "second", null), null);
});

test("viewer memberships cannot mutate", () => {
  assert.equal(roleCan("viewer", "view"), true);
  assert.equal(roleCan("viewer", "mutate"), false);
  assert.equal(roleCan("operator", "approve"), true);
  assert.equal(roleCan("agency_admin", "manage_identity"), true);
  assert.deepEqual(authorizeCreatorScope([secondCreator], "mutate", "second", null), { ok: false, status: 404 });
});

test("identity storage enforces creator-owned profiles and exclusive identity classes", async () => {
  const [migration, actions, page] = await Promise.all([
    source("../../thot-os-app/migrations/0018_creator_identity_profiles.sql"),
    source("../src/app/identity-actions.ts"),
    source("../src/app/creators/page.tsx"),
  ]);
  assert.match(migration, /browser_profiles[\s\S]*creator_id TEXT NOT NULL/);
  assert.match(migration, /installation_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /FOREIGN KEY \(profile_id, creator_id\)/);
  assert.match(migration, /creator_memberships_creator_workspace_insert/);
  assert.match(migration, /creator_memberships_staff_class_insert/);
  assert.match(migration, /creator_memberships_creator_workspace_update/);
  assert.match(migration, /creator_memberships_staff_class_update/);
  assert.doesNotMatch(migration, /SELECT CASE/);
  assert.match(actions, /browser_profiles WHERE id=\? AND creator_id=\?/);
  assert.match(page, /browser_profiles WHERE creator_id=\?/);
  assert.doesNotMatch(actions, /ON CONFLICT\(email\) DO UPDATE SET[\s\S]{0,120}status='active'/);
  assert.match(actions, /globally suspended/);
});

test("cloud pairing is pre-bound and never exposes credentials to provider origins", async () => {
  const [bridge, actions, fansly, extension, nativePair] = await Promise.all([
    source("../../vault-bridge/src/index.ts"),
    source("../src/app/actions.ts"),
    source("../src/lib/fansly-pairing.ts"),
    source("../../../public/local-bridge-extension/background.js"),
    source("../../../public/local-bridge-extension/native-pair.js"),
  ]);
  assert.match(bridge, /installation_id=\? AND status<>'revoked'/);
  assert.doesNotMatch(bridge, /installation_id IS NULL/);
  assert.match(bridge, /content-security-policy/);
  assert.match(actions, /VAULT_BRIDGE_BASE_URL[\s\S]*creator_os_bridge_pair/);
  assert.match(fansly, /VAULT_BRIDGE_BASE_URL[\s\S]*creator_os_bridge_pair/);
  assert.doesNotMatch(actions, /reddit\.com\/submit#creator_os/);
  assert.doesNotMatch(fansly, /fansly\.com\/[^{`]*#creator_os/);
  assert.match(extension, /x-thot-os-installation-id/);
  assert.match(extension, /stageVaultFile,args:\[job\.mediaUrl,config\.token,config\.installationId/);
  assert.match(extension, /prepareAndSubmitRedditPost,args:\[job,config\.token,config\.installationId/);
  assert.doesNotMatch(nativePair, /creator_os_cloud_pair/);
});

test("shared provider identifiers and streams are creator safe", async () => {
  const [bridge, telegram, migration] = await Promise.all([
    source("../../vault-bridge/src/index.ts"),
    source("../../telegram-bridge/src/index.ts"),
    source("../../thot-os-app/migrations/0018_creator_identity_profiles.sql"),
  ]);
  assert.match(bridge, /sha256\(`\$\{identity\.creator_id\}:\$\{externalThreadId\}`\)/);
  assert.match(bridge, /SELECT id FROM message_threads WHERE creator_id=\? AND connection_id=\? AND external_thread_id=\?/);
  assert.match(telegram, /pollSharedUpdates/);
  assert.match(telegram, /executeTelegramTool<[^>]+>\(env, "TELEGRAM_GET_UPDATES"/);
  assert.match(telegram, /user_id: env\.COMPOSIO_TELEGRAM_USER_ID/);
  assert.doesNotMatch(telegram, /function serviceUserId/);
  assert.doesNotMatch(telegram, /creator-os:\$\{creatorId\}:service:telegram/);
  assert.doesNotMatch(telegram, /Promise\.allSettled\(connectors\.results\.map/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS telegram_bot_state/);
});
