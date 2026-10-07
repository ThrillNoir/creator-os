import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactActivationReceipt, registryHasProductionOperationalSurface, sha256 } from "./service-auth-activation-lib.mjs";
import { assertD1MutationPreflight, assertD1WriteAuthorizationPreflight, cleanGitTree, createActivationD1ReadClient, currentGitIdentity, d1Execute, redactedMutationFailureCategory } from "./service-auth-activate.mjs";
import { validateContract } from "./service-principal-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  patch: path.join(root, "config/service-auth-capability-patch.staging.json"),
  activation: path.join(root, "config/service-auth-activation.staging.json"),
  contract: path.join(root, "config/service-principals.json"),
  registry: path.join(root, "config/deployments.json"),
};

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const patchIdPattern = /^[a-z0-9][a-z0-9-]{2,100}$/i;
const patchPolicies = {
  "staging-adult-profile-capabilities-v1": {
    principalName: "thot-os-web-public-links",
    creatorId: "adelaide",
    capabilities: ["adult.profile.publish", "adult.profile.withdraw"],
  },
  "staging-synthetic-profile-capabilities-v1": {
    principalName: "thot-os-web-public-links",
    creatorId: "staging-authz-fixture",
    capabilities: ["public.profile.publish", "public.profile.withdraw"],
  },
};
const syntheticPatchId = "staging-synthetic-profile-capabilities-v1";

function stableId(patchId, value) {
  return `sap-${sha256(`${patchId}:${value}`).slice(0, 24)}`;
}

function grantKey(grant) {
  return `${grant.principalName}\u0000${grant.creatorId}\u0000${grant.capability}`;
}

function policyGrantKeys(patchId) {
  const policy = Object.hasOwn(patchPolicies, patchId) ? patchPolicies[patchId] : undefined;
  if (!policy) throw new Error("Capability patch identity is not approved for this tool.");
  return new Set(policy.capabilities.map((capability) => grantKey({ ...policy, capability })));
}

function targetFor(registry, patch) {
  const staging = registry?.environments?.staging;
  const database = staging?.resources?.d1?.[patch?.expected?.databaseName];
  if (!database || database.id !== patch?.expected?.databaseId) throw new Error("Capability patch D1 identity does not match the staging deployment registry.");
  return { accountId: staging.accountId, databaseId: database.id, databaseName: patch.expected.databaseName };
}

function flattenGrants(entries, principals) {
  const grants = [];
  for (const entry of entries ?? []) {
    const principal = principals.get(entry?.principalName);
    if (!principal || typeof entry?.creatorId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(entry.creatorId) || !Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
      throw new Error("Capability patch grants must be explicit, known, and creator-scoped.");
    }
    for (const capability of entry.capabilities) {
      if (typeof capability !== "string" || !principal.capabilities.includes(capability)) throw new Error(`Capability ${String(capability)} is not permitted for ${entry.principalName}.`);
      grants.push({ principalName: entry.principalName, creatorId: entry.creatorId, capability });
    }
  }
  if (!grants.length || new Set(grants.map(grantKey)).size !== grants.length) throw new Error("Capability patch grants must be explicit and unique.");
  return grants;
}

function activationGrantKeys(activation) {
  const keys = new Set();
  for (const entry of activation?.grants ?? []) {
    for (const capability of entry?.capabilities ?? []) keys.add(grantKey({ principalName: entry?.principalName, creatorId: entry?.creatorId, capability }));
  }
  return keys;
}

export function capabilityPatchConfirmation(patchId, planSha256) {
  return `${patchId}:${planSha256.slice(0, 12)}`;
}

export function capabilityPatchDigest(plan) {
  const value = { ...plan };
  delete value.planSha256;
  delete value.confirmation;
  return sha256(value);
}

