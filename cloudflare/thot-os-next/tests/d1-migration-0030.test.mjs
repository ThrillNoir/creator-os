import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const appRoot = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.resolve(appRoot, "../thot-os-app/migrations");
const wrangler = path.resolve(appRoot, "node_modules/.bin/wrangler");

async function databasePath(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) { const nested = await databasePath(candidate); if (nested) return nested; }
    else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") return candidate;
  }
  return null;
}

test("0030 canonical control-plane migration is metadata-only and quarantines known exceptions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0030-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  try {
    await mkdir(migrations);
    const names = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    assert.ok(names.includes("0030_canonical_control_plane.sql"));
    for (const name of names) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({ name: "thot-os-0030-local", compatibility_date: "2026-08-08", d1_databases: [{ binding: "DB", database_name: "thot-os-0030-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }] }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-0030-local", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    const file = await databasePath(state);
    assert.ok(file);
    const db = new Database(file);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_exceptions WHERE status='open'").get().count, 3);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_exceptions WHERE creator_id='thrill-noir'").get().count, 0);
      db.prepare(`INSERT INTO creator_onboarding_receipts (id,idempotency_key,creator_id,requested_by,request_fingerprint,status)
        VALUES ('fixture','creator-onboarding:adelaide','adelaide','connect@thrillnoir.com','x','completed')`).run();
      assert.throws(() => db.prepare(`INSERT INTO creator_onboarding_receipts (id,idempotency_key,creator_id,requested_by,request_fingerprint,status)
        VALUES ('fixture-retry','creator-onboarding:adelaide','adelaide','connect@thrillnoir.com','x','completed')`).run(), /UNIQUE constraint failed/);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally { db.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
