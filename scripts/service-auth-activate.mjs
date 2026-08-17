import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertApplyGates, assertRevokeGates, buildActivationPlan, planDigest, redactActivationReceipt, sha256, withActivationStatus } from "./service-auth-activation-lib.mjs";
import { createStructuredD1ReadClient } from "./cloudflare-d1-read.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = { activation: path.join(root, "config/service-auth-activation.staging.json"), contract: path.join(root, "config/service-principals.json"), registry: path.join(root, "config/deployments.json") };
const webWorkerDirectory = path.join(root, "cloudflare/thot-os-next");
const wrangler = path.join(webWorkerDirectory, "node_modules/.bin/wrangler");
const d1ReadKeychain = Object.freeze({ service: "thot-os-release-d1-read", account: "thot-os-release" });
const cloudflareMutationEnvironmentOverride = /^(?:CLOUDFLARE_|CF_|WRANGLER_)/;
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export function parseArgs(argv) {
  const options = { mode: "plan" };
  let explicitMode = false;
  const setMode = (mode) => {
    if (explicitMode) throw new Error("Choose exactly one of --plan, --status, --mutation-preflight, --apply, or --revoke.");
    options.mode = mode;
    explicitMode = true;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--environment") options.environment = argv[++i];
    else if (arg === "--activation") options.activation = path.resolve(argv[++i]);
    else if (arg === "--plan") setMode("plan");
    else if (arg === "--apply") setMode("apply");
    else if (arg === "--status") setMode("status");
    else if (arg === "--mutation-preflight") setMode("mutation-preflight");
    else if (arg === "--revoke") setMode("revoke");
    else if (arg === "--output") options.output = path.resolve(argv[++i]);
    else if (arg === "--approved-plan") options.approvedPlan = path.resolve(argv[++i]);
    else if (arg === "--confirmation") options.confirmation = argv[++i];
    else if (arg === "--backup-receipt") options.backupReceipt = path.resolve(argv[++i]);
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function currentGitIdentity() { return { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]) }; }
export function cleanGitTree() { return git(["status", "--porcelain"]) === ""; }

/**
 * Reads the scoped D1-read credential directly into this process. It is never
 * exported into the environment, written to a file, or passed to Wrangler.
 */
export function readD1ReadTokenFromKeychain({ execFileSyncImpl = execFileSync, keychain = d1ReadKeychain } = {}) {
  try {
    const token = String(execFileSyncImpl("/usr/bin/security", ["find-generic-password", "-s", keychain.service, "-a", keychain.account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })).trim();
    if (!token) throw new Error("empty keychain value");
    return token;
  } catch {
    throw new Error("Scoped D1 read credential is unavailable from the approved Keychain item.");
  }
}

export function createActivationD1ReadClient({ readToken = readD1ReadTokenFromKeychain, ...options } = {}) {
  return createStructuredD1ReadClient({ token: readToken(), ...options });
}

/**
 * Mutation subprocesses must authenticate only through Wrangler OAuth stored
 * in the OS keychain. All inherited Cloudflare/Wrangler overrides are stripped
 * so an API endpoint, auth mode, credential, output path, or read token cannot
 * change that boundary.
 */
export function mutationWranglerEnvironment({ baseEnvironment = process.env, accountId } = {}) {
  if (typeof accountId !== "string" || accountId.trim() === "") throw new Error("Wrangler mutation requires a reviewed Cloudflare account id.");
  const environment = { ...baseEnvironment };
  for (const key of Object.keys(environment)) {
    if (cloudflareMutationEnvironmentOverride.test(key)) delete environment[key];
  }
  environment.CLOUDFLARE_ACCOUNT_ID = accountId;
  environment.CLOUDFLARE_AUTH_USE_KEYRING = "true";
  return environment;
}

/**
 * Runs a mutation-only Wrangler command with credential isolation. Output is
 * deliberately not inherited by the terminal; callers surface only redacted,
 * action-level outcomes.
 */
export function classifyWranglerMutationFailure(error) {
  const diagnostic = [error?.code, error?.signal, error?.stderr].filter((value) => value != null).map(String).join("\n");
  if (/not logged in|oauth|authentication|authorization|permission|\b401\b|\b403\b/i.test(diagnostic)) return "OAUTH_AUTHORIZATION_FAILED";
  if (/timeout|timed out|etimedout|econnreset|enotfound|network/i.test(diagnostic)) return "TRANSPORT_FAILED";
  if (/d1|database|sqlite|sql/i.test(diagnostic)) return "D1_COMMAND_REJECTED";
  return "UNKNOWN_MUTATION_FAILURE";
}

