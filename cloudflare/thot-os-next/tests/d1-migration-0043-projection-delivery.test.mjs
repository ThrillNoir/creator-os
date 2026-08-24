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

test("0043 projection deliveries cannot cross creator/profile/version scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-projection-delivery-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  let db;
  try {
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
      name: "thot-os-projection-delivery-local",
      compatibility_date: "2026-08-21",
      d1_databases: [{ binding: "DB", database_name: "thot-os-projection-delivery-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
    }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-projection-delivery-local", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
    assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    const databasePath = await findDatabase(state);
    assert.ok(databasePath);
    db = new Database(databasePath);
    const checksum = "a".repeat(64);
    db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('second','Second','second','S')").run();
    db.prepare("INSERT INTO creator_public_profiles (id,creator_id,slug,created_by) VALUES ('profile-a','adelaide','adelaide-test','connect@thrillnoir.com')").run();
    db.prepare("INSERT INTO creator_public_profile_versions (id,profile_id,creator_id,version_number,display_name,content_checksum,created_by) VALUES ('version-a','profile-a','adelaide',1,'Adelaide',?,'connect@thrillnoir.com')").run(checksum);
    db.prepare("INSERT INTO creator_public_profiles (id,creator_id,slug,created_by) VALUES ('profile-b','second','second-test','connect@thrillnoir.com')").run();
    db.prepare("INSERT INTO creator_public_profile_versions (id,profile_id,creator_id,version_number,display_name,content_checksum,created_by) VALUES ('version-b','profile-b','second',1,'Second',?,'connect@thrillnoir.com')").run(checksum);
    db.prepare("INSERT INTO operation_outbox (id,creator_id,operation_type,idempotency_key,payload) VALUES ('operation-a','adelaide','public_profile_publish','operation-a','{}')").run();
    db.prepare("INSERT INTO operation_outbox (id,creator_id,operation_type,idempotency_key,payload) VALUES ('operation-a-2','adelaide','public_profile_publish','operation-a-2','{}')").run();
    db.prepare("INSERT INTO creator_profile_projection_deliveries (id,operation_id,creator_id,surface,action,profile_id,version_id,snapshot_key) VALUES ('delivery-a','operation-a','adelaide','public_sfw','publish','profile-a','version-a','public-profile:adelaide-test')").run();
    assert.throws(() => db.prepare("INSERT INTO creator_profile_projection_deliveries (id,operation_id,creator_id,surface,action,profile_id,version_id,snapshot_key) VALUES ('cross-version','operation-a-2','adelaide','public_sfw','withdraw','profile-a','version-b','public-profile:adelaide-test')").run(), /creator_profile_projection_delivery_scope_invalid/);
    assert.throws(() => db.prepare("UPDATE creator_profile_projection_deliveries SET profile_id='profile-b',version_id='version-b' WHERE id='delivery-a'").run(), /creator_profile_projection_delivery_scope_invalid/);
    assert.throws(() => db.prepare("UPDATE creator_profile_projection_deliveries SET creator_id='second' WHERE id='delivery-a'").run(), /creator_profile_projection_delivery_scope_invalid/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