export function assertApprovedCapabilityPatchPlan(plan, approvedPlan, confirmation) {
  if (capabilityPatchDigest(approvedPlan) !== approvedPlan.planSha256 || approvedPlan.planSha256 !== plan.planSha256 || approvedPlan.patchId !== plan.patchId || approvedPlan.confirmation !== capabilityPatchConfirmation(plan.patchId, approvedPlan.planSha256) || confirmation !== approvedPlan.confirmation) {
    throw new Error("Capability patch approval does not match the reviewed plan.");
  }
  if (JSON.stringify(approvedPlan.git) !== JSON.stringify(plan.git) || JSON.stringify(approvedPlan.grants) !== JSON.stringify(plan.grants) || JSON.stringify(approvedPlan.database) !== JSON.stringify(plan.database)) throw new Error("Capability patch plan no longer matches the reviewed staging configuration.");
}

export function validateCapabilityPatch({ patch, activation, contract, registry }) {
  if (!record(patch) || patch.schemaVersion !== 1 || patch.environment !== "staging" || !patchIdPattern.test(patch.patchId ?? "") || !patchIdPattern.test(patch.sourceActivationId ?? "") || typeof patch.operatorIdentity !== "string" || patch.operatorIdentity.trim() === "") {
    throw new Error("Capability patch is restricted to an explicit staging patch identity and operator.");
  }
  if (!record(activation) || activation.environment !== "staging" || activation.activationId !== patch.sourceActivationId) throw new Error("Capability patch must reference the reviewed canonical staging activation.");
  if (registryHasProductionOperationalSurface(registry)) throw new Error("Capability patch refuses any production operational service-auth surface.");
  const staging = registry?.environments?.staging;
  if (!staging?.provisioned || !staging?.deployable) throw new Error("Capability patch requires the reviewed staging deployment registry.");
  targetFor(registry, patch);
  validateContract(contract);
  const principals = new Map(contract.principals.map((principal) => [principal.principalName, principal]));
  const grants = flattenGrants(patch.grants, principals);
  const allowedGrantKeys = policyGrantKeys(patch.patchId);
  if (grants.length !== allowedGrantKeys.size || !grants.every((grant) => allowedGrantKeys.has(grantKey(grant)))) {
    throw new Error("Capability patch scope does not match its approved exact capability pair.");
  }
  const canonicalKeys = activationGrantKeys(activation);
  if (!grants.every((grant) => canonicalKeys.has(grantKey(grant)))) throw new Error("Capability patch grants must also be present in the canonical staging activation manifest.");
  return { principals, grants };
}

export function buildCapabilityPatchPlan({ patch, activation, contract, registry, git }) {
  const { grants } = validateCapabilityPatch({ patch, activation, contract, registry });
  const plan = {
    schemaVersion: 1,
    mode: "capability-grant-patch",
    patchId: patch.patchId,
    sourceActivationId: patch.sourceActivationId,
    environment: "staging",
    database: targetFor(registry, patch),
    git,
    grants,
    operationsIfApplied: {
      d1CreatorCapabilityGrants: grants.length,
      credentialRotation: false,
      secretWrites: false,
      workerDeployment: false,
      sourceActivationRunMutation: false,
    },
  };
  const planSha256 = capabilityPatchDigest(plan);
  return { ...plan, planSha256, confirmation: capabilityPatchConfirmation(plan.patchId, planSha256) };
}

export function buildCapabilityPatchRevokePlan({ patch, activation, contract, registry, git }) {
  const appliedPlan = buildCapabilityPatchPlan({ patch, activation, contract, registry, git });
  if (appliedPlan.patchId !== syntheticPatchId) throw new Error("Capability patch revocation is supported only for the approved synthetic staging fixture.");
  const plan = {
    ...appliedPlan,
    mode: "capability-grant-patch-revoke",
    requiredAppliedAuditId: capabilityPatchAuditId(appliedPlan),
    operationsIfApplied: {
      d1CreatorCapabilityGrantsRevoked: appliedPlan.grants.length,
      credentialRotation: false,
      secretWrites: false,
      workerDeployment: false,
      sourceActivationRunMutation: false,
    },
  };
  const planSha256 = capabilityPatchDigest(plan);
  return { ...plan, planSha256, confirmation: capabilityPatchConfirmation(plan.patchId, planSha256) };
}

