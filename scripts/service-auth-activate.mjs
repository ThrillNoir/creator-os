import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertApplyGates, buildActivationPlan, planDigest, redactActivationReceipt, sha256 } from "./service-auth-activation-lib.mjs";
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
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--environment") options.environment = argv[++i];
    else if (arg === "--activation") options.activation = path.resolve(argv[++i]);
    else if (arg === "--plan") options.mode = "plan";
    else if (arg === "--apply") options.mode = "apply";
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
export function runWranglerMutation(args, registry, { input, execFileSyncImpl = execFileSync } = {}) {
  try {
    return execFileSyncImpl(wrangler, args, {
      cwd: root,
      encoding: "utf8",
      env: mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId }),
      input,
      stdio: ["pipe", "ignore", "pipe"],
    });
  } catch {
    throw new Error("Wrangler staging mutation failed through the approved OAuth/Keychain path.");
  }
}

export async function d1Migrations(registry, activation, d1Client = createActivationD1ReadClient()) {
  const database = registry?.environments?.staging?.resources?.d1?.[activation?.expected?.databaseName];
  if (!database || database.id !== activation.expected.databaseId) throw new Error("Activation D1 identity does not match the deployment registry.");
  return d1Client.readMigrationHistory({
    accountId: registry.environments.staging.accountId,
    databaseId: database.id,
    databaseName: activation.expected.databaseName,
  });
}

export function d1Execute(registry, databaseName, statement, runMutation = runWranglerMutation) {
  return runMutation(["--cwd", webWorkerDirectory, "d1", "execute", databaseName, "--remote", "--command", statement, "--json"], registry);
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const stableId = (activationId, value) => `sa-${sha256(`${activationId}:${value}`).slice(0, 24)}`;
const principalId = (plan, principal) => stableId(plan.activationId, `principal:${principal.id}`);
const credentialId = (plan, principal) => stableId(plan.activationId, `credential:${principal.id}`);

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
  runMutation(["versions", "secret", "bulk", "--config", registry.environments.staging.components.web.config], registry, { input });
  return plan.principals.map((principal) => principal.secretName);
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

export function applyActivation({ plan, activation, backupReceipt, registry, output, generateCredentials = generateActivationCredentials, stageSecrets = stageWebSecrets, executeD1 = d1Execute, writeReceipt = writeActivationReceipt }) {
  const credentials = generateCredentials(plan);
  let secretsMayBeStaged = false;
  let d1MayHaveBeenAttempted = false;
  try {
    stageSecrets(plan, registry, credentials);
    secretsMayBeStaged = true;
    d1MayHaveBeenAttempted = true;
    executeD1(registry, activation.expected.databaseName, activationSql({ plan, activation, credentials, backupReceipt }));
    const receipt = redactActivationReceipt({ activationId: plan.activationId, environment: "staging", result: "D1_ACTIVE", principalCount: plan.principals.length, secretNames: plan.principals.map((entry) => entry.secretName), creatorGrantCount: plan.grants.length, d1CredentialHashesInstalled: plan.principals.length, secretValuesPersistedLocally: false, nextStep: "Deploy compatible receivers, route the staged Web version, then run protected no-op probes." });
    writeReceipt(output, receipt);
    return receipt;
  } catch {
    let receipt;
    if (secretsMayBeStaged && d1MayHaveBeenAttempted) {
      try {
        executeD1(registry, activation.expected.databaseName, revokeActivationSql({ plan, activation }));
        receipt = redactActivationReceipt({ activationId: plan.activationId, environment: "staging", result: "REVOKED", stagedSecretNames: plan.principals.map((entry) => entry.secretName), canonicalCredentialsDisabled: plan.principals.length, legacyAuthenticationRemoved: false, detail: "Activation did not complete; deterministic canonical credentials and grants were revoked." });
      } catch {
        receipt = redactActivationReceipt({ activationId: plan.activationId, environment: "staging", result: "ROLLBACK_REQUIRED", stagedSecretNames: plan.principals.map((entry) => entry.secretName), legacyAuthenticationRemoved: false, detail: "Activation outcome is uncertain and automatic canonical-credential revocation did not complete." });
      }
    } else {
      receipt = redactActivationReceipt({ activationId: plan.activationId, environment: "staging", result: "FAILED", stagedSecretNames: secretsMayBeStaged ? plan.principals.map((entry) => entry.secretName) : [], canonicalCredentialsDisabled: 0, legacyAuthenticationRemoved: false, detail: "D1 canonical credentials were not attempted; staged secrets cannot authenticate without a matching canonical D1 credential hash." });
    }
    try { writeReceipt(output, receipt); } catch { /* The failure path must not emit secret-bearing diagnostics. */ }
    if (receipt.result === "REVOKED") throw new Error("Activation failed; canonical credentials and grants were revoked while legacy authentication remained unchanged.");
    if (receipt.result === "ROLLBACK_REQUIRED") throw new Error("Activation outcome is uncertain and automatic canonical-credential revocation did not complete; stop before any traffic change.");
    throw new Error("Activation failed before canonical D1 credentials were attempted; no traffic change was made.");
  } finally {
    clearCredentials(credentials);
  }
}

function usage() { return "Usage: npm run services:activate -- --environment staging --activation <approved activation json> [--plan|--apply]. Plan is the default and read-only."; }

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
      const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: await d1Migrations(registry, activation, d1Client), git: currentGitIdentity() });
      if (options.mode === "plan") {
        if (options.output) writeFileSync(options.output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
        console.log(JSON.stringify(plan, null, 2));
      } else {
        if (!options.approvedPlan || !options.backupReceipt || !options.output) throw new Error("Apply requires --approved-plan, --backup-receipt, and redacted --output receipt paths.");
        const approvedPlan = readJson(options.approvedPlan);
        if (planDigest(approvedPlan) !== approvedPlan.planSha256) throw new Error("Approved plan checksum is invalid.");
        const backupReceipt = readJson(options.backupReceipt);
        assertApplyGates({ plan: approvedPlan, confirmation: options.confirmation, cleanGit: cleanGitTree(), currentGit: currentGitIdentity(), backupReceipt, registry });
        const migrations = await d1Migrations(registry, activation, d1Client);
        if (JSON.stringify(migrations) !== JSON.stringify(approvedPlan.observedMigrations)) throw new Error("Activation apply requires the exact expanded and compatibility-ready D1 migration state.");
        const receipt = applyActivation({ plan: approvedPlan, activation, backupReceipt, registry, output: options.output });
        console.log(JSON.stringify(receipt, null, 2));
      }
    }
  } catch (error) {
    console.error(`Service-auth activation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
