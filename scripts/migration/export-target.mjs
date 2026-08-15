import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashFile, migrationState, sha256, stableJson, validateTargetAuthority, verifyExpectedMigrations } from "./reconciliation-lib.mjs";
import { projectRoot } from "../deployment-preflight.mjs";

function usage() {
  return "Usage: node scripts/migration/export-target.mjs --environment staging --output <absolute local .sql path>";
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--environment", "--output"].includes(argument)) result[argument.slice(2)] = argv[++index];
    else if (argument === "--help") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

export function exportTarget({ environment, output }) {
  if (environment !== "staging" || !output || !path.isAbsolute(output)) throw new Error(`Only a staging target export to an absolute local path is permitted. ${usage()}`);
  const target = validateTargetAuthority({ environment });
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
    verifyExpectedMigrations(target.migrations);
    parse.close();
  } catch (error) {
    if (existsSync(parsePath)) unlinkSync(parsePath);
    throw error;
  }
  const receipt = { schemaVersion: 1, mode: "READ ONLY REMOTE EXPORT", target, sqlChecksum: hashFile(sqlPath), parseChecksum: hashFile(parsePath), targetSnapshot: path.basename(parsePath), exportedAt: new Date().toISOString(), receiptHash: sha256(stableJson({ target, sqlChecksum: hashFile(sqlPath), parseChecksum: hashFile(parsePath) })) };
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
