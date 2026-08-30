import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activationBackupReceiptDigest, activationConfirmation, assertApplyGates, assertRevokeGates, buildActivationPlan, planDigest, redactActivationReceipt, revokeConfirmation, sha256, sha256Bytes, withActivationStatus } from "../scripts/service-auth-activation-lib.mjs";
import { activationSql, applyActivation, assertD1MutationPreflight, assertD1WriteAuthorizationPreflight, canonicalActivationRecords, captureStagedWorkerMetadata, captureWorkerMetadata, classifyActivationStatus, classifyWranglerMutationFailure, compareWorkerMetadata, d1Execute, d1Migrations, mutationWranglerEnvironment, parseArgs, parseD1WriteAuthorizationPreflightJson, parseWorkerVersionSecretMetadataJson, parseWorkerVersionsJson, readActivationStatus, redactedMutationFailureCategory, revokeActivation, revokeActivationSql, runWranglerMutation, stageWebSecrets } from "../scripts/service-auth-activate.mjs";

const root = path.resolve(import.meta.dirname, "..");
const json = (file) => readFile(path.join(root, file), "utf8").then(JSON.parse);
const baseline = Array.from({ length: 27 }, (_, index) => `${String(index + 1).padStart(4, "0")}_placeholder.sql`).slice(0, -1).concat("0027_reddit_post_flairs.sql");

function workerMetadataFor(plan, { staged = false } = {}) {
  const deployment = { versions: [{ versionId: "published-version", percentage: 100 }] };
  const versionId = staged ? "unpublished-secret-version" : "previous-unpublished-version";
  const versionMetadata = {
    versionId,
    trafficPercentage: 0,
    secretNames: staged ? plan.principals.map((principal) => principal.secretName).sort() : [],
  };
  return {
    latestVersionId: versionId,
    versionIds: staged ? [versionId, "previous-unpublished-version"] : [versionId],
    deployment,
    latestSecretVersion: versionMetadata,
    ...(staged ? { stagedVersionId: versionId, stagedSecretVersion: versionMetadata } : {}),
  };
}

function metadataSequence(plan) {
  const snapshots = [workerMetadataFor(plan), workerMetadataFor(plan, { staged: true })];
  return () => snapshots.shift() ?? snapshots.at(-1);
}

function stagedSecretResult(plan) {
  return {
    secretNames: plan.principals.map((principal) => principal.secretName),
    stagedVersionId: "unpublished-secret-version",
  };
}

function mutationFailure(category, message = "untrusted sensitive child diagnostic") {
  const error = new Error(message);
  Object.defineProperty(error, "failureCategory", { value: category });
  return error;
}

function validBackupReceipt(plan, registry) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "thot-os-service-auth-test-backup-"));
  chmodSync(directory, 0o700);
  const exportPath = path.join(directory, "staging-d1.sql");
  const bytes = Buffer.from("test export\n");
  writeFileSync(exportPath, bytes, { mode: 0o600 });
  const receipt = {
    schemaVersion: 1,
    mode: "READ_ONLY_ACTIVATION_BACKUP",
    activationId: plan.activationId,
    environment: "staging",
    accountId: registry.environments.staging.accountId,
    databaseName: plan.database.databaseName,
    databaseId: plan.database.databaseId,
    planSha256: plan.planSha256,
    planGit: plan.git,
    migrationHistory: plan.observedMigrations,
    migrationStateSha256: sha256(plan.observedMigrations),
    exportedAt: new Date().toISOString(),
    exportPath,
    export: { fileName: "staging-d1.sql", bytes: bytes.length, sha256: sha256Bytes(bytes) },
    integrity: { quickCheck: "ok", foreignKeyViolations: 0 },
  };
  receipt.sha256 = activationBackupReceiptDigest(receipt);
  return { receipt, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function satisfiedActivationRows(plan) {
  const records = canonicalActivationRecords(plan);
  return {
    runs: [{ id: plan.activationId, environment: "staging", target_database_id: plan.database.databaseId }],
    steps: ["PLANNED", "SECRET_STAGED", "D1_ACTIVE"].map((step) => ({ step })),
    principals: records.map((record) => ({ id: record.principalId, principal_name: record.principalName, status: "active" })),
    credentials: records.map((record) => ({ id: record.credentialId, service_principal_id: record.principalId, principal_name: record.principalName, status: "active" })),
    grants: plan.grants.map((grant) => ({ principal_name: grant.principalName, creator_id: grant.creatorId, capability: grant.capability, status: "active" })),
    auditEvents: records.map((record) => ({ principal_name: record.principalName, event_type: "credential_created" })),
  };
}

test("service-auth activation plan is redacted, deterministic, staging-only, and blocked before expansion", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: baseline, git: { sha: "a".repeat(40), branch: "audit/test" } });
  assert.equal(plan.expandReady, false);
  assert.equal(plan.compatibilityReady, false);
  assert.equal(plan.activationReady, false);
  assert.equal(plan.principals.length, 5);
  assert.equal(plan.grants.length, 20);
  assert.equal(plan.operationsIfApplied.d1CredentialHashes, 5);
  assert.equal(plan.operationsIfApplied.legacyAuthenticationRemoved, false);
  assert.equal(plan.confirmation, activationConfirmation(plan.activationId, plan.planSha256));
  assert.equal(planDigest(plan), plan.planSha256);
  assert.doesNotThrow(() => redactActivationReceipt(plan));
  assert.doesNotMatch(JSON.stringify(plan), /Bearer|token_hash|credential value/i);
  assert.throws(() => buildActivationPlan({ activation: { ...activation, environment: "production" }, contract, registry, observedMigrations: baseline, git: {} }), /staging/i);
  const registryWithProductionWeb = structuredClone(registry);
  registryWithProductionWeb.environments.production.components.web = structuredClone(registry.environments.staging.components.web);
  assert.throws(() => buildActivationPlan({ activation, contract, registry: registryWithProductionWeb, observedMigrations: baseline, git: {} }), /operational service-auth surface/i);
});

