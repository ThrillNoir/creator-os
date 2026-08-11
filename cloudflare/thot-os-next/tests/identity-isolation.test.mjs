import assert from "node:assert/strict";
import test from "node:test";
import { humanAuditActor, isSameOriginRequest, rejectClientActorRole, requireServiceAuditActor } from "../src/lib/audit-identity.ts";
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

test("an agency administrator cannot forge an unauthorized creator cookie or request", () => {
  const admin = { ...adelaide, role: "agency_admin" };
  assert.equal(selectCreatorMembership([admin], null, "second"), null);
  assert.equal(selectCreatorMembership([admin], "second", null), null);
  assert.deepEqual(authorizeCreatorScope([admin], "manage_identity", "second", null), { ok: false, status: 404 });
});

test("creator-role identities cannot use a cookie to enter another membership", () => {
  const selected = selectCreatorMembership([adelaide, secondCreator], null, "second");
  assert.equal(selected?.creator_id, "adelaide");
  assert.equal(selectCreatorMembership([adelaide, secondCreator], "second", null), null);
});

test("viewer memberships cannot mutate", () => {
  assert.equal(roleCan("viewer", "view"), true);
  assert.equal(roleCan("viewer", "mutate"), false);
  assert.equal(roleCan("legacy", "view"), false);
  assert.equal(roleCan("legacy", "mutate"), false);
  assert.equal(roleCan("operator", "approve"), true);
  assert.equal(roleCan("agency_admin", "manage_identity"), true);
  assert.deepEqual(authorizeCreatorScope([secondCreator], "mutate", "second", null), { ok: false, status: 404 });
});

test("human audit roles are derived and browser role spoofing is rejected", () => {
  const context = { email: "creator@example.test", creator: adelaide };
  assert.deepEqual(humanAuditActor(context), { identity: "creator@example.test", role: "creator", creatorId: "adelaide" });
  assert.deepEqual(humanAuditActor({ email: "viewer@example.test", creator: secondCreator }), { identity: "viewer@example.test", role: "viewer", creatorId: "second" });
  assert.throws(() => rejectClientActorRole({ creatorId: "adelaide", actorRole: "agency_admin" }), /derived from the authenticated identity/);
  assert.throws(() => rejectClientActorRole({ creatorId: "adelaide", actor_role: "service" }), /derived from the authenticated identity/);
  assert.throws(() => rejectClientActorRole({ creatorId: "adelaide", actor_role: "legacy" }), /derived from the authenticated identity/);
  assert.doesNotThrow(() => rejectClientActorRole({ creatorId: "adelaide" }));
});

test("the browser QA mutation requires an exact same-origin request", () => {
  const url = "https://thot-os-staging.thot-os.workers.dev/api/staging/qa/human-mutation";
  assert.equal(isSameOriginRequest(new Request(url, { headers: { origin: "https://thot-os-staging.thot-os.workers.dev" } })), true);
  assert.equal(isSameOriginRequest(new Request(url, { headers: { origin: "https://attacker.example" } })), false);
  assert.equal(isSameOriginRequest(new Request(url)), false);
});

test("service role is returned only after credential and creator-grant validation", async () => {
  let boundCreator = "";
  const DB = {
    prepare() {
      return {
        bind(_hash, creatorId) {
          boundCreator = creatorId;
          return { first: async () => creatorId === "adelaide" ? { id: "service-id", service_name: "qa-runner" } : null };
        },
      };
    },
  };
  const request = new Request("https://thot-os.test/api/staging/qa/service-mutation", { headers: { authorization: "Bearer local-test-token" } });
  assert.deepEqual(await requireServiceAuditActor(request, DB, "adelaide"), {
    actor: { identity: "service:qa-runner", role: "service", creatorId: "adelaide" },
    credentialId: "service-id",
  });
  assert.equal(boundCreator, "adelaide");
  await assert.rejects(() => requireServiceAuditActor(request, DB, "second"), /Service credential is invalid/);
});

