import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { assertApprovedCapabilityPatchPlan, buildCapabilityPatchPlan, buildCapabilityPatchRevokePlan, capabilityPatchAuditId, capabilityPatchConfirmation, capabilityPatchDigest, capabilityPatchRevokeAuditId, capabilityPatchRevokeSql, capabilityPatchSql, classifyCapabilityPatchRevokeStatus, classifyCapabilityPatchStatus, parseArgs, readCapabilityPatchStatus, validateCapabilityPatch } from "../scripts/service-auth-capability-patch.mjs";
import { validateContract } from "../scripts/service-principal-plan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (file) => readFile(path.join(root, file), "utf8").then(JSON.parse);
const git = { sha: "a".repeat(40), branch: "audit/service-auth-capability-patch" };

async function fixture() {
  const [patch, activation, contract, registry] = await Promise.all([
    readJson("config/service-auth-capability-patch.staging.json"),
    readJson("config/service-auth-activation.staging.json"),
    readJson("config/service-principals.json"),
    readJson("config/deployments.json"),
  ]);
  return { patch, activation, contract, registry };
}

async function syntheticFixture() {
  const [patch, activation, contract, registry] = await Promise.all([
    readJson("config/service-auth-capability-patch.synthetic.staging.json"),
    readJson("config/service-auth-activation.staging.json"),
    readJson("config/service-principals.json"),
    readJson("config/deployments.json"),
  ]);
  return { patch, activation, contract, registry };
}

function readyRows(plan, { grants = "missing", audit = false } = {}) {
  const rows = {
    activationRuns: [{ id: plan.sourceActivationId, environment: "staging", target_database_id: plan.database.databaseId }],
    principals: [{ id: "principal-id", principal_name: "thot-os-web-public-links", principal_status: "active", credential_id: "credential-id", credential_status: "active" }],
    grants: [],
    auditEvents: audit ? [{ id: capabilityPatchAuditId(plan), event_type: "creator_capability_grants_added" }] : [],
  };
  if (grants !== "missing") rows.grants = plan.grants.map((grant) => ({ principal_name: grant.principalName, creator_id: grant.creatorId, capability: grant.capability, status: grants }));
  return rows;
}

test("adult profile capabilities are canonical, staging-scoped, and do not alter the production boundary", async () => {
  const { patch, activation, contract, registry } = await fixture();
  const principal = contract.principals.find((entry) => entry.principalName === "thot-os-web-public-links");
  assert.deepEqual(principal.capabilities.slice(-2), ["adult.profile.publish", "adult.profile.withdraw"]);
  const activationGrant = activation.grants.find((entry) => entry.principalName === principal.principalName && entry.creatorId === "adelaide");
  assert.deepEqual(activationGrant.capabilities, ["public.profile.publish", "public.profile.withdraw", "adult.profile.publish", "adult.profile.withdraw"]);
  assert.deepEqual(patch.grants, [{ principalName: principal.principalName, creatorId: "adelaide", capabilities: ["adult.profile.publish", "adult.profile.withdraw"] }]);
  assert.equal(registry.environments.production.components.web, undefined);
  assert.doesNotThrow(() => validateCapabilityPatch({ patch, activation, contract, registry }));
});

test("capability patch rejects duplicate, unknown, and non-canonical grants", async () => {
  const { patch, activation, contract, registry } = await fixture();
  const duplicate = structuredClone(patch);
  duplicate.grants[0].capabilities.push("adult.profile.publish");
  assert.throws(() => validateCapabilityPatch({ patch: duplicate, activation, contract, registry }), /unique/i);
  const unknown = structuredClone(patch);
  unknown.grants[0].capabilities[0] = "adult.profile.unknown";
  assert.throws(() => validateCapabilityPatch({ patch: unknown, activation, contract, registry }), /not permitted/i);
  const broadened = structuredClone(patch);
  broadened.grants[0].capabilities[0] = "public.profile.publish";
  assert.throws(() => validateCapabilityPatch({ patch: broadened, activation, contract, registry }), /scope/i);
  const nonCanonical = structuredClone(activation);
  nonCanonical.grants.at(-1).capabilities = ["public.profile.publish", "public.profile.withdraw"];
  assert.throws(() => validateCapabilityPatch({ patch, activation: nonCanonical, contract, registry }), /canonical/i);
  const duplicateCapabilityContract = structuredClone(contract);
  duplicateCapabilityContract.principals.at(-1).capabilities.push("adult.profile.publish");
  assert.throws(() => validateContract(duplicateCapabilityContract), /unique/i);
});

