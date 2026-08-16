import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertApplyGates, buildActivationPlan, planDigest, redactActivationReceipt, sha256 } from "./service-auth-activation-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = { activation: path.join(root, "config/service-auth-activation.staging.json"), contract: path.join(root, "config/service-principals.json"), registry: path.join(root, "config/deployments.json") };
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

function d1Migrations(registry, activation) {
  const accountId = registry.environments.staging.accountId;
  const output = execFileSync("npx", ["wrangler", "d1", "execute", activation.expected.databaseName, "--remote", "--command", "SELECT name FROM d1_migrations ORDER BY name", "--json"], {
    cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId }, stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output);
  const rows = parsed?.[0]?.results ?? parsed?.results ?? [];
  return rows.map((row) => row.name);
}

function d1Execute(registry, databaseName, sql) {
  return execFileSync("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", sql, "--json"], {
    cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: registry.environments.staging.accountId }, stdio: ["ignore", "pipe", "pipe"],
  });
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const stableId = (activationId, value) => `sa-${sha256(`${activationId}:${value}`).slice(0, 24)}`;

function activationSql({ plan, activation, credentials, backupReceipt }) {
  const registrySha256 = sha256(readJson(defaults.registry));
  const migrationSha256 = sha256(plan.observedMigrations);
  const statements = ["BEGIN IMMEDIATE;"];
  statements.push(`INSERT INTO service_auth_activation_runs (id,environment,plan_sha256,registry_sha256,backup_receipt_sha256,target_database_id,target_migration_state_sha256,git_sha,git_branch,operator_identity) VALUES (${sql(plan.activationId)},'staging',${sql(plan.planSha256)},${sql(registrySha256)},${sql(backupReceipt.sha256)},${sql(plan.database.databaseId)},${sql(migrationSha256)},${sql(plan.git.sha)},${sql(plan.git.branch)},${sql(activation.operatorIdentity)});`);
  statements.push(`INSERT INTO service_auth_activation_steps (id,activation_id,step,detail) VALUES (${sql(stableId(plan.activationId, "planned"))},${sql(plan.activationId)},'PLANNED','{}');`);
  for (const principal of plan.principals) {
    const principalId = stableId(plan.activationId, `principal:${principal.id}`);
    const credentialId = stableId(plan.activationId, `credential:${principal.id}`);
    statements.push(`INSERT INTO service_principals (id,principal_name,status) VALUES (${sql(principalId)},${sql(principal.principalName)},'active');`);
    statements.push(`INSERT INTO service_principal_credentials (id,service_principal_id,token_hash,status) VALUES (${sql(credentialId)},${sql(principalId)},${sql(sha256(credentials[principal.principalName]))},'active');`);
    statements.push(`INSERT INTO service_principal_audit_events (id,service_principal_id,credential_id,event_type,actor_identity,detail) VALUES (${sql(stableId(plan.activationId, `credential-event:${principal.id}`))},${sql(principalId)},${sql(credentialId)},'credential_created',${sql(activation.operatorIdentity)},${sql(JSON.stringify({ activationId: plan.activationId, credentialGenerated: true }))});`);
  }
  for (const grant of plan.grants) {
    const principal = plan.principals.find((entry) => entry.principalName === grant.principalName);
    const principalId = stableId(plan.activationId, `principal:${principal.id}`);
    statements.push(`INSERT INTO service_principal_creator_grants (service_principal_id,creator_id,capability,status) VALUES (${sql(principalId)},${sql(grant.creatorId)},${sql(grant.capability)},'active');`);
  }
  statements.push(`INSERT INTO service_auth_activation_steps (id,activation_id,step,detail) VALUES (${sql(stableId(plan.activationId, "d1-active"))},${sql(plan.activationId)},'D1_ACTIVE',${sql(JSON.stringify({ principalCount: plan.principals.length, grantCount: plan.grants.length }))});`);
  statements.push("COMMIT;");
  return statements.join("\n");
}

function stageWebSecrets(plan, registry) {
  const credentials = Object.fromEntries(plan.principals.map((principal) => [principal.principalName, crypto.randomBytes(48).toString("base64url")]));
  const secretFile = path.join(mkdtempSync(path.join(os.tmpdir(), "thot-os-service-auth-")), "web-secrets.json");
  try {
    writeFileSync(secretFile, JSON.stringify(Object.fromEntries(plan.principals.map((principal) => [principal.secretName, credentials[principal.principalName]]))), { mode: 0o600 });
    execFileSync("npx", ["wrangler", "versions", "upload", "--config", registry.environments.staging.components.web.config, "--secrets-file", secretFile], {
      cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: registry.environments.staging.accountId }, stdio: ["ignore", "pipe", "pipe"],
    });
    return credentials;
  } finally {
    rmSync(path.dirname(secretFile), { recursive: true, force: true });
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
      const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: d1Migrations(registry, activation), git: currentGitIdentity() });
      if (options.mode === "plan") {
        if (options.output) writeFileSync(options.output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
        console.log(JSON.stringify(plan, null, 2));
      } else {
        if (!options.approvedPlan || !options.backupReceipt || !options.output) throw new Error("Apply requires --approved-plan, --backup-receipt, and redacted --output receipt paths.");
        const approvedPlan = readJson(options.approvedPlan);
        if (planDigest(approvedPlan) !== approvedPlan.planSha256) throw new Error("Approved plan checksum is invalid.");
        const backupReceipt = readJson(options.backupReceipt);
        assertApplyGates({ plan: approvedPlan, confirmation: options.confirmation, cleanGit: cleanGitTree(), currentGit: currentGitIdentity(), backupReceipt, registry });
        const migrations = d1Migrations(registry, activation);
        if (JSON.stringify(migrations) !== JSON.stringify(approvedPlan.observedMigrations)) throw new Error("Activation apply requires the exact expanded and compatibility-ready D1 migration state.");
        const credentials = stageWebSecrets(approvedPlan, registry);
        try {
          d1Execute(registry, activation.expected.databaseName, activationSql({ plan: approvedPlan, activation, credentials, backupReceipt }));
        } catch (error) {
          const failed = redactActivationReceipt({ activationId: approvedPlan.activationId, environment: "staging", result: "ROLLBACK_REQUIRED", stagedWebSecrets: approvedPlan.principals.map((entry) => entry.secretName), d1Activation: "FAILED", detail: "No staged version may receive traffic." });
          writeFileSync(options.output, `${JSON.stringify(failed, null, 2)}\n`, { mode: 0o600 });
          throw error;
        }
        const receipt = redactActivationReceipt({ activationId: approvedPlan.activationId, environment: "staging", result: "D1_ACTIVE", principalCount: approvedPlan.principals.length, secretNames: approvedPlan.principals.map((entry) => entry.secretName), creatorGrantCount: approvedPlan.grants.length, d1CredentialHashesInstalled: approvedPlan.principals.length, nextStep: "Deploy compatible receivers, route the staged Web version, then run protected no-op probes." });
        writeFileSync(options.output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
        console.log(JSON.stringify(receipt, null, 2));
      }
    }
  } catch (error) {
    console.error(`Service-auth activation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
