import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const appRoot = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.resolve(appRoot, "../thot-os-app/migrations");
const wrangler = path.resolve(appRoot, "node_modules/.bin/wrangler");

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDatabase(candidate);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") return candidate;
  }
  return null;
}

test("0041 adds bounded profile appearance storage without weakening draft-only writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-profile-appearance-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  let db;
  try {
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({ name: "thot-os-profile-appearance-local", compatibility_date: "2026-08-21", d1_databases: [{ binding: "DB", database_name: "thot-os-profile-appearance-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }] })));
    const result = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-profile-appearance-local", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    db = new Database(await findDatabase(state));
    const columns = db.prepare("PRAGMA table_info(creator_public_profile_details)").all().map((column) => column.name);
    assert.ok(columns.includes("theme_key"));
    assert.ok(columns.includes("button_style"));
    assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='creator_adult_profile_appearances'").get().sql.includes("inherit_sfw_theme"));
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