test("activation requires COMPATIBILITY after EXPAND and then fail-closes on other gates", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const expanded = buildActivationPlan({ activation, contract, registry, observedMigrations: activation.expected.expandMigrations, git: { sha: "a".repeat(40), branch: "audit/test" } });
  assert.equal(expanded.expandReady, true);
  assert.equal(expanded.compatibilityReady, false);
  assert.equal(expanded.activationReady, false);
  assert.throws(() => assertApplyGates({ plan: expanded, confirmation: expanded.confirmation, cleanGit: true, currentGit: expanded.git, backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId }, registry }), /compatibility-ready/i);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  assert.equal(plan.expandReady, true);
  assert.equal(plan.compatibilityReady, true);
  assert.equal(plan.activationReady, true);
  const backup = validBackupReceipt(plan, registry);
  try {
    const base = { plan, cleanGit: true, currentGit: plan.git, backupReceipt: backup.receipt, registry };
    assert.equal(assertApplyGates({ ...base, confirmation: plan.confirmation }), true);
    assert.throws(() => assertApplyGates({ ...base, confirmation: "wrong" }), /confirmation/i);
    assert.throws(() => assertApplyGates({ ...base, cleanGit: false, confirmation: plan.confirmation }), /clean Git/i);
    assert.throws(() => assertApplyGates({ ...base, backupReceipt: { ...base.backupReceipt, databaseId: "wrong" }, confirmation: plan.confirmation }), /backup/i);
  } finally {
    backup.cleanup();
  }
});

test("activation accepts only the explicitly reviewed complete post-COMPATIBILITY sequence", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const observed = [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations, ...activation.expected.postCompatibilityMigrations];
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: observed, git: { sha: "a".repeat(40), branch: "audit/test" } });
  assert.equal(plan.expandReady, true);
  assert.equal(plan.postCompatibilityReady, true);
  assert.equal(plan.compatibilityReady, true);
  assert.equal(plan.activationReady, true);
  assert.throws(() => buildActivationPlan({ activation, contract, registry, observedMigrations: observed.slice(0, -1), git: { sha: "a".repeat(40), branch: "audit/test" } }), /outside the approved/i);
});

test("canonical partial EXPAND baseline at 0028 is accepted but remains activation-blocked", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const observed = [...baseline, activation.expected.expandMigrations[0]];
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: observed, git: { sha: "a".repeat(40), branch: "audit/test" } });
  assert.equal(plan.partialExpandReady, true);
  assert.equal(plan.partialExpandThrough, "0028_migration_ledger.sql");
  assert.equal(plan.expandReady, false);
  assert.equal(plan.compatibilityReady, false);
  assert.equal(plan.blockingPrecondition, "EXPAND_MIGRATIONS_0028_THROUGH_0031_REQUIRED");
});