test("synthetic profile capability patch is limited to its approved fixture identity and public pair", async () => {
  const { patch, activation, contract, registry } = await syntheticFixture();
  assert.deepEqual(activation.grants.at(-1).creatorId, "adelaide");
  assert.deepEqual(patch.grants, [{ principalName: "thot-os-web-public-links", creatorId: "staging-authz-fixture", capabilities: ["public.profile.publish", "public.profile.withdraw"] }]);
  assert.doesNotThrow(() => validateCapabilityPatch({ patch, activation, contract, registry }));
  const wrongCreator = structuredClone(patch);
  wrongCreator.grants[0].creatorId = "adelaide";
  assert.throws(() => validateCapabilityPatch({ patch: wrongCreator, activation, contract, registry }), /scope/i);
  const wrongCapability = structuredClone(patch);
  wrongCapability.grants[0].capabilities[0] = "adult.profile.publish";
  assert.throws(() => validateCapabilityPatch({ patch: wrongCapability, activation, contract, registry }), /scope/i);
  const wrongPatchId = structuredClone(patch);
  wrongPatchId.patchId = "staging-unapproved-capabilities-v1";
  assert.throws(() => validateCapabilityPatch({ patch: wrongPatchId, activation, contract, registry }), /identity/i);
});

test("capability patch plan is deterministic, secret-free, and cannot create credentials or deploy Workers", async () => {
  const { patch, activation, contract, registry } = await fixture();
  const plan = buildCapabilityPatchPlan({ patch, activation, contract, registry, git });
  assert.equal(plan.mode, "capability-grant-patch");
  assert.equal(plan.grants.length, 2);
  assert.equal(plan.operationsIfApplied.credentialRotation, false);
  assert.equal(plan.operationsIfApplied.secretWrites, false);
  assert.equal(plan.operationsIfApplied.workerDeployment, false);
  assert.equal(capabilityPatchDigest(plan), plan.planSha256);
  assert.equal(plan.confirmation, capabilityPatchConfirmation(plan.patchId, plan.planSha256));
  assert.doesNotMatch(JSON.stringify(plan), /Bearer|token_hash|credential value|secret value/i);
});

test("capability patch status accepts only complete active grants plus a matching safe audit receipt", async () => {
  const { patch, activation, contract, registry } = await fixture();
  const plan = buildCapabilityPatchPlan({ patch, activation, contract, registry, git });
  assert.equal(classifyCapabilityPatchStatus(plan, readyRows(plan)).state, "ABSENT");
  assert.equal(classifyCapabilityPatchStatus(plan, readyRows(plan, { grants: "active" })).state, "READY_TO_RECEIPT");
  assert.equal(classifyCapabilityPatchStatus(plan, readyRows(plan, { grants: "active", audit: true })).state, "SATISFIED");
  assert.equal(classifyCapabilityPatchStatus(plan, readyRows(plan, { grants: "revoked" })).state, "CONFLICT");
  const incomplete = readyRows(plan, { grants: "active" });
  incomplete.grants.pop();
  assert.equal(classifyCapabilityPatchStatus(plan, incomplete).state, "CONFLICT");
  const noBase = readyRows(plan);
  noBase.principals[0].credential_status = "revoked";
  assert.equal(classifyCapabilityPatchStatus(plan, noBase).state, "CONFLICT");
});

test("structured capability-patch reads request only safe fields and exact target grants", async () => {
  const { patch, activation, contract, registry } = await fixture();
  const plan = buildCapabilityPatchPlan({ patch, activation, contract, registry, git });
  const calls = [];
  const client = {
    queryReadOnly: async (target, statement, params) => {
      calls.push({ target, statement, params });
      if (statement.includes("service_auth_activation_runs")) return { rows: [{ id: plan.sourceActivationId, environment: "staging", target_database_id: plan.database.databaseId }] };
      if (statement.includes("service_principal_credentials")) return { rows: [{ id: "principal-id", principal_name: "thot-os-web-public-links", principal_status: "active", credential_id: "credential-id", credential_status: "active" }] };
      if (statement.includes("service_principal_creator_grants")) return { rows: [] };
      if (statement.includes("service_principal_audit_events")) return { rows: [] };
      throw new Error("unexpected query");
    },
  };
  const status = await readCapabilityPatchStatus(plan, client);
  assert.equal(status.state, "ABSENT");
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.target.databaseId === plan.database.databaseId));
  assert.ok(calls.every((call) => !/token_hash|\bdetail\b|adult_bio|destination/i.test(call.statement)));
  assert.ok(calls.find((call) => call.statement.includes("service_principal_creator_grants")).params.includes("adult.profile.publish"));
});

test("capability patch SQL is additive, scoped, auditable, and never handles credentials", async () => {
  const { patch, activation, contract, registry } = await fixture();
  const plan = buildCapabilityPatchPlan({ patch, activation, contract, registry, git });
  const statement = capabilityPatchSql(plan, patch);
  assert.match(statement, /INSERT INTO service_principal_creator_grants/g);
  assert.match(statement, /creator_capability_grants_added/);
  assert.match(statement, /adult\.profile\.publish/);
  assert.match(statement, /adult\.profile\.withdraw/);
  assert.doesNotMatch(statement, /token_hash|secret|Bearer|UPDATE|DELETE|CREATE|ALTER|DROP|BEGIN|COMMIT/i);
});