export function runWranglerMutation(args, registry, { input, captureStdout = false, operation = "mutation", execFileSyncImpl = execFileSync } = {}) {
  try {
    const stdout = execFileSyncImpl(wrangler, args, {
      cwd: root,
      encoding: "utf8",
      env: mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId }),
      input,
      stdio: ["pipe", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    return captureStdout ? String(stdout) : "";
  } catch (error) {
    const failure = classifyWranglerMutationFailure(error);
    throw new Error(`Wrangler staging ${operation} failed through the approved OAuth/Keychain path (${failure}).`);
  }
}

/**
 * Captures Wrangler metadata through the same Keychain OAuth boundary without
 * forwarding either stdout or stderr. Parsers below accept only the narrow,
 * expected metadata formats and discard all other output.
 */
export function runWranglerMetadataRead(args, registry, { execFileSyncImpl = execFileSync } = {}) {
  try {
    return String(execFileSyncImpl(wrangler, args, {
      cwd: root,
      encoding: "utf8",
      env: mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId }),
      stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch {
    throw new Error("Wrangler staging metadata read failed through the approved OAuth/Keychain path.");
  }
}

function strictJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Wrangler ${label} metadata was not clean JSON.`);
  }
}

function nonEmptyMetadataString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Wrangler metadata has an invalid ${field}.`);
  return value;
}

export function parseWorkerVersionsJson(stdout) {
  const value = strictJson(stdout, "versions");
  if (!Array.isArray(value) || value.length === 0) throw new Error("Wrangler versions metadata did not contain a version list.");
  const versions = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Wrangler versions metadata contained an invalid version.");
    return { id: nonEmptyMetadataString(entry.id, "version id") };
  });
  const versionIds = versions.map((entry) => entry.id);
  if (new Set(versionIds).size !== versionIds.length) throw new Error("Wrangler versions metadata contained duplicate version ids.");
  // The command currently returns the most recent version first, but staging
  // verification below binds to Wrangler's acknowledged version id rather
  // than relying on that ordering.
  return { latestVersionId: versionIds[0], versionIds };
}

export function parseDeploymentStatusJson(stdout) {
  const value = strictJson(stdout, "deployment");
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.versions) || value.versions.length === 0) {
    throw new Error("Wrangler deployment metadata did not contain a deployment version set.");
  }
  const versions = value.versions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !Number.isFinite(entry.percentage) || entry.percentage < 0 || entry.percentage > 100) {
      throw new Error("Wrangler deployment metadata contained an invalid deployment version.");
    }
    return { versionId: nonEmptyMetadataString(entry.version_id, "deployment version id"), percentage: entry.percentage };
  }).sort((left, right) => left.versionId.localeCompare(right.versionId));
  if (versions.reduce((sum, entry) => sum + entry.percentage, 0) !== 100) throw new Error("Wrangler deployment metadata did not describe a complete traffic allocation.");
  return { versions };
}

export function parseWorkerVersionSecretMetadataJson(stdout, expectedVersionId) {
  const value = strictJson(stdout, "version view");
  if (!value || typeof value !== "object" || Array.isArray(value) || nonEmptyMetadataString(value.id, "version id") !== expectedVersionId) {
    throw new Error("Wrangler version-view metadata did not match the latest Worker version.");
  }
  const bindings = value.resources?.bindings;
  if (!Array.isArray(bindings)) throw new Error("Wrangler version-view metadata did not contain Worker bindings.");
  const secretNames = bindings.filter((binding) => binding && typeof binding === "object" && !Array.isArray(binding) && binding.type === "secret_text").map((binding) => {
    const name = nonEmptyMetadataString(binding.name, "secret name");
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("Wrangler version-view metadata contained an invalid secret name.");
    return name;
  });
  if (new Set(secretNames).size !== secretNames.length) throw new Error("Wrangler latest-version secret metadata contained duplicate names.");
  return { versionId: expectedVersionId, secretNames: secretNames.sort() };
}

/**
 * Reads only Worker version, deployment, and secret-name metadata. No secret
 * value is requested and no output is passed through to the terminal.
 */
function workerMetadataConfig(registry) {
  const config = registry?.environments?.staging?.components?.web?.config;
  if (typeof config !== "string" || config.trim() === "") throw new Error("Staging Worker metadata requires the reviewed Wrangler config.");
  return config;
}

function readWorkerVersionMetadata(registry, config, versionId, runMetadataRead) {
  return parseWorkerVersionSecretMetadataJson(runMetadataRead(["versions", "view", versionId, "--json", "--config", config], registry), versionId);
}

function captureWorkerVersionState(registry, runMetadataRead) {
  const config = workerMetadataConfig(registry);
  const versions = parseWorkerVersionsJson(runMetadataRead(["versions", "list", "--json", "--config", config], registry));
  const deployment = parseDeploymentStatusJson(runMetadataRead(["deployments", "status", "--json", "--config", config], registry));
  return { config, versions, deployment };
}

export function captureWorkerMetadata(registry, runMetadataRead = runWranglerMetadataRead) {
  const { config, versions, deployment } = captureWorkerVersionState(registry, runMetadataRead);
  const versionMetadata = readWorkerVersionMetadata(registry, config, versions.latestVersionId, runMetadataRead);
  const trafficPercentage = deployment.versions.find((entry) => entry.versionId === versions.latestVersionId)?.percentage ?? 0;
  const latestSecretVersion = { ...versionMetadata, trafficPercentage };
  return { latestVersionId: versions.latestVersionId, versionIds: versions.versionIds, deployment, latestSecretVersion };
}

/**
 * Verifies the exact unpublished version acknowledged by `versions secret
 * bulk`. This deliberately does not infer the staged version from list order.
 */