test("service-auth D1 migration reader uses the injected structured client and validates registry identity", async () => {
  const [activation, , registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const calls = [];
  const result = await d1Migrations(registry, activation, { readMigrationHistory: async (target) => { calls.push(target); return ["0028_migration_ledger.sql"]; } });
  assert.deepEqual(result, ["0028_migration_ledger.sql"]);
  assert.deepEqual(calls, [{ accountId: registry.environments.staging.accountId, databaseId: activation.expected.databaseId, databaseName: activation.expected.databaseName }]);
  await assert.rejects(() => d1Migrations({ ...registry, environments: { ...registry.environments, staging: { ...registry.environments.staging, resources: { d1: {} } } } }, activation, { readMigrationHistory: async () => [] }), /identity/);
});

test("structured D1 activation status reads only safe state and makes a satisfied plan fail closed", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const rows = satisfiedActivationRows(plan);
  const calls = [];
  const d1Client = {
    queryReadOnly: async (target, statement, params) => {
      calls.push({ target, statement, params });
      if (statement.includes("service_auth_activation_runs")) return { rows: rows.runs };
      if (statement.includes("service_auth_activation_steps")) return { rows: rows.steps };
      if (statement.includes("service_principal_credentials")) return { rows: rows.credentials };
      if (statement.includes("service_principal_creator_grants")) return { rows: rows.grants };
      if (statement.includes("service_principal_audit_events")) return { rows: rows.auditEvents };
      if (statement.includes("service_principals")) return { rows: rows.principals };
      throw new Error("unexpected structured query");
    },
  };
  const status = await readActivationStatus(registry, activation, plan, d1Client);
  assert.equal(status.state, "SATISFIED");
  assert.equal(status.counts.activationRuns, 1);
  assert.equal(status.counts.canonicalCredentialCount, 5);
  assert.equal(status.counts.canonicalGrantCount, 20);
  assert.equal(calls.length, 6);
  assert.ok(calls.every((call) => call.target.databaseId === activation.expected.databaseId));
  assert.ok(calls.every((call) => !/token_hash|\bdetail\b|operator_identity/i.test(call.statement)));
  const blocked = withActivationStatus(plan, status);
  assert.equal(blocked.activationReady, false);
  assert.equal(blocked.blockingPrecondition, "ACTIVATION_ALREADY_SATISFIED");
  assert.throws(() => assertApplyGates({ plan: blocked, confirmation: blocked.confirmation, cleanGit: true, currentGit: blocked.git, backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId }, registry }), /ACTIVATION_ALREADY_SATISFIED/);
  assert.equal(classifyActivationStatus({ plan, ...rows, credentials: rows.credentials.slice(0, -1) }).state, "CONFLICT");
  assert.equal(withActivationStatus(plan, { state: "CONFLICT", activationRunPresent: true, canonicalRecordsPresent: true, counts: status.counts }).blockingPrecondition, "ACTIVATION_STATE_CONFLICT");
});

test("Wrangler OAuth/D1 mutation preflight is fixed, read-only, isolated, and redacted on failure", async () => {
  const [activation, , registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const calls = [];
  const result = assertD1MutationPreflight(registry, activation, (args, target, options) => calls.push({ args, target, options }));
  assert.deepEqual(result, { result: "WRANGLER_OAUTH_D1_READ_READY", environment: "staging", databaseName: activation.expected.databaseName });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 5), ["--cwd", path.join(root, "cloudflare/thot-os-next"), "d1", "execute", activation.expected.databaseName]);
  assert.equal(calls[0].args.includes("--remote"), true);
  assert.equal(calls[0].args.includes("--json"), true);
  assert.equal(calls[0].args.at(calls[0].args.indexOf("--command") + 1), "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1");
  assert.doesNotMatch(JSON.stringify(calls[0]), /token_hash|INSERT|UPDATE|DELETE|BEGIN|COMMIT/i);
  assert.equal(classifyWranglerMutationFailure({ stderr: "OAuth authorization failed Bearer secret-value" }), "OAUTH_AUTHORIZATION_FAILED");
  assert.equal(classifyWranglerMutationFailure({ stderr: "ETIMEDOUT while connecting" }), "TRANSPORT_FAILED");
  assert.equal(classifyWranglerMutationFailure({ stderr: "D1 database rejected command" }), "D1_COMMAND_REJECTED");
  assert.equal(classifyWranglerMutationFailure({ stderr: "unclassified secret-value" }), "UNKNOWN_MUTATION_FAILURE");
  const source = await readFile(path.join(root, "scripts/service-auth-activate.mjs"), "utf8");
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*(stderr|diagnostic)/);
});