test("synthetic patch revoke accepts only the original verified exact grants and preserves audit history", async () => {
  const { patch, activation, contract, registry } = await syntheticFixture();
  const plan = buildCapabilityPatchRevokePlan({ patch, activation, contract, registry, git });
  const active = readyRows(plan, { grants: "active", audit: true });
  assert.equal(classifyCapabilityPatchRevokeStatus(plan, active).state, "READY_TO_REVOKE");
  assert.equal(classifyCapabilityPatchRevokeStatus(plan, readyRows(plan, { grants: "active" })).state, "CONFLICT");
  const revoked = readyRows(plan, { grants: "revoked", audit: true });
  assert.equal(classifyCapabilityPatchRevokeStatus(plan, revoked).state, "READY_TO_REVOKE_RECEIPT");
  revoked.auditEvents.push({ id: capabilityPatchRevokeAuditId(plan), event_type: "creator_capability_grants_revoked" });
  assert.equal(classifyCapabilityPatchStatus(plan, revoked).state, "CONFLICT");
  assert.equal(classifyCapabilityPatchRevokeStatus(plan, revoked).state, "REVOKED");
  revoked.grants.pop();
  assert.equal(classifyCapabilityPatchRevokeStatus(plan, revoked).state, "CONFLICT");
  const adult = await fixture();
  assert.throws(() => buildCapabilityPatchRevokePlan({ ...adult, git }), /synthetic/i);
});

test("approved patch plans cannot cross-authorize grant and revoke modes", async () => {
  const { patch, activation, contract, registry } = await syntheticFixture();
  const grantPlan = buildCapabilityPatchPlan({ patch, activation, contract, registry, git });
  const revokePlan = buildCapabilityPatchRevokePlan({ patch, activation, contract, registry, git });
  assert.throws(() => assertApprovedCapabilityPatchPlan(revokePlan, grantPlan, grantPlan.confirmation), /approval/i);
});

test("synthetic patch SQL revokes only its exact fixture grants and appends both audits", async () => {
  const { patch, activation, contract, registry } = await syntheticFixture();
  const appliedPlan = buildCapabilityPatchPlan({ patch, activation, contract, registry, git });
  const revokePlan = buildCapabilityPatchRevokePlan({ patch, activation, contract, registry, git });
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE service_principals (id TEXT PRIMARY KEY, principal_name TEXT, status TEXT);
    CREATE TABLE service_principal_credentials (id TEXT PRIMARY KEY, service_principal_id TEXT, status TEXT);
    CREATE TABLE service_principal_creator_grants (service_principal_id TEXT, creator_id TEXT, capability TEXT, status TEXT, revoked_at TEXT, PRIMARY KEY (service_principal_id, creator_id, capability));
    CREATE TABLE service_principal_audit_events (id TEXT PRIMARY KEY, service_principal_id TEXT, credential_id TEXT, creator_id TEXT, event_type TEXT, actor_identity TEXT, detail TEXT);
    INSERT INTO service_principals VALUES ('principal-id','thot-os-web-public-links','active');
    INSERT INTO service_principal_credentials VALUES ('credential-id','principal-id','active');
    INSERT INTO service_principal_creator_grants VALUES ('principal-id','adelaide','public.profile.publish','active',NULL);
  `);
  db.exec(capabilityPatchSql(appliedPlan, patch));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_principal_creator_grants WHERE creator_id='staging-authz-fixture' AND status='active'").get().count, 2);
  assert.equal(db.prepare("SELECT event_type FROM service_principal_audit_events WHERE id=?").get(capabilityPatchAuditId(appliedPlan)).event_type, "creator_capability_grants_added");
  // Simulate a D1 failure after the revoke update but before its audit insert.
  db.exec(capabilityPatchRevokeSql(revokePlan, patch).split(";\n")[0]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_principal_audit_events").get().count, 1);
  db.exec(capabilityPatchRevokeSql(revokePlan, patch));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_principal_creator_grants WHERE creator_id='staging-authz-fixture' AND status='revoked'").get().count, 2);
  assert.equal(db.prepare("SELECT status FROM service_principal_creator_grants WHERE creator_id='adelaide' AND capability='public.profile.publish'").get().status, "active");
  assert.equal(db.prepare("SELECT event_type FROM service_principal_audit_events WHERE id=?").get(capabilityPatchAuditId(appliedPlan)).event_type, "creator_capability_grants_added");
  assert.equal(db.prepare("SELECT event_type FROM service_principal_audit_events WHERE id=?").get(capabilityPatchRevokeAuditId(revokePlan)).event_type, "creator_capability_grants_revoked");
  db.exec(capabilityPatchSql(appliedPlan, patch));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_principal_creator_grants WHERE creator_id='staging-authz-fixture' AND status='revoked'").get().count, 2);
  db.close();
});

test("capability patch CLI requires explicit staging, single mode, and approved apply inputs", () => {
  assert.equal(parseArgs(["--environment", "staging"]).mode, "plan");
  assert.equal(parseArgs(["--environment", "staging", "--status"]).mode, "status");
  assert.equal(parseArgs(["--environment", "staging", "--apply"]).mode, "apply");
  assert.equal(parseArgs(["--environment", "staging", "--revoke-plan"]).mode, "revoke-plan");
  assert.equal(parseArgs(["--environment", "staging", "--revoke"]).mode, "revoke");
  assert.throws(() => parseArgs(["--environment", "staging", "--apply", "--status"]), /exactly one/i);
});
