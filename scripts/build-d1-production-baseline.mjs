import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = path.join(projectRoot, "cloudflare/thot-os-app/migrations");
const outputPath = path.join(projectRoot, "cloudflare/thot-os-app/production-baseline/schema.sql");
const wrangler = path.join(projectRoot, "cloudflare/thot-os-next/node_modules/.bin/wrangler");

function checksum(value) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
}

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDatabase(candidate);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") {
      return candidate;
    }
  }
  return null;
}

async function baselineSql() {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-production-baseline-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  try {
    await mkdir(migrations);
    const names = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (const name of names) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
      name: "thot-os-production-baseline-local",
      compatibility_date: "2026-08-17",
      d1_databases: [{ binding: "DB", database_name: "thot-os-production-baseline-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
    }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-production-baseline-local", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
    if (replay.status !== 0) throw new Error(`${replay.stdout}\n${replay.stderr}`.trim());
    const databasePath = await findDatabase(state);
    if (!databasePath) throw new Error("Local D1 replay did not create a database.");
    const database = new Database(databasePath, { readonly: true });
    try {
      const rows = database.prepare(`SELECT type,name,sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name<>'d1_migrations'
        ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name`).all();
      const migrationDigests = await Promise.all(names.map(async (name) => `${name} ${checksum(await readFile(path.join(migrationsRoot, name), "utf8"))}`));
      return `-- THOT OS schema-only production baseline.\n-- Generated from the complete local D1 migration replay; it contains no creator, account, content, consent, credential, or operator seed data.\n-- Do not apply this file to an existing D1 database.  Use it only when provisioning a new production database under the cutover runbook.\n-- Source migration checksums:\n${migrationDigests.map((line) => `-- ${line}`).join("\n")}\n\nPRAGMA foreign_keys = ON;\n\n${rows.map((row) => `${row.sql};`).join("\n\n")}\n`;
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
