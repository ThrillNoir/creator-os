import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { activationBackupReceiptDigest, activationConfirmation, planDigest, registryHasProductionOperationalSurface, sha256, sha256Bytes } from "./service-auth-activation-lib.mjs";
import { checkD1Integrity } from "./cloudflare-d1-read.mjs";
import { createActivationD1ReadClient, mutationWranglerEnvironment } from "./service-auth-activate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const activationPath = path.join(root, "config/service-auth-activation.staging.json");
const registryPath = path.join(root, "config/deployments.json");
const webWorkerDirectory = path.join(root, "cloudflare/thot-os-next");
const wrangler = path.join(webWorkerDirectory, "node_modules/.bin/wrangler");

const json = (file, label) => {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value;
  } catch {
    throw new Error(`${label} must be one valid JSON document.`);
  }
};

const sameArray = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (["--environment", "--approved-plan", "--output-dir"].includes(option)) options[option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    else if (option === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${option}`);
  }
  return options;
}

export function usage() {
  return "Usage: npm run services:activation-backup -- --environment staging --approved-plan <absolute plan.json> --output-dir <absolute secure backup directory>";
}

function inside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function assertSecureExternalBackupDirectory(directory, { statSyncImpl = statSync, realpathSyncImpl = realpathSync } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("Activation backup output directory must be an absolute path.");
  let resolved;
  let info;
  try {
    resolved = realpathSyncImpl(directory);
    info = statSyncImpl(resolved);
  } catch {
    throw new Error("Activation backup output directory must already exist and be accessible.");
  }
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || (typeof process.getuid === "function" && info.uid !== process.getuid()) || inside(resolved, root)) {
    throw new Error("Activation backup output directory must be a user-owned, non-repository directory with mode 0700.");
  }
  return resolved;
}

export function assertApprovedActivationPlan(plan, activation, registry) {
  const staging = registry?.environments?.staging;
  if (plan?.schemaVersion !== 1 || plan.mode !== "plan" || plan.environment !== "staging" || plan.activationId !== activation?.activationId || plan?.database?.databaseName !== activation?.expected?.databaseName || plan?.database?.databaseId !== activation?.expected?.databaseId) {
    throw new Error("Approved activation plan does not match the reviewed staging activation manifest.");
  }
  if (staging?.accountId == null || staging.resources?.d1?.[plan.database.databaseName]?.id !== plan.database.databaseId || registryHasProductionOperationalSurface(registry)) {
    throw new Error("Approved activation plan does not match the staging-only deployment registry.");
  }
  if (plan.activationStatus?.state !== "ABSENT" || !plan.expandReady || !plan.compatibilityReady || !plan.activationReady || plan.blockingPrecondition !== null || plan.planSha256 !== planDigest(plan) || plan.confirmation !== activationConfirmation(plan.activationId, plan.planSha256)) {
    throw new Error("Approved activation plan is not currently eligible for a backup gate.");
  }
  return true;
}

export function runReadOnlyD1Export({ registry, databaseName, outputPath, execFileSyncImpl = execFileSync } = {}) {
  try {
    execFileSyncImpl(wrangler, ["--cwd", webWorkerDirectory, "d1", "export", databaseName, "--remote", "--skip-confirmation", "--output", outputPath], {
      cwd: root,
      encoding: "utf8",
      env: mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId }),
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    throw new Error("Read-only staging D1 export failed through the approved OAuth/Keychain path.");
  }
}

export function migrationNamesFromExport(exportPath, { DatabaseImpl = Database } = {}) {
  const parsePath = `${exportPath}.sqlite`;
  let database;
  try {
    database = new DatabaseImpl(parsePath);
    database.exec(readFileSync(exportPath, "utf8"));
    const rows = database.prepare("SELECT id, name FROM d1_migrations ORDER BY id").all();
    if (!rows.every((row, index) => Number.isInteger(row.id) && row.id > 0 && (index === 0 || row.id > rows[index - 1].id) && typeof row.name === "string" && row.name.length > 0)) throw new Error("invalid migrations");
    return rows.map((row) => row.name);
  } catch {
    throw new Error("Read-only activation export could not be parsed into a canonical migration history.");
  } finally {
    try { database?.close(); } catch { /* Best-effort cleanup of the local parse copy. */ }
    try { rmSync(parsePath, { force: true }); } catch { /* The safe backup artifact remains the SQL export only. */ }
  }
}

export async function createActivationBackup({ plan, activation, registry, outputDirectory, d1Client = createActivationD1ReadClient(), runExport = runReadOnlyD1Export, now = () => new Date() } = {}) {
  assertApprovedActivationPlan(plan, activation, registry);
  const backupRoot = assertSecureExternalBackupDirectory(outputDirectory);
  const target = { accountId: registry.environments.staging.accountId, databaseId: plan.database.databaseId, databaseName: plan.database.databaseName };
  const before = await d1Client.readMigrationHistory(target);
  if (!sameArray(before, plan.observedMigrations)) throw new Error("Structured D1 migration history changed before the activation backup could begin.");
  const releaseDirectory = path.join(backupRoot, `activation-${plan.activationId}-${plan.planSha256.slice(0, 12)}-${now().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomUUID()}`);
  const exportPath = path.join(releaseDirectory, "staging-d1.sql");
  const receiptPath = path.join(releaseDirectory, "activation-backup.receipt.json");
  try {
    mkdirSync(releaseDirectory, { mode: 0o700 });
    chmodSync(releaseDirectory, 0o700);
    runExport({ registry, databaseName: plan.database.databaseName, outputPath: exportPath });
    chmodSync(exportPath, 0o600);
    const exportMigrations = migrationNamesFromExport(exportPath);
    const after = await d1Client.readMigrationHistory(target);
    const integrity = await checkD1Integrity(d1Client, target);
    if (!sameArray(exportMigrations, plan.observedMigrations) || !sameArray(after, plan.observedMigrations)) throw new Error("Activation backup migration history did not remain identical to the approved plan.");
    const exportBytes = readFileSync(exportPath);
    const receipt = {
      schemaVersion: 1,
      mode: "READ_ONLY_ACTIVATION_BACKUP",
      activationId: plan.activationId,
      environment: "staging",
      accountId: target.accountId,
      databaseName: target.databaseName,
      databaseId: target.databaseId,
      planSha256: plan.planSha256,
      planGit: plan.git,
      migrationHistory: plan.observedMigrations,
      migrationStateSha256: sha256(plan.observedMigrations),
      exportedAt: now().toISOString(),
      exportPath,
      export: { fileName: path.basename(exportPath), bytes: exportBytes.length, sha256: sha256Bytes(exportBytes) },
      integrity,
    };
    receipt.sha256 = activationBackupReceiptDigest(receipt);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    return { receiptPath, receipt };
  } catch (error) {
    try { rmSync(releaseDirectory, { recursive: true, force: true }); } catch { /* Never retain an incomplete raw staging export. */ }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      if (options.environment !== "staging" || !options.approvedPlan || !options.outputDir) throw new Error(usage());
      if (!path.isAbsolute(options.approvedPlan)) throw new Error("Approved activation plan must be an absolute path.");
      const activation = json(activationPath, "Activation manifest");
      const registry = json(registryPath, "Deployment registry");
      const plan = json(options.approvedPlan, "Approved activation plan");
      const result = await createActivationBackup({ plan, activation, registry, outputDirectory: options.outputDir });
      console.log(JSON.stringify({ result: "READ_ONLY_ACTIVATION_BACKUP_READY", receiptPath: result.receiptPath, receiptSha256: result.receipt.sha256, migrationCount: result.receipt.migrationHistory.length, exportBytes: result.receipt.export.bytes, integrity: result.receipt.integrity }, null, 2));
    }
  } catch (error) {
    console.error(`Activation backup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
