import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrationState, validateTargetAuthority, verifyExpectedMigrations } from "./reconciliation-lib.mjs";
import { assertExactMigrationHistory, hashCanonicalJson, hashFileBytes, inventoryFromDirectory, validateReleaseExportPlan } from "../bounded-d1-migrations-lib.mjs";
import { projectRoot } from "../deployment-preflight.mjs";

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

export function exportTarget({ environment, output, approvedPlan }) {
  if (environment !== "staging" || !output || !path.isAbsolute(output)) throw new Error(`Only a staging target export to an absolute local path is permitted. ${usage()}`);
  const target = validateTargetAuthority({ environment });
  const plan = approvedPlan ? readApprovedPlan(approvedPlan) : null;
  const inventory = plan ? inventoryFromDirectory(path.join(projectRoot, "cloudflare/thot-os-app/migrations"), readdirSync) : null;
  const releaseBaseline = plan ? validateReleaseExportPlan({ plan, target, inventory }) : null;
  const sqlPath = path.resolve(output);
  const parsePath = `${sqlPath}.sqlite`;
  if (existsSync(sqlPath) || existsSync(parsePath)) throw new Error("Refusing to overwrite an existing target export or parse database.");
  mkdirSync(path.dirname(sqlPath), { recursive: true });
  const wrangler = path.join(projectRoot, "cloudflare/thot-os-next/node_modules/.bin/wrangler");
  try {
    execFileSync(wrangler, ["--cwd", path.join(projectRoot, "cloudflare/thot-os-next"), "d1", "export", target.databaseName, "--remote", "--skip-confirmation", "--output", sqlPath], { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("Read-only staging D1 export failed; no SQL output is trusted.");
  }
  try {
    const parse = new Database(parsePath);
    parse.exec(readFileSync(sqlPath, "utf8"));
    target.migrations = migrationState(parse);
    if (releaseBaseline) assertExactMigrationHistory(target.migrations, releaseBaseline.preMigrationState, "Export migration history");
    else verifyExpectedMigrations(target.migrations);
    parse.close();
  } catch (error) {
    if (existsSync(parsePath)) unlinkSync(parsePath);
    throw error;
  }
  const receipt = receiptFor({ target, plan, preMigrationState: releaseBaseline?.preMigrationState, sqlPath, parsePath });
  const receiptPath = `${sqlPath}.receipt.json`;
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
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