test("D1 write authorization preflight executes only a strictly verified zero-effect UPDATE", async () => {
  const [activation, , registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const calls = [];
  const safeResult = JSON.stringify([{ results: [], success: true, meta: { changes: 0, rows_written: 0, changed_db: false } }]);
  const result = assertD1WriteAuthorizationPreflight(registry, activation, (args, target, options) => {
    calls.push({ args, target, options });
    return safeResult;
  });
  assert.deepEqual(result, { result: "WRANGLER_OAUTH_D1_WRITE_READY", environment: "staging", databaseName: activation.expected.databaseName, changes: 0, rowsWritten: 0, changedDb: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.captureStdout, true);
  assert.equal(calls[0].options.operation, "D1 zero-effect write-authorization preflight");
  assert.equal(calls[0].args.at(calls[0].args.indexOf("--command") + 1), "UPDATE service_auth_activation_runs SET id = id WHERE 0 = 1");
  assert.doesNotMatch(JSON.stringify(calls[0].args), /token_hash|INSERT|DELETE|BEGIN|COMMIT|DROP|CREATE/i);
  assert.deepEqual(parseD1WriteAuthorizationPreflightJson(safeResult), { changes: 0, rowsWritten: 0, changedDb: false });
  for (const meta of [
    { changes: 1, rows_written: 0, changed_db: false },
    { changes: 0, rows_written: 1, changed_db: false },
    { changes: 0, rows_written: 0, changed_db: true },
  ]) {
    assert.throws(() => parseD1WriteAuthorizationPreflightJson(JSON.stringify([{ results: [], success: true, meta }])), /zero-effect/i);
  }
  assert.throws(() => parseD1WriteAuthorizationPreflightJson("spinner\n[]"), /clean JSON/i);
});

test("activation SQL uses an owner-only temporary Wrangler file and removes it", async () => {
  const [, , registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  let stagedPath;
  d1Execute(registry, "thot-os-staging", "SELECT 1;", (args, _registry, options) => {
    assert.equal(options.operation, "D1 activation");
    assert.equal(args.includes("--command"), false);
    const index = args.indexOf("--file");
    assert.ok(index >= 0);
    stagedPath = args[index + 1];
    assert.equal(statSync(stagedPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(stagedPath, "utf8"), "SELECT 1;\n");
  });
  assert.equal(existsSync(stagedPath), false);
});

test("activation and recovery SQL avoid D1-rejected transaction controls", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const credentials = Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `batch-test-secret-${index}`.padEnd(48, "x")]));
  assert.doesNotMatch(activationSql({ plan, activation, credentials, backupReceipt: { sha256: "b".repeat(64) } }), /\bBEGIN\b|\bCOMMIT\b/i);
  assert.doesNotMatch(revokeActivationSql({ plan, activation }), /\bBEGIN\b|\bCOMMIT\b/i);
});

test("Worker metadata is strictly parsed and proves secret staging did not route traffic", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const runner = (args) => {
    const command = args.slice(0, 3).join(" ");
    if (command === "versions list --json") return JSON.stringify([{ id: "previous-unpublished-version" }]);
    if (command === "deployments status --json") return JSON.stringify({ versions: [{ version_id: "published-version", percentage: 100 }] });
    if (command === "versions view previous-unpublished-version") return JSON.stringify({ id: "previous-unpublished-version", resources: { bindings: [] } });
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  const before = captureWorkerMetadata(registry, runner);
  const after = captureStagedWorkerMetadata(before, registry, "unpublished-secret-version", (args) => {
    const command = args.slice(0, 3).join(" ");
    // Deliberately place the existing version first: staged-version proof must
    // use Wrangler's acknowledgement, never implicit list ordering.
    if (command === "versions list --json") return JSON.stringify([{ id: "previous-unpublished-version" }, { id: "unpublished-secret-version" }]);
    if (command === "deployments status --json") return JSON.stringify({ versions: [{ version_id: "published-version", percentage: 100 }] });
    if (command === "versions view unpublished-secret-version") return JSON.stringify({ id: "unpublished-secret-version", resources: { bindings: plan.principals.map((principal) => ({ type: "secret_text", name: principal.secretName })) } });
    throw new Error(`unexpected command: ${args.join(" ")}`);
  });
  const comparison = compareWorkerMetadata(before, after, plan.principals.map((principal) => principal.secretName));
  assert.equal(comparison.deploymentUnchanged, true);
  assert.equal(comparison.stagedSecretVersionTrafficPercentage, 0);
  assert.equal(comparison.stagedVersionId, "unpublished-secret-version");
  assert.equal(comparison.addedSecretNames.length, 5);
  assert.throws(() => compareWorkerMetadata(before, { ...after, deployment: { versions: [{ versionId: "unpublished-secret-version", percentage: 100 }] } }, plan.principals.map((principal) => principal.secretName)), /deployment|traffic/i);
  assert.throws(() => captureStagedWorkerMetadata(before, registry, "missing-version", runner), /absent|acknowledged/i);
  assert.deepEqual(parseWorkerVersionsJson(JSON.stringify([{ id: "older" }, { id: "newest" }])), { latestVersionId: "newest", versionIds: ["older", "newest"] });
  assert.deepEqual(parseWorkerVersionSecretMetadataJson(JSON.stringify({ id: "newest", resources: { bindings: [{ type: "secret_text", name: "SAFE_SECRET" }, { type: "plain_text", name: "SAFE_VAR" }] } }), "newest"), { versionId: "newest", secretNames: ["SAFE_SECRET"], versionTag: null });
  assert.throws(() => parseWorkerVersionSecretMetadataJson(JSON.stringify({ id: "wrong", resources: { bindings: [] } }), "newest"), /did not match/i);
  assert.doesNotMatch(JSON.stringify(comparison), /value|Bearer|token_hash/i);
});