export function captureStagedWorkerMetadata(before, registry, stagedVersionId, runMetadataRead = runWranglerMetadataRead) {
  if (!before || !Array.isArray(before.versionIds)) throw new Error("Worker secret staging requires a complete baseline version inventory.");
  const expectedVersionId = nonEmptyMetadataString(stagedVersionId, "staged version id");
  if (before.versionIds.includes(expectedVersionId)) throw new Error("Wrangler acknowledged a Worker version that already existed before secret staging.");
  const { config, versions, deployment } = captureWorkerVersionState(registry, runMetadataRead);
  if (!versions.versionIds.includes(expectedVersionId)) throw new Error("Wrangler acknowledged Worker secret staging, but its version is absent from the verified version inventory.");
  const versionMetadata = readWorkerVersionMetadata(registry, config, expectedVersionId, runMetadataRead);
  const trafficPercentage = deployment.versions.find((entry) => entry.versionId === expectedVersionId)?.percentage ?? 0;
  return {
    latestVersionId: versions.latestVersionId,
    versionIds: versions.versionIds,
    deployment,
    stagedVersionId: expectedVersionId,
    stagedSecretVersion: { ...versionMetadata, trafficPercentage },
  };
}

function equivalentDeployment(left, right) {
  return JSON.stringify(left.versions) === JSON.stringify(right.versions);
}

/**
 * Enforces the no-routing invariant after secret staging. Metadata can prove
 * names and version/deployment movement, never secret values.
 */
export function compareWorkerMetadata(before, after, expectedSecretNames) {
  if (!before || !after || !Array.isArray(expectedSecretNames) || !expectedSecretNames.every((name) => /^[A-Z][A-Z0-9_]*$/.test(name))) {
    throw new Error("Worker metadata comparison requires reviewed staging metadata and secret destinations.");
  }
  if (!Array.isArray(before.versionIds) || !Array.isArray(after.versionIds) || typeof after.stagedVersionId !== "string" || !after.stagedSecretVersion) {
    throw new Error("Worker metadata comparison requires an exact staged-version inventory.");
  }
  if (before.versionIds.includes(after.stagedVersionId) || !after.versionIds.includes(after.stagedVersionId)) throw new Error("Secret staging did not create a verifiable fresh Worker version.");
  if (!equivalentDeployment(before.deployment, after.deployment)) throw new Error("Secret staging changed the Worker deployment or traffic allocation.");
  if (after.stagedSecretVersion.versionId !== after.stagedVersionId || after.stagedSecretVersion.trafficPercentage !== 0) {
    throw new Error("Secret staging did not remain on an unpublished zero-traffic Worker version.");
  }
  const beforeNames = new Set(before.latestSecretVersion.secretNames);
  const afterNames = new Set(after.stagedSecretVersion.secretNames);
  if (!expectedSecretNames.every((name) => afterNames.has(name))) throw new Error("Staged Worker secret metadata did not contain every approved secret destination.");
  return {
    deploymentUnchanged: true,
    beforeLatestVersionId: before.latestVersionId,
    observedLatestVersionId: after.latestVersionId,
    stagedVersionId: after.stagedVersionId,
    beforeSecretVersionId: before.latestSecretVersion.versionId,
    stagedSecretVersionId: after.stagedSecretVersion.versionId,
    stagedSecretVersionTrafficPercentage: after.stagedSecretVersion.trafficPercentage,
    expectedSecretNames: [...expectedSecretNames].sort(),
    addedSecretNames: expectedSecretNames.filter((name) => !beforeNames.has(name)).sort(),
    existingSecretNames: expectedSecretNames.filter((name) => beforeNames.has(name)).sort(),
    deploymentVersions: after.deployment.versions,
  };
}

export async function d1Migrations(registry, activation, d1Client = createActivationD1ReadClient()) {
  return d1Client.readMigrationHistory(activationD1Target(registry, activation));
}

function activationD1Target(registry, activation) {
  const database = registry?.environments?.staging?.resources?.d1?.[activation?.expected?.databaseName];
  if (!database || database.id !== activation?.expected?.databaseId) throw new Error("Activation D1 identity does not match the deployment registry.");
  return {
    accountId: registry.environments.staging.accountId,
    databaseId: database.id,
    databaseName: activation.expected.databaseName,
  };
}

export function d1Execute(registry, databaseName, statement, runMutation = runWranglerMutation) {
  return runMutation(["--cwd", webWorkerDirectory, "d1", "execute", databaseName, "--remote", "--command", statement, "--json"], registry, { operation: "D1 activation" });
}

const d1MutationPreflightSql = "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1";

/**
 * Validates the isolated Wrangler OAuth path with fixed, read-only SQL before
 * credentials are generated or any Worker/D1 mutation is attempted. Its
 * output is discarded and failures carry only a redacted category.
 */
