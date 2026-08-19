import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { projectRoot, readDeploymentRegistry } from "./deployment-preflight.mjs";

const webWorkerDirectory = path.join(projectRoot, "cloudflare/thot-os-next");
const wrangler = path.join(webWorkerDirectory, "node_modules/.bin/wrangler");
const baselinePath = path.join(projectRoot, "cloudflare/thot-os-app/production-baseline/schema.sql");
const migrationsDirectory = path.join(projectRoot, "cloudflare/thot-os-app/migrations");
const cloudflareEnvironmentOverride = /^(?:CLOUDFLARE_|CF_|WRANGLER_)/;

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseArgs(argv) {
  const options = { mode: "plan" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--environment", "--output-dir", "--confirmation"].includes(argument)) options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    else if (argument === "--apply") options.mode = "apply";
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return "Usage: node scripts/bootstrap-production-d1.mjs --environment production --output-dir <absolute external directory> [--apply --confirmation bootstrap:<baseline-sha-prefix>]";
}

function assertExternalDirectory(directory) {
  if (!directory || !path.isAbsolute(directory) || !existsSync(directory)) throw new Error("An existing absolute external output directory is required.");
  const resolved = path.resolve(directory);
  const info = statSync(resolved);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("The output directory must be a user-only, non-repository directory.");
  }
  return resolved;
}

function productionTarget(registry) {
  const production = registry.environments?.production;
  const entries = Object.entries(production?.resources?.d1 ?? {});
  if (production?.kind !== "cloudflare" || !production.provisioned || production.deployable || !production.accountId || entries.length !== 1) {
    throw new Error("Production foundation registry is incomplete or unexpectedly deployable.");
  }
  const [databaseName, database] = entries[0];
  if (!database?.id || databaseName !== "thot-os-production") throw new Error("Production D1 identity is incomplete.");
  return { accountId: production.accountId, databaseName, databaseId: database.id };
}

function keyringEnvironment(accountId) {
  const safeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !cloudflareEnvironmentOverride.test(name)));
  return { ...safeEnvironment, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_AUTH_USE_KEYRING: "true" };
}

function runWrangler(target, args) {
  return execFileSync(wrangler, ["--cwd", webWorkerDirectory, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: keyringEnvironment(target.accountId),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function migrationNames() {
  return readdirSync(migrationsDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
}

function parseExport(file) {
  const database = new Database(":memory:");
  try {
    database.exec(readFileSync(file, "utf8"));
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
    return {
      tables,
      migrationRows: tables.includes("d1_migrations") ? database.prepare("SELECT id, name FROM d1_migrations ORDER BY id").all() : [],
      creatorRows: tables.includes("creators") ? database.prepare("SELECT COUNT(*) AS count FROM creators").get().count : 0,
      quickCheck: database.pragma("quick_check", { simple: true }),
    };
  } finally {
    database.close();
  }
}

function exportDatabase(target, output) {
  runWrangler(target, ["d1", "export", target.databaseName, "--remote", "--skip-confirmation", "--output", output]);
  chmodSync(output, 0o600);
}

function applyBaseline(target) {
  runWrangler(target, ["d1", "execute", target.databaseName, "--remote", "--file", baselinePath, "--json"]);
}

function plan(registry) {
  const target = productionTarget(registry);
  const baselineSha256 = hashFile(baselinePath);
  return {
    schemaVersion: 1,
    mode: "PRODUCTION_D1_BOOTSTRAP_PLAN",
    target,
    baselinePath,
    baselineSha256,
    expectedMigrationNames: migrationNames(),
    confirmation: `bootstrap:${baselineSha256.slice(0, 16)}`,
    effects: ["read-only export of an empty production D1", "apply the schema-only baseline and D1 migration provenance", "read-only post-apply export and integrity verification"],
  };
}

function bootstrap({ registry, outputDirectory, confirmation }) {
  const approved = plan(registry);
  if (confirmation !== approved.confirmation) throw new Error("Bootstrap apply requires the exact baseline-bound confirmation string.");
  const outputRoot = assertExternalDirectory(outputDirectory);
  const releaseDirectory = mkdtempSync(path.join(outputRoot, "production-d1-bootstrap-"));
  chmodSync(releaseDirectory, 0o700);
  const beforePath = path.join(releaseDirectory, "before-baseline.sql");
  const afterPath = path.join(releaseDirectory, "after-baseline.sql");
  try {
    exportDatabase(approved.target, beforePath);
    const before = parseExport(beforePath);
    if (before.tables.length !== 0 || before.migrationRows.length !== 0) throw new Error("Refusing to apply the production baseline to a non-empty D1 database.");
    applyBaseline(approved.target);
    exportDatabase(approved.target, afterPath);
    const after = parseExport(afterPath);
    const expectedRows = approved.expectedMigrationNames.map((name, index) => ({ id: index + 1, name }));
    if (after.quickCheck !== "ok" || after.creatorRows !== 0 || JSON.stringify(after.migrationRows) !== JSON.stringify(expectedRows)) {
      throw new Error("Post-bootstrap verification did not match the schema-only production baseline.");
    }
    const receipt = {
      schemaVersion: 1,
      mode: "PRODUCTION_D1_BOOTSTRAP_APPLIED",
      target: approved.target,
      baselineSha256: approved.baselineSha256,
      migrationCount: expectedRows.length,
      createdAt: new Date().toISOString(),
      beforeExport: { fileName: path.basename(beforePath), bytes: statSync(beforePath).size, sha256: hashFile(beforePath) },
      afterExport: { fileName: path.basename(afterPath), bytes: statSync(afterPath).size, sha256: hashFile(afterPath) },
      integrity: after.quickCheck,
      operationalRows: { creators: after.creatorRows },
      receiptId: randomUUID(),
    };
    receipt.sha256 = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
    const receiptPath = path.join(releaseDirectory, "production-d1-bootstrap.receipt.json");
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    return { receiptPath, receipt };
  } catch (error) {
    throw new Error(`Production D1 bootstrap stopped: ${error instanceof Error ? error.message : String(error)}. Inspect ${releaseDirectory} before any further operation.`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) console.log(usage());
  else if (options.environment !== "production" || !options.outputDir) throw new Error(usage());
  else if (options.mode === "plan") console.log(JSON.stringify(plan(readDeploymentRegistry()), null, 2));
  else {
    const result = bootstrap({ registry: readDeploymentRegistry(), outputDirectory: options.outputDir, confirmation: options.confirmation });
    console.log(JSON.stringify({ result: "APPLIED", receiptPath: result.receiptPath, target: result.receipt.target, migrationCount: result.receipt.migrationCount, integrity: result.receipt.integrity, operationalRows: result.receipt.operationalRows }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