test("activation records a fresh receipt-only attempt id and verified no-routing metadata", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const receipts = [];
  const d1Statements = [];
  const receipt = applyActivation({
    plan,
    activation,
    registry,
    backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId },
    output: "/non-persistent/test-activation-receipt.json",
    releaseAttemptId: "sa-release-00000000-0000-4000-8000-000000000001",
    generateCredentials: () => Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `successful-test-secret-${index}`.padEnd(48, "x")])),
    preflightD1Mutation: () => {},
    captureMetadata: metadataSequence(plan),
    stageSecrets: () => stagedSecretResult(plan),
    executeD1: (_target, _database, statement) => d1Statements.push(statement),
    writeReceipt: (_output, value) => receipts.push(value),
  });
  assert.equal(receipt.result, "D1_ACTIVE");
  assert.equal(receipt.releaseAttemptId, "sa-release-00000000-0000-4000-8000-000000000001");
  assert.equal(receipt.workerSecretMetadata.deploymentUnchanged, true);
  assert.equal(receipt.workerSecretMetadata.stagedSecretVersionTrafficPercentage, 0);
  assert.equal(d1Statements.length, 1);
  assert.doesNotMatch(JSON.stringify(receipts), /successful-test-secret|token_hash|Bearer/i);
});

test("OAuth/D1 preflight failure stops before credential generation, secret staging, or D1 mutation", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const receipts = [];
  let credentialCalls = 0;
  let stageCalls = 0;
  let d1Calls = 0;
  assert.throws(() => applyActivation({
    plan,
    activation,
    registry,
    backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId },
    output: "/non-persistent/test-preflight-receipt.json",
    preflightD1Mutation: () => { throw new Error("Wrangler staging D1 OAuth read preflight failed through the approved OAuth/Keychain path (OAUTH_AUTHORIZATION_FAILED)."); },
    generateCredentials: () => { credentialCalls += 1; return {}; },
    stageSecrets: () => { stageCalls += 1; return stagedSecretResult(plan); },
    executeD1: () => { d1Calls += 1; },
    writeReceipt: (_output, receipt) => receipts.push(receipt),
  }), /before canonical D1 credentials/i);
  assert.equal(credentialCalls, 0);
  assert.equal(stageCalls, 0);
  assert.equal(d1Calls, 0);
  assert.equal(receipts.at(-1).result, "FAILED");
  assert.deepEqual(receipts.at(-1).stagedSecretNames, []);
  assert.doesNotMatch(JSON.stringify(receipts), /OAUTH_AUTHORIZATION_FAILED|secret-value|Bearer/i);
});

test("confirmed explicit recovery uses only deterministic revoke SQL and verifies REVOKED state", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const basePlan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const plan = withActivationStatus(basePlan, { state: "SATISFIED", activationRunPresent: true, canonicalRecordsPresent: true, counts: { activationRuns: 1, activationSteps: 3, canonicalPrincipals: 5, canonicalCredentialCount: 5, canonicalGrantCount: 19, canonicalAuditEventCount: 5 } });
  assert.equal(assertRevokeGates({ plan, confirmation: revokeConfirmation(plan.activationId, plan.planSha256), registry }), true);
  assert.throws(() => assertRevokeGates({ plan, confirmation: plan.confirmation, registry }), /confirmation/i);
  const statements = [];
  const receipts = [];
  const receipt = await revokeActivation({
    plan,
    activation,
    registry,
    output: "/non-persistent/test-recovery-receipt.json",
    d1Client: {},
    releaseAttemptId: "sa-release-00000000-0000-4000-8000-000000000000",
    executeD1: (_target, _database, statement) => statements.push(statement),
    readStatus: async () => ({ state: "REVOKED", activationRunPresent: true, canonicalRecordsPresent: true, counts: { activationRuns: 1, activationSteps: 4, canonicalPrincipals: 5, canonicalCredentialCount: 5, canonicalGrantCount: 19, canonicalAuditEventCount: 10 } }),
    writeReceipt: (_output, value) => receipts.push(value),
  });
  assert.equal(receipt.result, "REVOKED");
  assert.equal(receipt.releaseAttemptId, "sa-release-00000000-0000-4000-8000-000000000000");
  assert.equal(statements.length, 1);
  assert.match(statements[0], /UPDATE service_principal_credentials SET status='revoked'/);
  assert.doesNotMatch(statements[0], /\bDELETE\b/);
  assert.doesNotMatch(JSON.stringify(receipts), /token_hash|Bearer|secret value/i);
});