export function assertD1MutationPreflight(registry, activation, runMutation = runWranglerMutation) {
  const target = activationD1Target(registry, activation);
  runMutation(["--cwd", webWorkerDirectory, "d1", "execute", target.databaseName, "--remote", "--command", d1MutationPreflightSql, "--json"], registry, { operation: "D1 OAuth read preflight" });
  return { result: "WRANGLER_OAUTH_D1_READ_READY", environment: "staging", databaseName: target.databaseName };
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const stableId = (activationId, value) => `sa-${sha256(`${activationId}:${value}`).slice(0, 24)}`;
const principalId = (plan, principal) => stableId(plan.activationId, `principal:${principal.id}`);
const credentialId = (plan, principal) => stableId(plan.activationId, `credential:${principal.id}`);

export function canonicalActivationRecords(plan) {
  return plan.principals.map((principal) => ({
    id: principal.id,
    principalName: principal.principalName,
    principalId: principalId(plan, principal),
    credentialId: credentialId(plan, principal),
  }));
}

function stringField(value, field) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Structured D1 activation status returned an invalid ${field}.`);
  return value;
}

function activationStatusCounts(rows) {
  return {
    activationRuns: rows.runs.length,
    activationSteps: rows.steps.length,
    canonicalPrincipals: rows.principals.length,
    canonicalCredentialCount: rows.credentials.length,
    canonicalGrantCount: rows.grants.length,
    canonicalAuditEventCount: rows.auditEvents.length,
  };
}

function expectedGrantKey(grant) {
  return `${grant.principalName}\u0000${grant.creatorId}\u0000${grant.capability}`;
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((value) => expected.has(value));
}

/**
 * Classifies only the deterministic records for this activation. It never
 * reads credential hashes, secret values, audit detail, or operator identity.
 */
export function classifyActivationStatus({ plan, runs, steps, principals, credentials, grants, auditEvents }) {
  const values = { runs, steps, principals, credentials, grants, auditEvents };
  if (!Object.values(values).every(Array.isArray)) throw new Error("Structured D1 activation status returned malformed row sets.");
  const counts = activationStatusCounts(values);
  const activationRunPresent = runs.length > 0;
  const canonicalRecordsPresent = Object.values(counts).some((count) => count > 0);
  const expectedPrincipals = new Map(canonicalActivationRecords(plan).map((principal) => [principal.id, principal]));
  const expectedPrincipalRows = new Set([...expectedPrincipals.values()].map((entry) => `${entry.principalId}\u0000${entry.principalName}`));
  const expectedCredentialRows = new Set([...expectedPrincipals.values()].map((entry) => `${entry.credentialId}\u0000${entry.principalId}\u0000${entry.principalName}`));
  const expectedGrantRows = new Set(plan.grants.map(expectedGrantKey));
  const expectedCreatedAudit = new Set(plan.principals.map((principal) => `credential_created\u0000${principal.principalName}`));
  const expectedRevokedAudit = new Set(plan.principals.map((principal) => `credential_revoked\u0000${principal.principalName}`));
  const normalised = {
    runs: runs.map((row) => ({ id: stringField(row.id, "activation run id"), environment: stringField(row.environment, "activation run environment"), targetDatabaseId: stringField(row.target_database_id, "activation target database id") })),
    steps: steps.map((row) => ({ step: stringField(row.step, "activation step") })),
    principals: principals.map((row) => ({ id: stringField(row.id, "principal id"), principalName: stringField(row.principal_name, "principal name"), status: stringField(row.status, "principal status") })),
    credentials: credentials.map((row) => ({ id: stringField(row.id, "credential id"), principalId: stringField(row.service_principal_id, "credential principal id"), principalName: stringField(row.principal_name, "credential principal name"), status: stringField(row.status, "credential status") })),
    grants: grants.map((row) => ({ principalName: stringField(row.principal_name, "grant principal name"), creatorId: stringField(row.creator_id, "grant creator id"), capability: stringField(row.capability, "grant capability"), status: stringField(row.status, "grant status") })),
    auditEvents: auditEvents.map((row) => ({ principalName: stringField(row.principal_name, "audit principal name"), eventType: stringField(row.event_type, "audit event type") })),
  };
  const summary = {
    activationRunPresent,
    canonicalRecordsPresent,
    counts,
  };
  if (!canonicalRecordsPresent) return { state: "ABSENT", ...summary };
  const runMatches = normalised.runs.length === 1
    && normalised.runs[0].id === plan.activationId
    && normalised.runs[0].environment === "staging"
    && normalised.runs[0].targetDatabaseId === plan.database.databaseId;
  const principalRowsMatch = normalised.principals.length === expectedPrincipalRows.size && sameSet(new Set(normalised.principals.map((row) => `${row.id}\u0000${row.principalName}`)), expectedPrincipalRows);
  const credentialRowsMatch = normalised.credentials.length === expectedCredentialRows.size && sameSet(new Set(normalised.credentials.map((row) => `${row.id}\u0000${row.principalId}\u0000${row.principalName}`)), expectedCredentialRows);
  const grantRowsMatch = normalised.grants.length === expectedGrantRows.size && sameSet(new Set(normalised.grants.map((row) => expectedGrantKey(row))), expectedGrantRows);
  const stepsPresent = new Set(normalised.steps.map((row) => row.step));
  const createdAudits = normalised.auditEvents.filter((row) => row.eventType === "credential_created").map((row) => `${row.eventType}\u0000${row.principalName}`);
  const revokedAudits = normalised.auditEvents.filter((row) => row.eventType === "credential_revoked").map((row) => `${row.eventType}\u0000${row.principalName}`);
  const createdAuditsMatch = createdAudits.length === expectedCreatedAudit.size && sameSet(new Set(createdAudits), expectedCreatedAudit);
  const revokedAuditsMatch = revokedAudits.length === expectedRevokedAudit.size && sameSet(new Set(revokedAudits), expectedRevokedAudit);
  const allActive = normalised.principals.every((row) => row.status === "active")
    && normalised.credentials.every((row) => row.status === "active")
    && normalised.grants.every((row) => row.status === "active");
  const allRevoked = normalised.principals.every((row) => row.status === "revoked")
    && normalised.credentials.every((row) => row.status === "revoked")
    && normalised.grants.every((row) => row.status === "revoked");
  if (runMatches && principalRowsMatch && credentialRowsMatch && grantRowsMatch && createdAuditsMatch && allActive
    && ["PLANNED", "SECRET_STAGED", "D1_ACTIVE"].every((step) => stepsPresent.has(step)) && !stepsPresent.has("REVOKED") && revokedAudits.length === 0) {
    return { state: "SATISFIED", ...summary };
  }
  if (runMatches && principalRowsMatch && credentialRowsMatch && grantRowsMatch && createdAuditsMatch && revokedAuditsMatch && allRevoked && stepsPresent.has("REVOKED")) {
    return { state: "REVOKED", ...summary };
  }
  return { state: "CONFLICT", ...summary };
}

/**
 * Read the activation ledger and deterministic canonical rows via the scoped
 * D1 read API. The selected columns deliberately exclude hashes and details.
 */
export async function readActivationStatus(registry, activation, plan, d1Client = createActivationD1ReadClient()) {
  const target = activationD1Target(registry, activation);
  const principalIds = plan.principals.map((principal) => principalId(plan, principal));
  const principalNames = plan.principals.map((principal) => principal.principalName);
  const idPlaceholders = principalIds.map(() => "?").join(", ");
  const namePlaceholders = principalNames.map(() => "?").join(", ");
  const scopedPrincipalParameters = [...principalIds, ...principalNames];
  const query = (statement, params) => d1Client.queryReadOnly(target, statement, params).then((result) => result.rows);
  const [runs, steps, principals, credentials, grants, auditEvents] = await Promise.all([
    query("SELECT id, environment, target_database_id FROM service_auth_activation_runs WHERE id = ?", [plan.activationId]),
    query("SELECT step FROM service_auth_activation_steps WHERE activation_id = ? ORDER BY created_at, id", [plan.activationId]),
    query(`SELECT id, principal_name, status FROM service_principals WHERE id IN (${idPlaceholders}) OR principal_name IN (${namePlaceholders}) ORDER BY id`, scopedPrincipalParameters),
    query(`SELECT c.id, c.service_principal_id, p.principal_name, c.status FROM service_principal_credentials c JOIN service_principals p ON p.id = c.service_principal_id WHERE p.id IN (${idPlaceholders}) OR p.principal_name IN (${namePlaceholders}) ORDER BY c.id`, scopedPrincipalParameters),
    query(`SELECT p.principal_name, g.creator_id, g.capability, g.status FROM service_principal_creator_grants g JOIN service_principals p ON p.id = g.service_principal_id WHERE p.id IN (${idPlaceholders}) OR p.principal_name IN (${namePlaceholders}) ORDER BY p.principal_name, g.creator_id, g.capability`, scopedPrincipalParameters),
    query(`SELECT p.principal_name, e.event_type FROM service_principal_audit_events e JOIN service_principals p ON p.id = e.service_principal_id WHERE p.id IN (${idPlaceholders}) OR p.principal_name IN (${namePlaceholders}) ORDER BY p.principal_name, e.created_at, e.id`, scopedPrincipalParameters),
  ]);
  return classifyActivationStatus({ plan, runs, steps, principals, credentials, grants, auditEvents });
}

export function generateActivationCredentials(plan, randomBytes = crypto.randomBytes) {
  return Object.fromEntries(plan.principals.map((principal) => [principal.principalName, randomBytes(48).toString("base64url")]));
}

function secretPayload(plan, credentials) {
  return Object.fromEntries(plan.principals.map((principal) => {
    const credential = credentials?.[principal.principalName];
    if (typeof credential !== "string" || credential.length < 32) throw new Error("Activation credential generation did not produce the required staging secret material.");
    return [principal.secretName, credential];
  }));
}

/**
 * Stage all four secrets in one un-routed Worker version. Wrangler 4 accepts a
 * missing bulk-file positional argument and parses the JSON from stdin, so no
 * secret file or command-line secret value is created.
 */
export function stageWebSecrets(plan, registry, credentials, runMutation = runWranglerMutation) {
  const input = JSON.stringify(secretPayload(plan, credentials));
  const stdout = runMutation(["versions", "secret", "bulk", "--config", registry.environments.staging.components.web.config], registry, { input, captureStdout: true });
  const secretNames = plan.principals.map((principal) => principal.secretName);
  const match = /^✨ Success! Created version ([a-f0-9-]+) with (\d+) secrets\.$/mi.exec(String(stdout));
  if (!match || Number(match[2]) !== secretNames.length) throw new Error("Wrangler secret staging did not return a verifiable version acknowledgement.");
  return { secretNames, stagedVersionId: match[1] };
}

export function activationSql({ plan, activation, credentials, backupReceipt }) {
  const registrySha256 = sha256(readJson(defaults.registry));
  const migrationSha256 = sha256(plan.observedMigrations);
  const statements = ["BEGIN IMMEDIATE;"];
  statements.push(`INSERT INTO service_auth_activation_runs (id,environment,plan_sha256,registry_sha256,backup_receipt_sha256,target_database_id,target_migration_state_sha256,git_sha,git_branch,operator_identity) VALUES (${sql(plan.activationId)},'staging',${sql(plan.planSha256)},${sql(registrySha256)},${sql(backupReceipt.sha256)},${sql(plan.database.databaseId)},${sql(migrationSha256)},${sql(plan.git.sha)},${sql(plan.git.branch)},${sql(activation.operatorIdentity)});`);
  statements.push(`INSERT INTO service_auth_activation_steps (id,activation_id,step,detail) VALUES (${sql(stableId(plan.activationId, "planned"))},${sql(plan.activationId)},'PLANNED','{}');`);
  for (const principal of plan.principals) {
    const currentPrincipalId = principalId(plan, principal);
    const currentCredentialId = credentialId(plan, principal);
    statements.push(`INSERT INTO service_principals (id,principal_name,status) VALUES (${sql(currentPrincipalId)},${sql(principal.principalName)},'active');`);
    statements.push(`INSERT INTO service_principal_credentials (id,service_principal_id,token_hash,status) VALUES (${sql(currentCredentialId)},${sql(currentPrincipalId)},${sql(sha256(credentials[principal.principalName]))},'active');`);
    statements.push(`INSERT INTO service_principal_audit_events (id,service_principal_id,credential_id,event_type,actor_identity,detail) VALUES (${sql(stableId(plan.activationId, `credential-event:${principal.id}`))},${sql(currentPrincipalId)},${sql(currentCredentialId)},'credential_created',${sql(activation.operatorIdentity)},${sql(JSON.stringify({ activationId: plan.activationId, credentialGenerated: true }))});`);
  }
  for (const grant of plan.grants) {
    const principal = plan.principals.find((entry) => entry.principalName === grant.principalName);
    statements.push(`INSERT INTO service_principal_creator_grants (service_principal_id,creator_id,capability,status) VALUES (${sql(principalId(plan, principal))},${sql(grant.creatorId)},${sql(grant.capability)},'active');`);
  }
  statements.push(`INSERT INTO service_auth_activation_steps (id,activation_id,step,detail) VALUES (${sql(stableId(plan.activationId, "secret-staged"))},${sql(plan.activationId)},'SECRET_STAGED',${sql(JSON.stringify({ secretCount: plan.principals.length, secretValuesPersistedLocally: false }))});`);
  statements.push(`INSERT INTO service_auth_activation_steps (id,activation_id,step,detail) VALUES (${sql(stableId(plan.activationId, "d1-active"))},${sql(plan.activationId)},'D1_ACTIVE',${sql(JSON.stringify({ principalCount: plan.principals.length, grantCount: plan.grants.length }))});`);
  statements.push("COMMIT;");
  return statements.join("\n");
}

/**
 * Idempotently neutralises only this activation's deterministic canonical
 * records. It never deletes data and never touches legacy auth tables.
 */
export function revokeActivationSql({ plan, activation }) {
  const statements = ["BEGIN IMMEDIATE;"];
  const principalIds = plan.principals.map((principal) => sql(principalId(plan, principal))).join(",");
  const credentialIds = plan.principals.map((principal) => sql(credentialId(plan, principal))).join(",");
  statements.push(`UPDATE service_principal_creator_grants SET status='revoked', revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE service_principal_id IN (${principalIds});`);
  statements.push(`UPDATE service_principal_credentials SET status='revoked', revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE id IN (${credentialIds});`);
  statements.push(`UPDATE service_principals SET status='revoked', revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE id IN (${principalIds});`);
  for (const principal of plan.principals) {
    const currentPrincipalId = principalId(plan, principal);
    const currentCredentialId = credentialId(plan, principal);
    statements.push(`INSERT OR IGNORE INTO service_principal_audit_events (id,service_principal_id,credential_id,event_type,actor_identity,detail) SELECT ${sql(stableId(plan.activationId, `credential-revoked:${principal.id}`))},${sql(currentPrincipalId)},${sql(currentCredentialId)},'credential_revoked',${sql(activation.operatorIdentity)},${sql(JSON.stringify({ activationId: plan.activationId, reason: "activation_rollback" }))} WHERE EXISTS (SELECT 1 FROM service_principals WHERE id=${sql(currentPrincipalId)});`);
  }
  statements.push(`INSERT OR IGNORE INTO service_auth_activation_steps (id,activation_id,step,detail) SELECT ${sql(stableId(plan.activationId, "revoked"))},${sql(plan.activationId)},'REVOKED',${sql(JSON.stringify({ canonicalCredentialsDisabled: plan.principals.length, legacyAuthenticationRemoved: false }))} WHERE EXISTS (SELECT 1 FROM service_auth_activation_runs WHERE id=${sql(plan.activationId)});`);
  statements.push("COMMIT;");
  return statements.join("\n");
}

export function writeActivationReceipt(output, receipt, writeFileSyncImpl = writeFileSync) {
  writeFileSyncImpl(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}

function clearCredentials(credentials) {
  for (const principalName of Object.keys(credentials)) {
    credentials[principalName] = "";
    delete credentials[principalName];
  }
}

export function createReleaseAttemptId(randomUUID = crypto.randomUUID) {
  const id = randomUUID();
  if (typeof id !== "string" || !/^[a-f0-9-]{20,}$/i.test(id)) throw new Error("Release attempt id generation failed.");
  return `sa-release-${id}`;
}

export function applyActivation({
  plan,
  activation,
  backupReceipt,
  registry,
  output,
  releaseAttemptId = createReleaseAttemptId(),
  generateCredentials = generateActivationCredentials,
  preflightD1Mutation = assertD1MutationPreflight,
  stageSecrets = stageWebSecrets,
  captureMetadata = captureWorkerMetadata,
  captureStagedMetadata,
  compareMetadata = compareWorkerMetadata,
  executeD1 = d1Execute,
  writeReceipt = writeActivationReceipt,
}) {
  let credentials = {};
  let workerSecretMetadata;
  let secretsMayBeStaged = false;
  let d1MayHaveBeenAttempted = false;
  try {
    preflightD1Mutation(registry, activation);
    const workerMetadataBefore = captureMetadata(registry);
    credentials = generateCredentials(plan);
    secretsMayBeStaged = true;
    const stagedSecrets = stageSecrets(plan, registry, credentials);
    const expectedSecretNames = plan.principals.map((entry) => entry.secretName).sort();
    if (!stagedSecrets || !Array.isArray(stagedSecrets.secretNames) || stagedSecrets.secretNames.slice().sort().join("\u0000") !== expectedSecretNames.join("\u0000")) {
      throw new Error("Worker secret staging did not acknowledge every approved secret destination.");
    }
    const workerMetadataAfter = captureStagedMetadata
      ? captureStagedMetadata(workerMetadataBefore, registry, stagedSecrets.stagedVersionId)
      : captureMetadata === captureWorkerMetadata
        ? captureStagedWorkerMetadata(workerMetadataBefore, registry, stagedSecrets.stagedVersionId)
        : captureMetadata(registry);
    workerSecretMetadata = compareMetadata(workerMetadataBefore, workerMetadataAfter, expectedSecretNames);
    d1MayHaveBeenAttempted = true;
    executeD1(registry, activation.expected.databaseName, activationSql({ plan, activation, credentials, backupReceipt }));
    const receipt = redactActivationReceipt({ releaseAttemptId, activationId: plan.activationId, environment: "staging", result: "D1_ACTIVE", principalCount: plan.principals.length, secretNames: plan.principals.map((entry) => entry.secretName), creatorGrantCount: plan.grants.length, d1CredentialHashesInstalled: plan.principals.length, secretValuesPersistedLocally: false, workerSecretMetadata, nextStep: "Deploy compatible receivers, route the staged Web version, then run protected no-op probes." });
    writeReceipt(output, receipt);
    return receipt;
  } catch {
    let receipt;
    if (secretsMayBeStaged && d1MayHaveBeenAttempted) {
      try {
        executeD1(registry, activation.expected.databaseName, revokeActivationSql({ plan, activation }));
        receipt = redactActivationReceipt({ releaseAttemptId, activationId: plan.activationId, environment: "staging", result: "REVOKED", stagedSecretNames: plan.principals.map((entry) => entry.secretName), canonicalCredentialsDisabled: plan.principals.length, legacyAuthenticationRemoved: false, workerSecretMetadata, detail: "Activation did not complete; deterministic canonical credentials and grants were revoked." });
      } catch {
        receipt = redactActivationReceipt({ releaseAttemptId, activationId: plan.activationId, environment: "staging", result: "ROLLBACK_REQUIRED", stagedSecretNames: plan.principals.map((entry) => entry.secretName), legacyAuthenticationRemoved: false, workerSecretMetadata, detail: "Activation outcome is uncertain and automatic canonical-credential revocation did not complete." });
      }
    } else {
      receipt = redactActivationReceipt({ releaseAttemptId, activationId: plan.activationId, environment: "staging", result: "FAILED", stagedSecretNames: secretsMayBeStaged ? plan.principals.map((entry) => entry.secretName) : [], canonicalCredentialsDisabled: 0, legacyAuthenticationRemoved: false, workerSecretMetadata, detail: "D1 canonical credentials were not attempted; staged secrets cannot authenticate without a matching canonical D1 credential hash." });
    }
    try { writeReceipt(output, receipt); } catch { /* The failure path must not emit secret-bearing diagnostics. */ }
    if (receipt.result === "REVOKED") throw new Error("Activation failed; canonical credentials and grants were revoked while legacy authentication remained unchanged.");
    if (receipt.result === "ROLLBACK_REQUIRED") throw new Error("Activation outcome is uncertain and automatic canonical-credential revocation did not complete; stop before any traffic change.");
    throw new Error("Activation failed before canonical D1 credentials were attempted; no traffic change was made.");
  } finally {
    clearCredentials(credentials);
  }
}

/**
 * Explicit recovery path. It invokes only the existing deterministic D1
 * revoke SQL, then proves the resulting state with a separate structured read.
 */
export async function revokeActivation({
  plan,
  activation,
  registry,
  output,
  d1Client,
  releaseAttemptId = createReleaseAttemptId(),
  executeD1 = d1Execute,
  readStatus = readActivationStatus,
  writeReceipt = writeActivationReceipt,
}) {
  let receipt;
  try {
    executeD1(registry, activation.expected.databaseName, revokeActivationSql({ plan, activation }));
    const status = await readStatus(registry, activation, plan, d1Client);
    if (status.state !== "REVOKED") throw new Error("Structured D1 recovery verification did not confirm canonical revocation.");
    receipt = redactActivationReceipt({
      releaseAttemptId,
      activationId: plan.activationId,
      environment: "staging",
      result: "REVOKED",
      canonicalCredentialsDisabled: plan.principals.length,
      legacyAuthenticationRemoved: false,
      activationStatus: status,
      detail: "Explicit recovery revoked only deterministic canonical credentials and grants; no Worker traffic was changed.",
    });
  } catch {
    const failureReceipt = redactActivationReceipt({
      releaseAttemptId,
      activationId: plan.activationId,
      environment: "staging",
      result: "ROLLBACK_REQUIRED",
      legacyAuthenticationRemoved: false,
      detail: "Explicit recovery could not prove deterministic canonical revocation; stop before any traffic change.",
    });
    try { writeReceipt(output, failureReceipt); } catch { /* Never emit child diagnostics or credential material. */ }
    throw new Error("Explicit canonical recovery did not complete or could not be verified; stop before any traffic change.");
  }
  try {
    writeReceipt(output, receipt);
    return receipt;
  } catch {
    throw new Error("Explicit canonical recovery was verified, but its receipt could not be written; do not change traffic and run --status before any further action.");
  }
}

function sameStatusObservation(left, right) {
  return left?.state === right?.state
    && left?.activationRunPresent === right?.activationRunPresent
    && left?.canonicalRecordsPresent === right?.canonicalRecordsPresent
    && JSON.stringify(left?.counts) === JSON.stringify(right?.counts);
}

function assertApprovedPlanIdentity(approvedPlan, activation, registry) {
  if (approvedPlan?.activationId !== activation.activationId || approvedPlan?.environment !== "staging" || approvedPlan?.database?.databaseId !== activation.expected.databaseId || approvedPlan.database.databaseName !== activation.expected.databaseName) {
    throw new Error("Approved plan does not match the reviewed staging activation target.");
  }
  if (registry?.environments?.staging?.resources?.d1?.[activation.expected.databaseName]?.id !== activation.expected.databaseId) throw new Error("Activation D1 identity does not match the deployment registry.");
}

function writeSafeJson(output, value) {
  const safe = redactActivationReceipt(value);
  if (output) writeFileSync(output, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
  return safe;
}

function usage() { return "Usage: npm run services:activate -- --environment staging --activation <approved activation json> [--plan|--status|--mutation-preflight|--apply|--revoke]. Plan, status, and mutation-preflight are read-only."; }

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      if (options.environment !== "staging") throw new Error("An explicit staging environment is required.");
      const activation = readJson(options.activation ?? defaults.activation);
      const contract = readJson(defaults.contract);
      const registry = readJson(defaults.registry);
      const d1Client = createActivationD1ReadClient();
      const observedMigrations = await d1Migrations(registry, activation, d1Client);
      const statusPlan = buildActivationPlan({ activation, contract, registry, observedMigrations, git: currentGitIdentity() });
      const d1ActivationStatus = await readActivationStatus(registry, activation, statusPlan, d1Client);
      const plan = withActivationStatus(statusPlan, d1ActivationStatus);
      if (options.mode === "plan") {
        console.log(JSON.stringify(writeSafeJson(options.output, plan), null, 2));
      } else if (options.mode === "status") {
        const status = writeSafeJson(options.output, {
          schemaVersion: 1,
          mode: "status",
          activationId: activation.activationId,
          environment: "staging",
          d1ActivationStatus,
          workerMetadata: captureWorkerMetadata(registry),
        });
        console.log(JSON.stringify(status, null, 2));
      } else if (options.mode === "mutation-preflight") {
        console.log(JSON.stringify(writeSafeJson(options.output, assertD1MutationPreflight(registry, activation)), null, 2));
      } else {
        if (!options.approvedPlan || !options.output) throw new Error(`${options.mode === "revoke" ? "Revoke" : "Apply"} requires --approved-plan and redacted --output receipt paths.`);
        const approvedPlan = readJson(options.approvedPlan);
        if (planDigest(approvedPlan) !== approvedPlan.planSha256) throw new Error("Approved plan checksum is invalid.");
        assertApprovedPlanIdentity(approvedPlan, activation, registry);
        if (!sameStatusObservation(approvedPlan.activationStatus, d1ActivationStatus)) throw new Error("ACTIVATION_STATE_CONFLICT: current structured D1 activation state differs from the approved plan.");
        if (JSON.stringify(observedMigrations) !== JSON.stringify(approvedPlan.observedMigrations)) throw new Error("Activation requires the exact D1 migration state captured by the approved plan.");
        if (options.mode === "revoke") {
          assertRevokeGates({ plan: approvedPlan, confirmation: options.confirmation, registry });
          const receipt = await revokeActivation({ plan: approvedPlan, activation, registry, d1Client, output: options.output });
          console.log(JSON.stringify(receipt, null, 2));
        } else {
          if (!options.backupReceipt) throw new Error("Apply requires --approved-plan, --backup-receipt, and redacted --output receipt paths.");
          const backupReceipt = readJson(options.backupReceipt);
          assertApplyGates({ plan: approvedPlan, confirmation: options.confirmation, cleanGit: cleanGitTree(), currentGit: currentGitIdentity(), backupReceipt, registry });
          const receipt = applyActivation({ plan: approvedPlan, activation, backupReceipt, registry, output: options.output });
          console.log(JSON.stringify(receipt, null, 2));
        }
      }
    }
  } catch (error) {
    console.error(`Service-auth activation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
