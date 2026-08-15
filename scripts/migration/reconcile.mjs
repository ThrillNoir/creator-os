import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MIGRATION_DISABLED_MESSAGE,
  buildManifest,
  closeStableSnapshot,
  gitSha,
  loadMapping,
  migrationState,
  openReadOnlySnapshot,
  reconcileCreator,
  requireApprovedMapping,
  validateTargetAuthority,
  verifyExpectedMigrations,
} from "./reconciliation-lib.mjs";

function usage() {
  return "Usage: node scripts/migration/reconcile.mjs --environment staging --creator <creator-id|all> --source-snapshot <absolute SQLite path> --target-snapshot <absolute D1 parse SQLite path> [--output <absolute JSON path>]";
}

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--environment", "--creator", "--source-snapshot", "--target-snapshot", "--output"].includes(argument)) options[argument.slice(2).replaceAll("-", "_")] = argv[++index];
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function requireOptions(options) {
  if (options.apply) throw new Error(MIGRATION_DISABLED_MESSAGE);
  if (options.help) return;
  for (const required of ["environment", "creator", "source_snapshot", "target_snapshot"]) if (!options[required]) throw new Error(`Missing --${required.replaceAll("_", "-")}. ${usage()}`);
  if (options.output && !path.isAbsolute(options.output)) throw new Error("--output must be an absolute path.");
}

export function reconcile(options) {
  requireOptions(options);
  const targetAuthority = validateTargetAuthority({ environment: options.environment });
  const mappingFile = loadMapping();
  const source = openReadOnlySnapshot(options.source_snapshot, "Source snapshot");
  const target = openReadOnlySnapshot(options.target_snapshot, "Target snapshot");
  try {
    targetAuthority.migrations = migrationState(target.db);
    verifyExpectedMigrations(targetAuthority.migrations);
    targetAuthority.sha256 = target.sha256;
    const creators = options.creator === "all" ? mappingFile.mappings.map((item) => item.sqliteCreatorId) : [options.creator];
    const manifests = creators.map((creatorId) => {
      const mapping = requireApprovedMapping(mappingFile, creatorId);
      const domains = reconcileCreator({ sourceDb: source.db, targetDb: target.db, creatorId });
      return buildManifest({ source, target: targetAuthority, mapping, creatorId, domains, gitSha: gitSha() });
    });
    return { mode: "READ ONLY", source: path.basename(source.path), target: targetAuthority.databaseName, environment: targetAuthority.environment, manifests };
  } finally {
    closeStableSnapshot(source, "Source snapshot");
    closeStableSnapshot(target, "Target snapshot");
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const result = reconcile(options);
  if (options.output) {
    mkdirSync(path.dirname(options.output), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  console.log(`SOURCE: ${result.source}`);
  console.log(`TARGET: ${result.environment}/${result.target}`);
  console.log(`MODE: ${result.mode}`);
  for (const manifest of result.manifests) console.log(JSON.stringify({ creator: manifest.creator.sqliteCreatorId, migrationId: manifest.migrationId, domains: manifest.domains }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