test("activation CLI has explicit plan/apply modes and receipts reject secret material", () => {
  assert.equal(parseArgs(["--environment", "staging"]).mode, "plan");
  assert.equal(parseArgs(["--environment", "staging", "--apply"]).mode, "apply");
  assert.equal(parseArgs(["--environment", "staging", "--status"]).mode, "status");
  assert.equal(parseArgs(["--environment", "staging", "--mutation-preflight"]).mode, "mutation-preflight");
  assert.equal(parseArgs(["--environment", "staging", "--write-authorization-preflight"]).mode, "write-authorization-preflight");
  assert.equal(parseArgs(["--environment", "staging", "--revoke"]).mode, "revoke");
  assert.throws(() => parseArgs(["--environment", "staging", "--apply", "--revoke"]), /exactly one/i);
  assert.throws(() => redactActivationReceipt({ secret: "not allowed" }), /prohibited/i);
  assert.deepEqual(redactActivationReceipt({ activationId: "safe", principalCount: 4, verification: "PASS" }), { activationId: "safe", principalCount: 4, verification: "PASS" });
  assert.throws(() => redactActivationReceipt({ credentials: "not allowed" }), /prohibited/i);
});

test("activation mutations strip read credentials and use the Wrangler keychain OAuth path", async () => {
  const [, , registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const environment = mutationWranglerEnvironment({
    accountId: registry.environments.staging.accountId,
    baseEnvironment: {
      CLOUDFLARE_API_TOKEN: "read-only-test-token",
      CF_API_TOKEN: "alternate-read-only-test-token",
      CLOUDFLARE_API_KEY: "legacy-test-key",
      CLOUDFLARE_EMAIL: "test@example.invalid",
      CLOUDFLARE_API_USER_SERVICE_KEY: "user-service-key-test-value",
      CF_API_USER_SERVICE_KEY: "legacy-user-service-key-test-value",
      CF_PAGES_UPLOAD_JWT: "pages-upload-jwt-test-value",
      WRANGLER_R2_SQL_AUTH_TOKEN: "r2-sql-auth-test-value",
      WRANGLER_CF_AUTHORIZATION_TOKEN: "cf-authorization-test-value",
      CLOUDFLARE_ACCESS_CLIENT_ID: "access-client-id-test-value",
      CLOUDFLARE_ACCESS_CLIENT_SECRET: "access-client-secret-test-value",
      CLOUDFLARE_STAGING_GATEWAY_TOKEN: "staging-gateway-test-value",
      CF_FUTURE_API_TOKEN: "future-api-token-test-value",
      WRANGLER_FUTURE_SERVICE_SECRET: "future-service-secret-test-value",
      CLOUDFLARE_API_BASE_URL: "https://unapproved.example.invalid",
      CF_API_BASE_URL: "https://unapproved-cf.example.invalid",
      CLOUDFLARE_BASE_URL: "https://unapproved-client.example.invalid",
      WRANGLER_TOKEN_URL: "https://unapproved-token.example.invalid",
      WRANGLER_LOG_PATH: "/unapproved/log-path",
      WRANGLER_OUTPUT_FILE_PATH: "/unapproved/output-path",
      CLOUDFLARE_AUTH_USE_KEYRING: "false",
      PATH: "/usr/bin",
    },
  });
  assert.equal(environment.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(environment.CF_API_TOKEN, undefined);
  assert.equal(environment.CLOUDFLARE_API_KEY, undefined);
  assert.equal(environment.CLOUDFLARE_EMAIL, undefined);
  assert.equal(environment.CLOUDFLARE_API_USER_SERVICE_KEY, undefined);
  assert.equal(environment.CF_API_USER_SERVICE_KEY, undefined);
  assert.equal(environment.CF_PAGES_UPLOAD_JWT, undefined);
  assert.equal(environment.WRANGLER_R2_SQL_AUTH_TOKEN, undefined);
  assert.equal(environment.WRANGLER_CF_AUTHORIZATION_TOKEN, undefined);
  assert.equal(environment.CLOUDFLARE_ACCESS_CLIENT_ID, undefined);
  assert.equal(environment.CLOUDFLARE_ACCESS_CLIENT_SECRET, undefined);
  assert.equal(environment.CLOUDFLARE_STAGING_GATEWAY_TOKEN, undefined);
  assert.equal(environment.CF_FUTURE_API_TOKEN, undefined);
  assert.equal(environment.WRANGLER_FUTURE_SERVICE_SECRET, undefined);
  assert.equal(environment.CLOUDFLARE_API_BASE_URL, undefined);
  assert.equal(environment.CF_API_BASE_URL, undefined);
  assert.equal(environment.CLOUDFLARE_BASE_URL, undefined);
  assert.equal(environment.WRANGLER_TOKEN_URL, undefined);
  assert.equal(environment.WRANGLER_LOG_PATH, undefined);
  assert.equal(environment.WRANGLER_OUTPUT_FILE_PATH, undefined);
  assert.equal(environment.CLOUDFLARE_AUTH_USE_KEYRING, "true");
  assert.equal(environment.CLOUDFLARE_ACCOUNT_ID, registry.environments.staging.accountId);

  const calls = [];
  runWranglerMutation(["versions", "secret", "bulk"], registry, {
    input: "memory-only-test-input",
    execFileSyncImpl: (command, args, options) => calls.push({ command, args, options }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.input, "memory-only-test-input");
  assert.equal(calls[0].options.env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(calls[0].options.env.CLOUDFLARE_AUTH_USE_KEYRING, "true");
  assert.deepEqual(calls[0].options.stdio, ["pipe", "ignore", "pipe"]);
  const captured = runWranglerMutation(["versions", "secret", "bulk"], registry, {
    input: "memory-only-test-input",
    captureStdout: true,
    execFileSyncImpl: (_command, _args, options) => {
      assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
      assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined);
      return "metadata-only acknowledgement";
    },
  });
  assert.equal(captured, "metadata-only acknowledgement");
  const rawChildError = Object.assign(new Error("untrusted raw child error"), { stderr: "OAuth rejected Bearer value-that-must-not-escape" });
  assert.throws(() => runWranglerMutation(["d1", "execute"], registry, { execFileSyncImpl: () => { throw rawChildError; } }), (error) => {
    assert.equal(error.failureCategory, "OAUTH_AUTHORIZATION_FAILED");
    assert.doesNotMatch(error.message, /value-that-must-not-escape|Bearer/);
    return true;
  });
  assert.equal(redactedMutationFailureCategory(mutationFailure("D1_COMMAND_REJECTED")), "D1_COMMAND_REJECTED");
  assert.equal(redactedMutationFailureCategory(new Error("untrusted raw child error")), "UNKNOWN_MUTATION_FAILURE");
});

test("secret staging is an stdin-only bulk update with no secret file or command-line secret", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const credentials = Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `memory-only-test-secret-${index}`.padEnd(48, "x")]));
  const calls = [];
  const staged = stageWebSecrets(plan, registry, credentials, (args, target, options) => {
    calls.push({ args, target, options });
    return "✨ Success! Created version a1111111-1111-4111-8111-111111111111 with 5 secrets.\n";
  });
  const { secretNames } = staged;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ["versions", "secret", "bulk"]);
  assert.equal(calls[0].args.includes("--secrets-file"), false);
  assert.equal(calls[0].args.some((arg) => String(arg).includes("memory-only-test-secret")), false);
  assert.deepEqual(Object.keys(JSON.parse(calls[0].options.input)).sort(), secretNames.slice().sort());
  assert.match(calls[0].options.input, /memory-only-test-secret-0/);
  assert.equal(calls[0].options.captureStdout, true);
  assert.equal(staged.stagedVersionId, "a1111111-1111-4111-8111-111111111111");
  assert.doesNotMatch(String(calls[0].args), /memory-only-test-secret/);
  assert.throws(() => stageWebSecrets(plan, registry, credentials, () => "unexpected output"), /verifiable version acknowledgement/i);
  const source = await readFile(path.join(root, "scripts/service-auth-activate.mjs"), "utf8");
  assert.doesNotMatch(source, /web-secrets\.json|--secrets-file/);
  assert.match(source, /thot-os-service-auth-d1-/);
});

