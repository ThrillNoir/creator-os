import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArguments, reconcile } from "./reconcile.mjs";
import { MIGRATION_DISABLED_MESSAGE, sha256, stableJson } from "./reconciliation-lib.mjs";

function usage() {
  return "Usage: node scripts/migration/plan.mjs --environment staging --creator <creator-id|all> --source-snapshot <absolute SQLite path> --target-snapshot <absolute D1 parse SQLite path> --output <absolute manifest path>";
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.apply) throw new Error(MIGRATION_DISABLED_MESSAGE);
  if (options.help) return console.log(usage());
  if (!options.output) throw new Error(`Missing --output. ${usage()}`);
  const result = reconcile(options);
  const plan = { ...result, mode: "DRY RUN", ledger: { kind: "file-based", applyEnabled: false } };
  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  const ledgerPath = path.join(path.dirname(options.output), "ledger.jsonl");
  const receipt = { manifestPath: path.basename(options.output), manifestHash: sha256(stableJson(plan)), mode: "DRY RUN", migrationIds: plan.manifests.map((manifest) => manifest.migrationId), createdAt: new Date().toISOString() };
  appendFileSync(ledgerPath, `${JSON.stringify(receipt)}\n`, "utf8");
  console.log(`SOURCE: ${result.source}`);
  console.log(`TARGET: ${result.environment}/${result.target}`);
  console.log("MODE: DRY RUN");
  console.log(`MANIFEST: ${options.output}`);
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
