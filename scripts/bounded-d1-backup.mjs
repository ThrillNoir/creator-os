#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashCanonicalJson, hashFileBytes, inventoryFromLedger, replayD1ExportMigrationHistory, validateReleaseExportPlan } from "./bounded-d1-migrations-lib.mjs";
import { createActivationD1ReadClient, mutationWranglerEnvironment } from "./service-auth-activate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(path.join(root, "config/deployments.json"), "utf8"));
const ledger = JSON.parse(readFileSync(path.join(root, "config/staging-d1-migration-ledger.json"), "utf8"));
const migrationDirectory = path.join(root, "cloudflare/thot-os-app/migrations");
const wrangler = path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler");

function usage() { return "Usage: node scripts/bounded-d1-backup.mjs --approved-plan <absolute plan.json> --output-dir <absolute owner-only directory>"; }
function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--approved-plan") options.approvedPlan = argv[++index];
    else if (option === "--output-dir") options.outputDir = argv[++index];
    else if (option === "--help") options.help = true;
    else throw new Error("unknown_option");
  }
  return options;
}
function ownerOnlyDirectory(input) {
  if (!input || !path.isAbsolute(input)) throw new Error("owner_only_output_directory_required");
  const directory = realpathSync(input); const info = statSync(directory);
  const relative = path.relative(root, directory);
  if (!info.isDirectory() || lstatSync(directory).isSymbolicLink() || (info.mode & 0o077) !== 0 || (typeof process.getuid === "function" && info.uid !== process.getuid()) || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) throw new Error("owner_only_external_output_directory_required");
  return directory;
}
function planFrom(file) {
  if (!file || !path.isAbsolute(file)) throw new Error("approved_plan_required");
  return JSON.parse(readFileSync(file, "utf8"));
}
function exportStaging(plan, output) {
  try {
    execFileSync(wrangler, ["--cwd", path.join(root, "cloudflare/thot-os-next"), "d1", "export", plan.target.databaseName, "--remote", "--skip-confirmation", "--output", output], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"],
      env: mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId }),
    });
  } catch { throw new Error("read_only_staging_export_failed"); }
}

async function main() {
  const options = parse(process.argv.slice(2)); if (options.help) return console.log(usage());
  const plan = planFrom(options.approvedPlan); const inventory = inventoryFromLedger(migrationDirectory, ledger, readdirSync);
  validateReleaseExportPlan({ plan, target: plan.target, inventory });
  const directory = ownerOnlyDirectory(options.outputDir);
  const exportPath = path.join(directory, `staging-d1-${plan.planSha256}.sql`); const receiptPath = `${exportPath}.receipt.json`;
  if (existsSync(exportPath) || existsSync(receiptPath)) throw new Error("refusing_to_overwrite_export_evidence");
  const client = createActivationD1ReadClient();
  const target = { accountId: plan.target.accountId, databaseId: plan.target.databaseId, databaseName: plan.target.databaseName };
  const verified = await client.verifyTarget(target); if (verified.databaseId !== target.databaseId || verified.databaseName !== target.databaseName || verified.accountId !== target.accountId) throw new Error("staging_database_identity_changed");
  const before = await client.readMigrationHistory(target);
  if (hashCanonicalJson(before) !== hashCanonicalJson(plan.preMigrationState)) throw new Error("staging_migration_history_changed");
  exportStaging(plan, exportPath); chmodSync(exportPath, 0o600);
  const exported = replayD1ExportMigrationHistory(exportPath); const after = await client.readMigrationHistory(target);
  if (hashCanonicalJson(exported) !== hashCanonicalJson(plan.preMigrationState) || hashCanonicalJson(after) !== hashCanonicalJson(plan.preMigrationState)) throw new Error("staging_export_history_changed");
  const receipt = { schemaVersion: 2, mode: "READ ONLY REMOTE EXPORT", target: { ...plan.target, migrations: before }, planSha256: plan.planSha256, preMigrationStateSha256: hashCanonicalJson(plan.preMigrationState), sqlChecksum: hashFileBytes(exportPath), exportedAt: new Date().toISOString() };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ result: "READ_ONLY_REMOTE_EXPORT_READY", exportPath, receiptPath, sqlChecksum: receipt.sqlChecksum, migrations: before.length }, null, 2));
}
main().catch((error) => { console.error(`Bounded D1 backup failed: ${error instanceof Error ? error.message : "unknown_error"}`); process.exitCode = 1; });