export function capabilityPatchAuditId(plan) {
  return stableId(plan.patchId, "capability-grants-applied");
}

export function capabilityPatchRevokeAuditId(plan) {
  return stableId(plan.patchId, "capability-grants-revoked");
}

function assertSafeStatusRows(rows) {
  if (!record(rows) || !Array.isArray(rows.activationRuns) || !Array.isArray(rows.principals) || !Array.isArray(rows.grants) || !Array.isArray(rows.auditEvents)) {
    throw new Error("Capability patch status returned malformed rows.");
  }
  return rows;
}

export function classifyCapabilityPatchStatus(plan, rows) {
  assertSafeStatusRows(rows);
  const expected = new Set(plan.grants.map(grantKey));
  const baseReady = rows.activationRuns.length === 1
    && rows.activationRuns[0]?.id === plan.sourceActivationId
    && rows.activationRuns[0]?.environment === "staging"
    && rows.activationRuns[0]?.target_database_id === plan.database.databaseId
    && rows.principals.length === 1
    && rows.principals[0]?.principal_name === "thot-os-web-public-links"
    && rows.principals[0]?.principal_status === "active"
    && rows.principals[0]?.credential_status === "active";
  const observedGrants = new Map(rows.grants.map((row) => [grantKey({ principalName: row.principal_name, creatorId: row.creator_id, capability: row.capability }), row.status]));
  const grantStates = [...expected].map((key) => observedGrants.get(key));
  const auditPresent = rows.auditEvents.some((event) => event?.id === capabilityPatchAuditId(plan) && event?.event_type === "creator_capability_grants_added");
  const allMissing = grantStates.every((state) => state === undefined);
  const allActive = grantStates.every((state) => state === "active");
  let state = "CONFLICT";
  if (rows.auditEvents.some((event) => event?.id === capabilityPatchRevokeAuditId(plan))) return { state: "CONFLICT", baseReady, requestedGrantCount: expected.size, activeGrantCount: grantStates.filter((state) => state === "active").length, auditPresent };
  if (baseReady && allMissing && !auditPresent) state = "ABSENT";
  else if (baseReady && allActive && !auditPresent) state = "READY_TO_RECEIPT";
  else if (baseReady && allActive && auditPresent) state = "SATISFIED";
  return {
    state,
    baseReady,
    requestedGrantCount: expected.size,
    activeGrantCount: grantStates.filter((state) => state === "active").length,
    auditPresent,
  };
}

export function classifyCapabilityPatchRevokeStatus(plan, rows) {
  assertSafeStatusRows(rows);
  const expected = new Set(plan.grants.map(grantKey));
  const baseReady = rows.activationRuns.length === 1
    && rows.activationRuns[0]?.id === plan.sourceActivationId
    && rows.activationRuns[0]?.environment === "staging"
    && rows.activationRuns[0]?.target_database_id === plan.database.databaseId
    && rows.principals.length === 1
    && rows.principals[0]?.principal_name === plan.grants[0]?.principalName
    && rows.principals[0]?.principal_status === "active"
    && rows.principals[0]?.credential_status === "active";
  const observedGrants = new Map(rows.grants.map((row) => [grantKey({ principalName: row.principal_name, creatorId: row.creator_id, capability: row.capability }), row.status]));
  const grantStates = [...expected].map((key) => observedGrants.get(key));
  const appliedAuditPresent = rows.auditEvents.some((event) => event?.id === capabilityPatchAuditId(plan) && event?.event_type === "creator_capability_grants_added");
  const revokeAuditPresent = rows.auditEvents.some((event) => event?.id === capabilityPatchRevokeAuditId(plan) && event?.event_type === "creator_capability_grants_revoked");
  const allActive = grantStates.every((state) => state === "active");
  const allRevoked = grantStates.every((state) => state === "revoked");
  let state = "CONFLICT";
  if (baseReady && appliedAuditPresent && allActive && !revokeAuditPresent) state = "READY_TO_REVOKE";
  else if (baseReady && appliedAuditPresent && allRevoked && !revokeAuditPresent) state = "READY_TO_REVOKE_RECEIPT";
  else if (baseReady && appliedAuditPresent && allRevoked && revokeAuditPresent) state = "REVOKED";
  return { state, baseReady, requestedGrantCount: expected.size, activeGrantCount: grantStates.filter((status) => status === "active").length, revokedGrantCount: grantStates.filter((status) => status === "revoked").length, appliedAuditPresent, revokeAuditPresent };
}

