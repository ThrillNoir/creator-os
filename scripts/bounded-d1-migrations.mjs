import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertApplyGates, buildBoundedPlan, executeBoundedPlan, inventoryFromDirectory, sha256, validateBackup } from "./bounded-d1-migrations-lib.mjs";
import { readDeploymentRegistry, readJsoncFile } from "./deployment-preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(root, "config/bounded-d1-migrations.json");
const registryPath = path.join(root, "config/deployments.json");
const canonicalConfigPath = path.join(root, "cloudflare/thot-os-next/wrangler.jsonc");
const wrangler = path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler");

function usage() {
  return `Usage: npm run d1:migrations:plan -- --environment staging --release-id <id> --from 0028 --through 0031 [--output <absolute plan.json>]
       npm run d1:migrations:apply -- --apply --approved-plan <absolute plan.json> --backup-receipt <absolute export.receipt.json> --confirmation bounded:<digest> --receipt <absolute receipt.json>`;
}

export function parseArgs(argv) {
  const options = { mode: "plan" };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (["--environment", "--release-id", "--from", "--through", "--output", "--approved-plan", "--backup-receipt", "--confirmation", "--receipt"].includes(option)) options[option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    else if (option === "--plan") options.mode = "plan";
    else if (option === "--apply") options.apply = true;
    else if (option === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${option}`);
  }
  return options;
}

function absolute(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return path.resolve(value);
}
function json(file, label) {
  const resolved = absolute(file, label);
  if (!existsSync(resolved)) throw new Error(`${label} does not exist.`);
  return { path: resolved, value: parseTrustedJson(readFileSync(resolved, "utf8"), label) };
}
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
export function gitIdentity() { return { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]) || "detached" }; }
export function gitClean() { return git(["status", "--porcelain"]) === ""; }

function loadAuthority() {
  const registry = readDeploymentRegistry(registryPath);
  const policy = parseTrustedJson(readFileSync(policyPath, "utf8"), "Bounded migration policy");
  const config = readJsoncFile(canonicalConfigPath);
  const d1 = config.d1_databases?.find((binding) => binding.binding === "DB");
  if (!d1) throw new Error("Canonical Web Wrangler configuration has no DB binding.");
  const target = registry.environments?.staging?.resources?.d1?.[d1.database_name];
  if (config.account_id !== registry.environments?.staging?.accountId || !target || target.id !== d1.database_id || target.migrationsDir !== d1.migrations_dir) throw new Error("Registry and canonical Web D1 binding disagree.");
  return { registry, policy, config, target };
}
export function parseTrustedJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} must be exactly one valid JSON document.`);
  }
}
export function parseWranglerJson({ stdout, stderr, operation }) {
  if (typeof stdout !== "string" || stdout.trim() === "") throw new Error(`${operation} produced empty JSON stdout.`);
  if (typeof stderr !== "string" || stderr.trim() !== "") throw new Error(`${operation} emitted unexpected stderr; refusing to parse machine output.`);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${operation} produced invalid or ambiguous JSON stdout.`);
  }
}
export function parseWranglerProcess({ status, signal, error, stdout, stderr, operation }) {
  if (error || status !== 0 || signal) throw new Error(`${operation} failed before JSON validation.`);
  return parseWranglerJson({ stdout: stdout ?? "", stderr: stderr ?? "", operation });
}
function runWrangler(authority, args, operation) {
  const result = spawnSync(wrangler, ["--cwd", path.join(root, "cloudflare/thot-os-next"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: authority.registry.environments.staging.accountId }, stdio: ["ignore", "pipe", "pipe"] });
  return parseWranglerProcess({ ...result, operation });
}
export function resultRows(parsed) {
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0]?.success !== true || !Array.isArray(parsed[0]?.results)) throw new Error("D1 query response has an unexpected or ambiguous result schema.");
  return parsed[0].results;
}
export function migrationNamesFromRows(rows) {
  if (!rows.every((row, index) => Number.isInteger(row.id) && row.id > 0 && (index === 0 || row.id > rows[index - 1].id) && typeof row.name === "string" && row.name.length > 0 && typeof row.applied_at === "string" && row.applied_at.length > 0)) throw new Error("Remote d1_migrations response is malformed.");
  return rows.map((row) => row.name);
}
export function readRemoteIdentity(authority, databaseName) {
  const result = runWrangler(authority, ["d1", "info", databaseName, "--json"], "Cloudflare D1 identity read");
  if (!result || Array.isArray(result) || typeof result.uuid !== "string" || result.uuid.length === 0) throw new Error("Cloudflare D1 identity response has no valid UUID.");
  return result.uuid;
}
export function readRemoteApplied(authority, databaseName) {
  let rows;
  try {
    rows = resultRows(runWrangler(authority, ["d1", "execute", databaseName, "--remote", "--command", "SELECT id, name, applied_at FROM d1_migrations ORDER BY id", "--json"], "Cloudflare D1 migration-history read"));
  } catch {
    throw new Error("Cannot read canonical d1_migrations without mutation; refusing to initialize it.");
  }
  return migrationNamesFromRows(rows);
}
function assertRemoteIdentity(authority, target) {
  const uuid = readRemoteIdentity(authority, target.databaseName);
  if (uuid !== target.databaseId) throw new Error("Remote D1 UUID does not match registry and canonical Web binding.");
}
export function writeNew(file, content) {
  const resolved = absolute(file, "Output path");
  if (existsSync(resolved)) throw new Error("Refusing to overwrite an existing evidence file.");
  writeFileSync(resolved, `${content}\n`, { mode: 0o600 });
  return resolved;
}
function markdownReceipt(receipt) {
  return `# Bounded D1 Migration Receipt

- Result: ${receipt.result}
- Release: ${receipt.releaseId}
- Target: ${receipt.target.databaseName} (${receipt.target.databaseId})
- Requested: ${receipt.requestedRange.from} through ${receipt.requestedRange.through}
- Applied: ${receipt.applied.join(", ") || "none"}
- Failed: ${receipt.failed?.migration ?? "none"}
- Excluded: ${receipt.excludedPending.join(", ") || "none"}
- Production touched: no
`;
}
function executeFile(authority, databaseName, sql) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "thot-os-bounded-d1-"));
  const file = path.join(directory, "single-migration.sql");
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    resultRows(runWrangler(authority, ["d1", "execute", databaseName, "--remote", "--file", file, "--json"], "Selected bounded D1 migration"));
  } catch {
    throw new Error("Selected migration command failed; no later migration was attempted.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function makePlan(options) {
  if (options.environment !== "staging") throw new Error("An explicit staging environment is required.");
  const authority = loadAuthority();
  const inventoryDirectory = path.resolve(path.dirname(canonicalConfigPath), authority.target.migrationsDir);
  const inventory = inventoryFromDirectory(inventoryDirectory, readdirSync);
  const gitState = gitIdentity();
  if (!gitClean()) throw new Error("Planning requires a clean Git working tree.");
  gitState.clean = true;
  assertRemoteIdentity(authority, { databaseName: Object.keys(authority.registry.environments.staging.resources.d1)[0], databaseId: authority.target.id });
  const remoteApplied = readRemoteApplied(authority, Object.keys(authority.registry.environments.staging.resources.d1)[0]);
  return { authority, inventoryDirectory, plan: buildBoundedPlan({ environment: options.environment, from: options.from, through: options.through, releaseId: options.releaseId, inventory, remoteApplied, registry: authority.registry, policy: authority.policy, git: gitState }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else if (!options.apply) {
      const { plan } = makePlan(options);
      if (options.output) writeNew(options.output, JSON.stringify(plan, null, 2));
      console.log(JSON.stringify(plan, null, 2));
    } else {
      if (!options.approvedPlan || !options.backupReceipt || !options.receipt || !options.confirmation) throw new Error("Apply requires --approved-plan, --backup-receipt, --receipt, and --confirmation.");
      const approved = json(options.approvedPlan, "Approved plan");
      if (approved.value.environment !== "staging") throw new Error("Production and non-staging apply are disabled.");
      const regeneratedOptions = { environment: approved.value.environment, from: approved.value.requestedRange?.from, through: approved.value.requestedRange?.through, releaseId: approved.value.releaseId };
      const { authority, inventoryDirectory, plan: currentPlan } = makePlan(regeneratedOptions);
      const backupInput = json(options.backupReceipt, "Backup receipt");
      const backup = validateBackup({ receipt: backupInput.value, receiptPath: backupInput.path, target: approved.value.target, maxAgeMinutes: authority.policy.backupMaxAgeMinutes });
      assertApplyGates({ plan: approved.value, currentPlan, remoteApplied: currentPlan.preMigrationState, git: gitIdentity(), clean: gitClean(), backup, confirmation: options.confirmation });
      const receipt = await executeBoundedPlan({
        plan: approved.value,
        directory: inventoryDirectory,
        executeOne: ({ sql }) => executeFile(authority, approved.value.target.databaseName, sql),
        getApplied: () => readRemoteApplied(authority, approved.value.target.databaseName),
        receiptBase: { schemaVersion: 1, releaseId: approved.value.releaseId, target: approved.value.target, git: gitIdentity(), backup, startedAt: new Date().toISOString(), planSourceSha256: sha256(readFileSync(approved.path)) },
      });
      receipt.completedAt = new Date().toISOString();
      receipt.receiptSha256 = sha256(receipt);
      const receiptPath = writeNew(options.receipt, JSON.stringify(receipt, null, 2));
      writeNew(`${receiptPath}.md`, markdownReceipt(receipt));
      console.log(JSON.stringify({ result: receipt.result, receipt: receiptPath, applied: receipt.applied, failed: receipt.failed?.migration ?? null, excludedPending: receipt.excludedPending }, null, 2));
      if (receipt.result !== "APPLIED") process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Bounded D1 migration executor failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
