import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { validateTargetAuthority, verifyExpectedMigrations } from "./reconciliation-lib.mjs";
import { assertExactMigrationHistory, hashCanonicalJson, hashFileBytes, inventoryFromLedger, validateReleaseExportPlan } from "../bounded-d1-migrations-lib.mjs";
import { projectRoot } from "../deployment-preflight.mjs";

const cloudflareEnvironmentOverride = /^(?:CLOUDFLARE_|CF_|WRANGLER_)/;

function usage() {
  return "Usage: node scripts/migration/export-target.mjs --environment staging --output <absolute local .sql path> [--approved-plan <absolute bounded-plan.json>]";
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--environment", "--output", "--approved-plan"].includes(argument)) result[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    else if (argument === "--help") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function readApprovedPlan(planPath) {
  if (!planPath || !path.isAbsolute(planPath) || !existsSync(planPath)) throw new Error("A readable absolute approved bounded migration plan is required.");
  try {
    return JSON.parse(readFileSync(planPath, "utf8"));
  } catch {
    throw new Error("Approved bounded migration plan must be exactly one valid JSON document.");
  }
}

/**
 * D1 export is a read-only operation but Cloudflare implements it as a POST
 * control-plane request. The separate D1-read credential is therefore useful
 * for planning only; it cannot authorize the export endpoint. Use the
 * already-approved Wrangler OAuth keyring for this exact command, strip every
 * inherited Cloudflare override, and never inject a raw bearer into the child.
 */
export function readOnlyD1ExportEnvironment({ accountId, baseEnvironment = process.env } = {}) {
  if (typeof accountId !== "string" || accountId === "") throw new Error("A staging account ID is required for the read-only D1 export.");
  const environment = Object.fromEntries(Object.entries(baseEnvironment).filter(([key]) => !cloudflareEnvironmentOverride.test(key)));
  return { ...environment, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_AUTH_USE_KEYRING: "true" };
}

function receiptFor({ target, plan, preMigrationState, sqlPath, parsePath }) {
  const receipt = {
    schemaVersion: plan ? 2 : 1,
    mode: "READ ONLY REMOTE EXPORT",
    target,
    sqlChecksum: hashFileBytes(sqlPath),
    parseChecksum: hashFileBytes(parsePath),
    targetSnapshot: path.basename(parsePath),
    exportedAt: new Date().toISOString(),
    ...(plan ? {
      releaseId: plan.releaseId,
      planSha256: plan.planSha256,
      preMigrationStateSha256: hashCanonicalJson(preMigrationState),
      validation: "REVIEWED_BOUNDED_PLAN_PRE_STATE",
    } : {}),
  };
  receipt.receiptHash = hashCanonicalJson(receipt);
  return receipt;
}

function exportMigrationHistory(database) {
  const rows = database.prepare("SELECT id,name FROM d1_migrations ORDER BY id").all();
  if (!rows.every((row, index) => Number.isInteger(row.id) && row.id > 0 && (index === 0 || row.id > rows[index - 1].id) && typeof row.name === "string" && /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/i.test(row.name))) {
    throw new Error("Read-only staging export has malformed D1 migration history.");
  }
  return rows.map((row) => row.name);
}

export function exportTarget({ environment, output, approvedPlan }) {
  if (environment !== "staging" || !output || !path.isAbsolute(output)) throw new Error(`Only a staging target export to an absolute local path is permitted. ${usage()}`);
  const target = validateTargetAuthority({ environment });
  const plan = approvedPlan ? readApprovedPlan(approvedPlan) : null;
  const inventory = plan ? inventoryFromLedger(path.join(projectRoot, "cloudflare/thot-os-app/migrations"), JSON.parse(readFileSync(path.join(projectRoot, "config/staging-d1-migration-ledger.json"), "utf8")), readdirSync) : null;
  const releaseBaseline = plan ? validateReleaseExportPlan({ plan, target, inventory }) : null;
  const sqlPath = path.resolve(output);
  const parsePath = `${sqlPath}.sqlite`;
  if (existsSync(sqlPath) || existsSync(parsePath)) throw new Error("Refusing to overwrite an existing target export or parse database.");
  const outputDirectory = path.dirname(sqlPath);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  chmodSync(outputDirectory, 0o700);
  const wrangler = path.join(projectRoot, "cloudflare/thot-os-next/node_modules/.bin/wrangler");
  try {
    execFileSync(wrangler, ["--cwd", path.join(projectRoot, "cloudflare/thot-os-next"), "d1", "export", target.databaseName, "--remote", "--skip-confirmation", "--output", sqlPath], {
      cwd: projectRoot,
      encoding: "utf8",
      env: readOnlyD1ExportEnvironment({ accountId: target.accountId }),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Read-only staging D1 export failed; no SQL output is trusted.");
  }
  chmodSync(sqlPath, 0o600);
  try {
    const parse = new Database(parsePath);
    // D1 exports schema objects in SQLite's catalog order, which can place a
    // child table before its parent. Replaying that trusted read-only export
    // with enforcement enabled rejects a valid dump before its full schema is
    // loaded. Validate the completed parse with foreign_key_check instead.
    parse.pragma("foreign_keys = OFF");
    parse.exec(readFileSync(sqlPath, "utf8"));
    target.migrations = exportMigrationHistory(parse);
    if (releaseBaseline) assertExactMigrationHistory(target.migrations, releaseBaseline.preMigrationState, "Export migration history");
    else verifyExpectedMigrations(target.migrations);
    if (parse.pragma("foreign_key_check").length !== 0) throw new Error("Read-only staging export has foreign-key violations.");
    parse.close();
    chmodSync(parsePath, 0o600);
  } catch (error) {
    if (existsSync(parsePath)) unlinkSync(parsePath);
    throw error;
  }
  const receipt = receiptFor({ target, plan, preMigrationState: releaseBaseline?.preMigrationState, sqlPath, parsePath });
  const receiptPath = `${sqlPath}.receipt.json`;
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { sqlPath, parsePath, receiptPath, receipt };
}

try {
  const input = options(process.argv.slice(2));
  if (input.help) console.log(usage());
  else {
    const result = exportTarget(input);
    console.log(`SOURCE: Cloudflare D1 ${result.receipt.target.databaseName}`);
    console.log(`TARGET: ${result.parsePath}`);
    console.log("MODE: READ ONLY REMOTE EXPORT");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