export async function readCapabilityPatchStatus(plan, client = createActivationD1ReadClient()) {
  const target = plan.database;
  const principalName = plan.grants[0].principalName;
  const creatorId = plan.grants[0].creatorId;
  const capabilityPlaceholders = plan.grants.map(() => "?").join(", ");
  const capabilities = plan.grants.map((grant) => grant.capability);
  const [activationRuns, principals, grants, auditEvents] = await Promise.all([
    client.queryReadOnly(target, "SELECT id,environment,target_database_id FROM service_auth_activation_runs WHERE id = ?", [plan.sourceActivationId]).then((value) => value.rows),
    client.queryReadOnly(target, "SELECT p.id,p.principal_name,p.status AS principal_status,c.id AS credential_id,c.status AS credential_status FROM service_principals p JOIN service_principal_credentials c ON c.service_principal_id=p.id WHERE p.principal_name=? AND p.status='active' AND c.status='active' ORDER BY c.id", [principalName]).then((value) => value.rows),
    client.queryReadOnly(target, `SELECT p.principal_name,g.creator_id,g.capability,g.status FROM service_principal_creator_grants g JOIN service_principals p ON p.id=g.service_principal_id WHERE p.principal_name=? AND g.creator_id=? AND g.capability IN (${capabilityPlaceholders}) ORDER BY g.capability`, [principalName, creatorId, ...capabilities]).then((value) => value.rows),
    client.queryReadOnly(target, "SELECT id,event_type FROM service_principal_audit_events WHERE id IN (?,?) ORDER BY id", [capabilityPatchAuditId(plan), capabilityPatchRevokeAuditId(plan)]).then((value) => value.rows),
  ]);
  return classifyCapabilityPatchStatus(plan, { activationRuns, principals, grants, auditEvents });
}

