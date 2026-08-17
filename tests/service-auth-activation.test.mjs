import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { activationConfirmation, assertApplyGates, buildActivationPlan, planDigest, redactActivationReceipt } from "../scripts/service-auth-activation-lib.mjs";
import { activationSql, applyActivation, d1Migrations, mutationWranglerEnvironment, parseArgs, revokeActivationSql, runWranglerMutation, stageWebSecrets } from "../scripts/service-auth-activate.mjs";

const root = path.resolve(import.meta.dirname, "..");
const json = (file) => readFile(path.join(root, file), "utf8").then(JSON.parse);
const baseline = Array.from({ length: 27 }, (_, index) => `${String(index + 1).padStart(4, "0")}_placeholder.sql`).slice(0, -1).concat("0027_reddit_post_flairs.sql");

test("service-auth activation plan is redacted, deterministic, staging-only, and blocked before expansion", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: baseline, git: { sha: "a".repeat(40), branch: "audit/test" } });
  assert.equal(plan.expandReady, false);
  assert.equal(plan.compatibilityReady, false);
  assert.equal(plan.activationReady, false);
  assert.equal(plan.principals.length, 4);
  assert.equal(plan.grants.length, 15);
  assert.equal(plan.operationsIfApplied.d1CredentialHashes, 4);
  assert.equal(plan.operationsIfApplied.legacyAuthenticationRemoved, false);
  assert.equal(plan.confirmation, activationConfirmation(plan.activationId, plan.planSha256));
  assert.equal(planDigest(plan), plan.planSha256);
  assert.doesNotMatch(JSON.stringify(plan), /Bearer|token_hash|credential value/i);
  assert.throws(() => buildActivationPlan({ activation: { ...activation, environment: "production" }, contract, registry, observedMigrations: baseline, git: {} }), /staging/i);
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
  const base = { plan, cleanGit: true, currentGit: plan.git, backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId }, registry };
  assert.equal(assertApplyGates({ ...base, confirmation: plan.confirmation }), true);
  assert.throws(() => assertApplyGates({ ...base, confirmation: "wrong" }), /confirmation/i);
  assert.throws(() => assertApplyGates({ ...base, cleanGit: false, confirmation: plan.confirmation }), /clean Git/i);
  assert.throws(() => assertApplyGates({ ...base, backupReceipt: { ...base.backupReceipt, databaseId: "wrong" }, confirmation: plan.confirmation }), /backup/i);
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

test("activation CLI has explicit plan/apply modes and receipts reject secret material", () => {
  assert.equal(parseArgs(["--environment", "staging"]).mode, "plan");
  assert.equal(parseArgs(["--environment", "staging", "--apply"]).mode, "apply");
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
});

test("secret staging is an stdin-only bulk update with no secret file or command-line secret", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations], git: { sha: "a".repeat(40), branch: "audit/test" } });
  const credentials = Object.fromEntries(plan.principals.map((principal, index) => [principal.principalName, `memory-only-test-secret-${index}`.padEnd(48, "x")]));
  const calls = [];
  const secretNames = stageWebSecrets(plan, registry, credentials, (args, target, options) => calls.push({ args, target, options }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ["versions", "secret", "bulk"]);
  assert.equal(calls[0].args.includes("--secrets-file"), false);
  assert.equal(calls[0].args.some((arg) => String(arg).includes("memory-only-test-secret")), false);
  assert.deepEqual(Object.keys(JSON.parse(calls[0].options.input)).sort(), secretNames.slice().sort());
  assert.match(calls[0].options.input, /memory-only-test-secret-0/);
  assert.doesNotMatch(String(calls[0].args), /memory-only-test-secret/);
  const source = await readFile(path.join(root, "scripts/service-auth-activate.mjs"), "utf8");
  assert.doesNotMatch(source, /mkdtempSync|os\.tmpdir|web-secrets\.json|--secrets-file/);
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
    stageSecrets: () => {},
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
    stageSecrets: () => {},
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
    stageSecrets: () => {},
    executeD1: () => {
      d1Calls += 1;
      throw new Error("simulated mutation transport failure");
    },
    writeReceipt: (_output, receipt) => receipts.push(receipt),
  }), /automatic canonical-credential revocation did not complete/i);
  assert.equal(d1Calls, 2);
  assert.equal(receipts.at(-1).result, "ROLLBACK_REQUIRED");
  assert.equal(receipts.at(-1).legacyAuthenticationRemoved, false);
  assert.doesNotMatch(JSON.stringify(receipts), /rollback-required-test-secret/);
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
