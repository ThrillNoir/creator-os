import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { authorizeCreatorScope, roleCan } from "../src/lib/authorization.ts";
import { requireInternalServiceForCreator } from "../../shared/service-auth.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const adelaideAdmin = { creator_id: "adelaide", creator_name: "Adelaide", creator_initials: "A", role: "agency_admin" };
const foreignViewer = { creator_id: "foreign", creator_name: "Foreign", creator_initials: "F", role: "viewer" };

test("cross-creator asset, message, account, analytics, credential and publish access fail closed", async () => {
  for (const permission of ["view", "mutate", "approve", "manage_identity"]) {
    assert.deepEqual(authorizeCreatorScope([adelaideAdmin], permission, "foreign", "foreign"), { ok: false, status: 404 });
  }
  const [actions, attachment, identities, operations, pairing, vault] = await Promise.all([
    source("../src/app/actions.ts"),
    source("../src/app/api/message-attachment/[attachmentId]/route.ts"),
    source("../src/app/identity-actions.ts"),
    source("../src/lib/operations.ts"),
    source("../src/lib/fansly-pairing.ts"),
    source("../../vault-bridge/src/index.ts"),
  ]);
  assert.match(actions, /requireCreatorContext\("mutate"\)[\s\S]*creatorPrepare\(DB, creatorId/);
  assert.match(attachment, /WHERE a\.id=\? AND a\.creator_id=\? AND a\.status='ready'/);
  assert.match(identities, /operational_accounts WHERE id=\? AND creator_id=\?/);
  assert.match(operations, /instagram_analytics_snapshots WHERE creator_id=\?/);
  assert.match(pairing, /requireCreatorContext\("manage_identity"\)/);
  assert.match(vault, /bc\.creator_id,bc\.account_id,bc\.profile_id/);
});

test("URL, cookie, form and payload creator selection never creates a role or capability", async () => {
  assert.deepEqual(authorizeCreatorScope([adelaideAdmin], "view", "foreign", null), { ok: false, status: 404 });
  assert.deepEqual(authorizeCreatorScope([adelaideAdmin], "view", null, "foreign"), { ok: false, status: 404 });
  assert.deepEqual(authorizeCreatorScope([foreignViewer], "mutate", "foreign", null), { ok: false, status: 404 });
  const [actions, identities, humanProbe] = await Promise.all([
    source("../src/app/actions.ts"),
    source("../src/app/identity-actions.ts"),
    source("../src/app/api/staging/qa/human-mutation/route.ts"),
  ]);
  assert.doesNotMatch(actions, /formData\.get\(["']creatorId["']\)/);
  assert.match(identities, /identity\.memberships\.find\(\(item\) => item\.creator_id === creatorId && isAgencyStaffRole\(item\.role\)\)/);
  assert.match(humanProbe, /requireCreatorContext\("mutate", creatorId\)/);
});

test("role escalation is denied, including an unprovisioned super-admin label", async () => {
  assert.equal(roleCan("agency_admin", "manage_identity"), true);
  assert.equal(roleCan("operator", "manage_identity"), false);
  assert.equal(roleCan("creator", "manage_identity"), false);
  assert.equal(roleCan("viewer", "approve"), false);
  assert.equal(roleCan("super_admin", "view"), false);
  assert.deepEqual(authorizeCreatorScope([foreignViewer], "manage_identity", "foreign", null), { ok: false, status: 404 });
  const identities = await source("../src/app/identity-actions.ts");
  assert.match(identities, /requireCreatorContext\("manage_identity", creatorId\)/);
});

test("creator SQL cannot silently omit its tenant predicate", async () => {
  const helper = await source("../src/lib/creator-db.ts");
  assert.match(helper, /if \(!sql\.includes\("@creator"\)\) throw new Error\("Creator-scoped SQL must contain the @creator boundary\."\)/);
  assert.match(helper, /sql\.replace\(\/@creator\|\\\?\/g/);
});

test("invalid or cross-creator internal service identities are rejected before Worker work", async () => {
  const calls = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return { first: async () => values[2] === "adelaide" && values[1] === "thot-os-web-reddit" && values[3] === "reddit.status.read" ? { id: "reddit-credential", principal_id: "reddit-principal", principal_name: "thot-os-web-reddit" } : null };
        },
      };
    },
  };
  const request = new Request("https://reddit-scheduler/status?creator=adelaide", { headers: { authorization: `Bearer ${"x".repeat(48)}`, "x-thot-os-service-capability": "reddit.status.read" } });
  assert.deepEqual(await requireInternalServiceForCreator(request, DB, "adelaide", "thot-os-web-reddit", "reddit.status.read"), {
    principalId: "reddit-principal",
    credentialId: "reddit-credential", serviceName: "thot-os-web-reddit", creatorId: "adelaide", capability: "reddit.status.read",
  });
  await assert.rejects(() => requireInternalServiceForCreator(request, DB, "foreign", "thot-os-web-reddit", "reddit.status.read"), /invalid/);
  await assert.rejects(() => requireInternalServiceForCreator(request, DB, "adelaide", "thot-os-web-reddit", "reddit.publish.execute"), /invalid/);
  await assert.rejects(() => requireInternalServiceForCreator(new Request("https://reddit-scheduler/status"), DB, "adelaide", "thot-os-web-reddit", "reddit.status.read"), /invalid/);
  assert.match(calls[0].sql, /service_principal_creator_grants/);
  assert.match(calls[0].sql, /g\.creator_id=\?/);
  assert.match(calls[0].sql, /g\.capability=\?/);
});

test("receiving Workers use named D1-backed service credentials and device credentials stay bound", async () => {
  const [instagram, reddit, telegram, vault, extension] = await Promise.all([
    source("../../instagram-scheduler/src/index.ts"),
    source("../../reddit-scheduler/src/index.ts"),
    source("../../telegram-bridge/src/index.ts"),
    source("../../vault-bridge/src/index.ts"),
    source("../../../public/local-bridge-extension/background.js"),
  ]);
  const helper = await source("../../shared/service-auth.ts");
  assert.match(helper, /internal_service_request_authorized/);
  assert.match(helper, /x-thot-os-service-capability/);
  assert.match(helper, /service_principal_credentials/);
  for (const [worker, service] of [[instagram, "thot-os-web-instagram"], [reddit, "thot-os-web-reddit"], [telegram, "thot-os-web-telegram"]]) {
    assert.match(worker, /requireInternalServiceForCreator/);
    assert.match(worker, new RegExp(service));
  }
  assert.match(vault, /thot-os-web-vault/);
  assert.doesNotMatch(vault, /CATALOGUE_SYNC_TOKEN/);
  assert.match(vault, /x-thot-os-installation-id/);
  assert.match(vault, /installation_id=\? AND status<>'revoked'/);
  assert.match(extension, /x-thot-os-installation-id/);
});

test("key rotation, pairing CSRF and privileged audit execution fail closed", async () => {
  const [access, pairingRoute, actions] = await Promise.all([
    source("../src/lib/access.ts"),
    source("../src/app/api/fansly/pair/route.ts"),
    source("../src/app/actions.ts"),
  ]);
  assert.match(access, /JWKS_CACHE_TTL_MS/);
  assert.match(access, /accessKeys\(env\.ACCESS_JWKS_URL, true\)/);
  assert.match(pairingRoute, /origin !== requestUrl\.origin/);
  assert.doesNotMatch(actions, /dropbox/i);
  assert.match(actions, /identityAuditStatement/);
});