test("new audit writers supply derived human roles or service and never legacy", async () => {
  const writers = await Promise.all([
    source("../src/app/actions.ts"),
    source("../src/lib/fansly-pairing.ts"),
    source("../../instagram-scheduler/src/index.ts"),
    source("../../reddit-scheduler/src/index.ts"),
    source("../../telegram-bridge/src/index.ts"),
    source("../../vault-bridge/src/index.ts"),
    source("../src/app/identity-actions.ts"),
    source("../src/lib/audit-identity.ts"),
  ]);
  const rolelessActorColumn = /INSERT(?: OR IGNORE)? INTO (?:asset_classification_events|social_post_events|reddit_community_events|vault_upload_events|messaging_audit_events)\s*\([^)]*\bactor\s*,\s*(?:event_type|detail|snapshot)\b/g;
  for (const writer of writers) {
    assert.doesNotMatch(writer, rolelessActorColumn);
    assert.doesNotMatch(writer, /["']legacy["']/);
  }
  assert.match(writers[0], /identity\.creator\.role/);
  assert.match(writers[1], /humanAuditActor\(identity\)/);
  for (const worker of writers.slice(2, 6)) assert.match(worker, /['"]service['"]/);
  assert.match(writers[6], /humanAuditActor\(context\)/);
  assert.match(writers[7], /actor\.role/);
});

test("audit provenance is never an authorization input", async () => {
  const authorization = await source("../src/lib/authorization.ts");
  assert.doesNotMatch(authorization, /identity_audit|actor_role|AuditActorRole/);
  assert.match(authorization, /agency_admin[\s\S]*operator[\s\S]*creator[\s\S]*viewer/);
  assert.equal(authorizeCreatorScope([{ ...adelaide, role: "legacy" }], "view", "adelaide", null).status, 404);
});

test("identity storage enforces creator-owned profiles and exclusive identity classes", async () => {
  const [migration, auditMigration, contractMigration, actions, page, humanProbe, serviceProbe, qaPage] = await Promise.all([
    source("../../thot-os-app/migrations/0018_creator_identity_profiles.sql"),
    source("../../thot-os-app/migrations/0019_actor_role_audit.sql"),
    source("../../thot-os-app/migrations/0020_actor_role_contract.sql"),
    source("../src/app/identity-actions.ts"),
    source("../src/app/creators/page.tsx"),
    source("../src/app/api/staging/qa/human-mutation/route.ts"),
    source("../src/app/api/staging/qa/service-mutation/route.ts"),
    source("../src/app/staging-qa/page.tsx"),
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
  assert.match(page, /FROM browser_profiles bp[\s\S]*WHERE bp\.creator_id=\?/);
  assert.doesNotMatch(actions, /ON CONFLICT\(email\) DO UPDATE SET[\s\S]{0,120}status='active'/);
  assert.match(actions, /globally suspended/);
  assert.match(auditMigration, /actor_role TEXT NOT NULL/);
  assert.match(auditMigration, /DEFAULT 'legacy'/);
  assert.doesNotMatch(migration, /'legacy'/);
  assert.match(auditMigration, /audit_human_actor_scope_invalid/);
  assert.match(auditMigration, /audit_service_actor_scope_invalid/);
  assert.match(auditMigration, /unixepoch\(s\.expires_at\)>unixepoch\(CURRENT_TIMESTAMP\)/);
  assert.equal((contractMigration.match(/CREATE TRIGGER/g) ?? []).length, 12);
  assert.match(contractMigration, /NEW\.actor_role NOT IN \('agency_admin','operator','creator','viewer','service'\)/);
  assert.match(contractMigration, /OLD\.actor_role='legacy'/);
  assert.match(humanProbe, /requireCreatorContext\("mutate", creatorId\)/);
  assert.match(humanProbe, /rejectClientActorRole/);
  assert.match(humanProbe, /isSameOriginRequest\(request\)/);
  assert.match(humanProbe, /request\.formData\(\)/);
  assert.match(qaPage, /requireCreatorContext\("view", creatorId\)/);
  assert.match(qaPage, /Write own-creator audit probe/);
  assert.match(qaPage, /name="actor_role" value="agency_admin"/);
  assert.match(qaPage, /name="creatorId" required pattern=/);
  assert.match(qaPage, /Attempt scoped mutation/);
  assert.doesNotMatch(qaPage, /value="adelaide"/);
  assert.match(qaPage, /never publish, message, upload or retrieve media/i);
  assert.match(serviceProbe, /requireServiceAuditActor/);
  assert.match(serviceProbe, /actorRole: service\.actor\.role/);
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