test("secret-stage failure does not attempt canonical D1 activation", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const receipts = [];
  let d1Calls = 0;
  assert.throws(() => applyActivation({
    plan,
    activation,
    backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId },
    registry,
    output: "/non-persistent/test-receipt.json",
    generateCredentials: () => Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `stage-failure-test-secret-${index}`.padEnd(48, "x")])),
    preflightD1Mutation: () => {},
    captureMetadata: metadataSequence(plan),
    stageSecrets: () => { throw new Error("simulated secret stage failure"); },
    executeD1: () => { d1Calls += 1; },
    writeReceipt: (_output, receipt) => receipts.push(receipt),
  }), /before canonical D1 credentials were attempted/i);
  assert.equal(d1Calls, 0);
  assert.equal(receipts.at(-1).result, "FAILED");
  assert.equal(receipts.at(-1).canonicalCredentialsDisabled, 0);
  assert.doesNotMatch(JSON.stringify(receipts), /stage-failure-test-secret/);
});

test("uncertain D1 activation is neutralised by deterministic canonical revocation without legacy auth changes", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const backupReceipt = { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId };
  const credentials = Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `rollback-test-secret-${index}`.padEnd(48, "x")]));
  const d1Statements = [];
  const receipts = [];
  assert.throws(() => applyActivation({
    plan,
    activation,
    backupReceipt,
    registry,
    output: "/non-persistent/test-receipt.json",
    generateCredentials: () => ({ ...credentials }),
    preflightD1Mutation: () => {},
    captureMetadata: metadataSequence(plan),
    stageSecrets: () => stagedSecretResult(plan),
    executeD1: (_target, _databaseName, statement) => {
      d1Statements.push(statement);
      if (d1Statements.length === 1) throw new Error("simulated uncertain transport outcome");
    },
    writeReceipt: (_output, receipt) => receipts.push(receipt),
  }), /revoked.*legacy authentication remained unchanged/i);
  assert.equal(d1Statements.length, 2);
  assert.doesNotMatch(d1Statements[0], /rollback-test-secret/);
  assert.match(d1Statements[0], /token_hash/);
  assert.match(d1Statements[1], /UPDATE service_principal_credentials SET status='revoked'/);
  assert.match(d1Statements[1], /UPDATE service_principal_creator_grants SET status='revoked'/);
  assert.match(d1Statements[1], /UPDATE service_principals SET status='revoked'/);
  assert.match(d1Statements[1], /'REVOKED'/);
  assert.doesNotMatch(d1Statements[1], /\bDELETE\b|\bservice_credentials\b|\bservice_creator_grants\b/);
  assert.equal(receipts.at(-1).result, "REVOKED");
  assert.equal(receipts.at(-1).legacyAuthenticationRemoved, false);
  assert.doesNotMatch(JSON.stringify(receipts), /rollback-test-secret/);
});

