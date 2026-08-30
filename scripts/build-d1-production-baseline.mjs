import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = path.join(projectRoot, "cloudflare/thot-os-app/migrations");
const outputPath = path.join(projectRoot, "cloudflare/thot-os-app/production-baseline/schema.sql");
const ledgerPath = path.join(projectRoot, "config/staging-d1-migration-ledger.json");

function checksum(value) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
}

async function baselineSql() {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-production-baseline-"));
  try {
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger.migrations) || ledger.migrations.some((entry) => !/^\d{4}_.+\.sql$/.test(entry?.name ?? ""))) throw new Error("Reviewed staging migration ledger is invalid.");
    const names = ledger.migrations.map((entry) => entry.name);
    const database = new Database(path.join(root, "replay.sqlite"));
    try {
      database.exec("PRAGMA foreign_keys = ON; CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
      for (const name of names) {
        const source = await readFile(path.join(migrationsRoot, name), "utf8");
        database.exec(source);
        database.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      }
      const rows = database.prepare(`SELECT type,name,sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'
        ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name`).all();
      const migrationDigests = await Promise.all(names.map(async (name) => `${name} ${checksum(await readFile(path.join(migrationsRoot, name), "utf8"))}`));
      const migrationLedger = [
        "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);",
        ...names.map((name, index) => `INSERT INTO d1_migrations (id, name) VALUES (${index + 1}, '${name.replaceAll("'", "''")}');`),
      ].join("\n");
      return `-- THOT OS schema-only production baseline.\n-- Generated from the complete local D1 migration replay; it contains no creator, account, content, consent, credential, or operator seed data.\n-- The d1_migrations rows are schema provenance only, so future migrations begin at the correct boundary.\n-- Do not apply this file to an existing D1 database.  Use it only when provisioning a new production database under the cutover runbook.\n-- Source migration checksums:\n${migrationDigests.map((line) => `-- ${line}`).join("\n")}\n\nPRAGMA foreign_keys = ON;\n\n${migrationLedger}\n\n${rows.map((row) => `${row.sql};`).join("\n\n")}\n`;
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const verifyOnly = process.argv.includes("--check");
const generated = await baselineSql();
if (verifyOnly) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== generated) throw new Error("Production baseline is stale. Run npm run d1:production-baseline:build.");
  console.log("Production baseline is current.");
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated);
  console.log(`Wrote ${path.relative(projectRoot, outputPath)}.`);
}