export async function readCapabilityPatchRevokeStatus(plan, client = createActivationD1ReadClient()) {
  const target = plan.database;
  const principalName = plan.grants[0].principalName;
  const creatorId = plan.grants[0].creatorId;
  const capabilityPlaceholders = plan.grants.map(() => "?").join(", ");
  const capabilities = plan.grants.map((grant) => grant.capability);
  const [activationRuns, principals, grants, auditEvents] = await Promise.all([
    client.queryReadOnly(target, "SELECT id,environment,target_database_id FROM service_auth_activation_runs WHERE id = ?", [plan.sourceActivationId]).then((value) => value.rows),
    client.queryReadOnly(target, "SELECT p.id,p.principal_name,p.status AS principal_status,c.id AS credential_id,c.status AS credential_status FROM service_principals p JOIN service_principal_credentials c ON c.service_principal_id=p.id WHERE p.principal_name=? AND p.status='active' AND c.status='active' ORDER BY c.id", [principalName]).then((value) => value.rows),
    client.queryReadOnly(target, `SELECT p.principal_name,g.creator_id,g.capability,g.status FROM service_principal_creator_grants g JOIN service_principals p ON p.id=g.service_principal_id WHERE p.principal_name=? AND g.creator_id=? AND g.capability IN (${capabilityPlaceholders}) ORDER BY g.capability`, [principalName, creatorId, ...capabilities]).then((value) => value.rows),
    client.queryReadOnly(target, "SELECT id,event_type FROM service_principal_audit_events WHERE id IN (?,?) ORDER BY id", [capabilityPatchAuditId(plan), capabilityPatchRevokeAuditId(plan)]).then((value) => value.rows),
  ]);
  return classifyCapabilityPatchRevokeStatus(plan, { activationRuns, principals, grants, auditEvents });
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function capabilityPatchSql(plan, patch) {
  const principalName = plan.grants[0].principalName;
  const creatorId = plan.grants[0].creatorId;
  const statements = [];
  for (const grant of plan.grants) {
    statements.push(`INSERT INTO service_principal_creator_grants (service_principal_id,creator_id,capability,status) SELECT p.id,${sql(grant.creatorId)},${sql(grant.capability)},'active' FROM service_principals p WHERE p.principal_name=${sql(grant.principalName)} AND p.status='active' AND EXISTS (SELECT 1 FROM service_principal_credentials c WHERE c.service_principal_id=p.id AND c.status='active') AND NOT EXISTS (SELECT 1 FROM service_principal_creator_grants g WHERE g.service_principal_id=p.id AND g.creator_id=${sql(grant.creatorId)} AND g.capability=${sql(grant.capability)});`);
  }
  const expectedCapabilities = plan.grants.map((grant) => sql(grant.capability)).join(",");
  const detail = JSON.stringify({ patchId: plan.patchId, sourceActivationId: plan.sourceActivationId, creatorId, capabilities: plan.grants.map((grant) => grant.capability) });
  statements.push(`INSERT INTO service_principal_audit_events (id,service_principal_id,credential_id,creator_id,event_type,actor_identity,detail) SELECT ${sql(capabilityPatchAuditId(plan))},p.id,c.id,${sql(creatorId)},'creator_capability_grants_added',${sql(patch.operatorIdentity)},${sql(detail)} FROM service_principals p JOIN service_principal_credentials c ON c.service_principal_id=p.id AND c.status='active' WHERE p.principal_name=${sql(principalName)} AND p.status='active' AND (SELECT COUNT(*) FROM service_principal_creator_grants g WHERE g.service_principal_id=p.id AND g.creator_id=${sql(creatorId)} AND g.status='active' AND g.capability IN (${expectedCapabilities}))=${plan.grants.length} AND NOT EXISTS (SELECT 1 FROM service_principal_audit_events e WHERE e.id=${sql(capabilityPatchAuditId(plan))});`);
  return statements.join("\n");
}

export function capabilityPatchRevokeSql(plan, patch) {
  if (plan.patchId !== syntheticPatchId) throw new Error("Capability patch revocation is supported only for the approved synthetic staging fixture.");
  const principalName = plan.grants[0].principalName;
  const creatorId = plan.grants[0].creatorId;
  const expectedCapabilities = plan.grants.map((grant) => sql(grant.capability)).join(",");
  const detail = JSON.stringify({ patchId: plan.patchId, sourceActivationId: plan.sourceActivationId, creatorId, capabilities: plan.grants.map((grant) => grant.capability), reason: "synthetic_fixture_revoked" });
  return [
    `UPDATE service_principal_creator_grants SET status='revoked', revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE service_principal_id=(SELECT id FROM service_principals WHERE principal_name=${sql(principalName)} AND status='active') AND creator_id=${sql(creatorId)} AND capability IN (${expectedCapabilities}) AND status='active';`,
    `INSERT INTO service_principal_audit_events (id,service_principal_id,credential_id,creator_id,event_type,actor_identity,detail) SELECT ${sql(capabilityPatchRevokeAuditId(plan))},p.id,c.id,${sql(creatorId)},'creator_capability_grants_revoked',${sql(patch.operatorIdentity)},${sql(detail)} FROM service_principals p JOIN service_principal_credentials c ON c.service_principal_id=p.id AND c.status='active' WHERE p.principal_name=${sql(principalName)} AND p.status='active' AND (SELECT COUNT(*) FROM service_principal_creator_grants g WHERE g.service_principal_id=p.id AND g.creator_id=${sql(creatorId)} AND g.status='revoked' AND g.capability IN (${expectedCapabilities}))=${plan.grants.length} AND NOT EXISTS (SELECT 1 FROM service_principal_audit_events e WHERE e.id=${sql(capabilityPatchRevokeAuditId(plan))});`,
  ].join("\n");
}

export async function applyCapabilityPatch({ plan, patch, registry, output, client = createActivationD1ReadClient(), executeD1 = d1Execute, d1MutationPreflight = assertD1MutationPreflight, d1WritePreflight = assertD1WriteAuthorizationPreflight, writeReceipt = writeSafeReceipt }) {
  const before = await readCapabilityPatchStatus(plan, client);
  if (!["ABSENT", "READY_TO_RECEIPT"].includes(before.state)) throw new Error(`Capability patch is blocked by ${before.state}.`);
  if (!cleanGitTree() || JSON.stringify(currentGitIdentity()) !== JSON.stringify(plan.git)) throw new Error("Capability patch requires the exact clean Git identity used for the approved plan.");
  try {
    d1MutationPreflight(registry, patch);
    d1WritePreflight(registry, patch);
    executeD1(registry, plan.database.databaseName, capabilityPatchSql(plan, patch));
    const after = await readCapabilityPatchStatus(plan, client);
    if (after.state !== "SATISFIED") throw new Error(`Capability patch verification failed with ${after.state}.`);
    const receipt = redactActivationReceipt({
      schemaVersion: 1,
      mode: "STAGING_SERVICE_AUTH_CAPABILITY_PATCH",
      patchId: plan.patchId,
      sourceActivationId: plan.sourceActivationId,
      environment: "staging",
      result: "VERIFIED",
      grants: plan.grants,
      credentialRotation: false,
      secretWrites: false,
      workerDeployment: false,
      status: after,
    });
    writeReceipt(output, receipt);
    return receipt;
  } catch (error) {
    const receipt = redactActivationReceipt({
      schemaVersion: 1,
      mode: "STAGING_SERVICE_AUTH_CAPABILITY_PATCH",
      patchId: plan.patchId,
      sourceActivationId: plan.sourceActivationId,
      environment: "staging",
      result: "ROLLBACK_REQUIRED",
      credentialRotation: false,
      secretWrites: false,
      workerDeployment: false,
      failureCategory: redactedMutationFailureCategory(error),
      detail: "Capability patch outcome could not be verified. Stop before publishing or changing traffic.",
    });
    try { writeReceipt(output, receipt); } catch { /* Preserve the fail-closed outcome without exposing child diagnostics. */ }
    throw new Error("Capability patch did not complete with verified staging state; stop before publishing or changing traffic.");
  }
}

export async function revokeCapabilityPatch({ plan, patch, registry, output, client = createActivationD1ReadClient(), executeD1 = d1Execute, d1MutationPreflight = assertD1MutationPreflight, d1WritePreflight = assertD1WriteAuthorizationPreflight, writeReceipt = writeSafeReceipt }) {
  const before = await readCapabilityPatchRevokeStatus(plan, client);
  if (!["READY_TO_REVOKE", "READY_TO_REVOKE_RECEIPT"].includes(before.state)) throw new Error(`Capability patch revocation is blocked by ${before.state}.`);
  if (!cleanGitTree() || JSON.stringify(currentGitIdentity()) !== JSON.stringify(plan.git)) throw new Error("Capability patch revocation requires the exact clean Git identity used for the approved plan.");
  try {
    d1MutationPreflight(registry, patch);
    d1WritePreflight(registry, patch);
    executeD1(registry, plan.database.databaseName, capabilityPatchRevokeSql(plan, patch));
    const after = await readCapabilityPatchRevokeStatus(plan, client);
    if (after.state !== "REVOKED") throw new Error(`Capability patch revocation verification failed with ${after.state}.`);
    const receipt = redactActivationReceipt({ schemaVersion: 1, mode: "STAGING_SERVICE_AUTH_CAPABILITY_PATCH_REVOKE", patchId: plan.patchId, sourceActivationId: plan.sourceActivationId, environment: "staging", result: "VERIFIED", grants: plan.grants, status: after });
    writeReceipt(output, receipt);
    return receipt;
  } catch (error) {
    const receipt = redactActivationReceipt({ schemaVersion: 1, mode: "STAGING_SERVICE_AUTH_CAPABILITY_PATCH_REVOKE", patchId: plan.patchId, sourceActivationId: plan.sourceActivationId, environment: "staging", result: "ROLLBACK_REQUIRED", failureCategory: redactedMutationFailureCategory(error), detail: "Capability patch revocation outcome could not be verified. Stop before publishing or changing traffic." });
    try { writeReceipt(output, receipt); } catch { /* Preserve the fail-closed outcome without exposing child diagnostics. */ }
    throw new Error("Capability patch revocation did not complete with verified staging state; stop before publishing or changing traffic.");
  }
}

function writeSafeReceipt(output, receipt) {
  if (typeof output !== "string" || !path.isAbsolute(output)) throw new Error("Capability patch requires an absolute receipt path.");
  writeFileSync(output, `${JSON.stringify(redactActivationReceipt(receipt), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

export function parseArgs(argv) {
  const options = { mode: "plan" };
  let selectedMode = false;
  const select = (mode) => {
    if (selectedMode) throw new Error("Choose exactly one capability patch mode.");
    selectedMode = true;
    options.mode = mode;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--environment") options.environment = argv[++index];
    else if (argument === "--patch") options.patch = path.resolve(argv[++index]);
    else if (argument === "--approved-plan") options.approvedPlan = path.resolve(argv[++index]);
    else if (argument === "--confirmation") options.confirmation = argv[++index];
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--plan") select("plan");
    else if (argument === "--status") select("status");
    else if (argument === "--apply") select("apply");
    else if (argument === "--revoke-plan") select("revoke-plan");
    else if (argument === "--revoke") select("revoke");
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return "Usage: npm run services:grant-patch -- --environment staging [--patch <path>] [--plan|--status|--revoke-plan|--apply|--revoke --approved-plan <path> --confirmation <value> --output <absolute receipt path>].";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      if (options.environment !== "staging") throw new Error("Capability patch requires the explicit staging environment.");
      const patch = readJson(options.patch ?? defaults.patch);
      const activation = readJson(defaults.activation);
      const contract = readJson(defaults.contract);
      const registry = readJson(defaults.registry);
      const plan = ["revoke", "revoke-plan"].includes(options.mode)
        ? buildCapabilityPatchRevokePlan({ patch, activation, contract, registry, git: currentGitIdentity() })
        : buildCapabilityPatchPlan({ patch, activation, contract, registry, git: currentGitIdentity() });
      const client = createActivationD1ReadClient();
      if (options.mode === "plan") console.log(JSON.stringify({ ...plan, status: await readCapabilityPatchStatus(plan, client) }, null, 2));
      else if (options.mode === "revoke-plan") console.log(JSON.stringify({ ...plan, status: await readCapabilityPatchRevokeStatus(plan, client) }, null, 2));
      else if (options.mode === "status") console.log(JSON.stringify({ schemaVersion: 1, mode: "status", patchId: plan.patchId, environment: "staging", status: await readCapabilityPatchStatus(plan, client) }, null, 2));
      else {
        if (!options.approvedPlan || !options.confirmation || !options.output) throw new Error("Capability patch apply requires an approved plan, confirmation, and receipt path.");
        const approvedPlan = readJson(options.approvedPlan);
        assertApprovedCapabilityPatchPlan(plan, approvedPlan, options.confirmation);
        const receipt = options.mode === "revoke"
          ? await revokeCapabilityPatch({ plan, patch, registry, output: options.output, client })
          : await applyCapabilityPatch({ plan, patch, registry, output: options.output, client });
        console.log(JSON.stringify(receipt, null, 2));
      }
    }
  } catch (error) {
    console.error(`Service-auth capability patch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