test("receipt-write failure after D1 activation also revokes the canonical credentials", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const backupReceipt = { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId };
  const d1Statements = [];
  const receiptWrites = [];
  assert.throws(() => applyActivation({
    plan,
    activation,
    backupReceipt,
    registry,
    output: "/non-persistent/test-receipt.json",
    generateCredentials: () => Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `post-d1-test-secret-${index}`.padEnd(48, "x")])),
    preflightD1Mutation: () => {},
    captureMetadata: metadataSequence(plan),
    stageSecrets: () => stagedSecretResult(plan),
    executeD1: (_target, _databaseName, statement) => d1Statements.push(statement),
    writeReceipt: (_output, receipt) => {
      receiptWrites.push(receipt);
      if (receiptWrites.length === 1) throw new Error("simulated receipt persistence failure");
    },
  }), /revoked.*legacy authentication remained unchanged/i);
  assert.equal(d1Statements.length, 2);
  assert.match(d1Statements[1], /UPDATE service_principal_credentials SET status='revoked'/);
  assert.equal(receiptWrites.at(-1).result, "REVOKED");
  assert.doesNotMatch(JSON.stringify(receiptWrites), /post-d1-test-secret/);
});

test("failed automatic revocation fail-closes as rollback-required without revealing credentials", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const receipts = [];
  let d1Calls = 0;
  assert.throws(() => applyActivation({
    plan,
    activation,
    backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId },
    registry,
    output: "/non-persistent/test-receipt.json",
    generateCredentials: () => Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `rollback-required-test-secret-${index}`.padEnd(48, "x")])),
    preflightD1Mutation: () => {},
    captureMetadata: metadataSequence(plan),
    stageSecrets: () => stagedSecretResult(plan),
    executeD1: () => {
      d1Calls += 1;
      throw d1Calls === 1
        ? mutationFailure("D1_COMMAND_REJECTED", "untrusted D1 failure with Bearer value-that-must-not-escape")
        : mutationFailure("OAUTH_AUTHORIZATION_FAILED", "untrusted revoke failure with Bearer value-that-must-not-escape");
    },
    writeReceipt: (_output, receipt) => receipts.push(receipt),
  }), /automatic canonical-credential revocation did not complete/i);
  assert.equal(d1Calls, 2);
  assert.equal(receipts.at(-1).result, "ROLLBACK_REQUIRED");
  assert.equal(receipts.at(-1).legacyAuthenticationRemoved, false);
  assert.equal(receipts.at(-1).activationFailureCategory, "D1_COMMAND_REJECTED");
  assert.equal(receipts.at(-1).automaticRevokeFailureCategory, "OAUTH_AUTHORIZATION_FAILED");
  assert.doesNotMatch(JSON.stringify(receipts), /rollback-required-test-secret|value-that-must-not-escape|Bearer|untrusted/);
});

test("revocation SQL is deterministic, idempotent, and limited to canonical activation records", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const statement = revokeActivationSql({ plan, activation });
  assert.equal(statement, revokeActivationSql({ plan, activation }));
  assert.match(statement, /INSERT OR IGNORE INTO service_principal_audit_events/);
  assert.match(statement, /INSERT OR IGNORE INTO service_auth_activation_steps/);
  assert.doesNotMatch(statement, /\bDELETE\b|\bservice_credentials\b|\bservice_creator_grants\b/);
  const rawCredential = "never-in-sql-credential".padEnd(48, "x");
  assert.doesNotMatch(activationSql({ plan, activation, credentials: Object.fromEntries(plan.principals.map((principal) => [principal.principalName, rawCredential])), backupReceipt: { sha256: "b".repeat(64) } }), /never-in-sql-credential/);
});
