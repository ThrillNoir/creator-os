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

test("0055 scopes provider connections and attempts to operational accounts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0055-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  let db;
  try {
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
      await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    }
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
      name: "thot-os-0055-local",
      compatibility_date: "2026-08-31",
      d1_databases: [{ binding: "DB", database_name: "thot-os-0055-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
    }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-0055-local", "--local", "--persist-to", state], {
      cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" },
    });
    assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    const databasePath = await findDatabase(state);
    assert.ok(databasePath);
    db = new Database(databasePath);

    const postCount = db.prepare("SELECT COUNT(*) AS count FROM social_posts").get().count;
    assert.equal(db.prepare("SELECT account_id FROM provider_connections WHERE creator_id='adelaide' AND service='reddit'").get().account_id, "adelaide-reddit-main");
    assert.equal(db.prepare("SELECT account_id FROM provider_connections WHERE creator_id='adelaide' AND service='instagram'").get().account_id, "adelaide-instagram-main");

    db.prepare("INSERT INTO operational_accounts (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority) VALUES ('adelaide-reddit-alt','adelaide','reddit','Alt Reddit','u/AltAdelaide','not_connected','scheduled_api','not_configured')").run();
    db.prepare("INSERT INTO provider_connections (creator_id,service,account_id,connected_account_id,composio_user_id,status) VALUES ('adelaide','reddit','adelaide-reddit-alt','alt-connection','creator-os:adelaide:alt:reddit','pending')").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM provider_connections WHERE creator_id='adelaide' AND service='reddit'").get().count, 2);
    assert.throws(() => db.prepare("INSERT INTO provider_connections (creator_id,service,account_id,connected_account_id,composio_user_id,status) VALUES ('adelaide','reddit','adelaide-instagram-main','bad','bad','pending')").run(), /provider_connection_account_scope_invalid/);

    db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('second','Second','second','S')").run();
    db.prepare("INSERT INTO operational_accounts (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority) VALUES ('second-reddit','second','reddit','Second Reddit','u/Second','not_connected','scheduled_api','not_configured')").run();
    assert.throws(() => db.prepare("INSERT INTO provider_connections (creator_id,service,account_id,connected_account_id,composio_user_id,status) VALUES ('adelaide','reddit','second-reddit','cross','cross','pending')").run(), /FOREIGN KEY constraint failed|provider_connection_account_scope_invalid/);
    db.prepare("INSERT INTO provider_connection_attempts (id,creator_id,service,account_id,state_hash,status,expires_at) VALUES ('attempt-alt','adelaide','reddit','adelaide-reddit-alt','hash-alt','pending','2099-01-01')").run();
    assert.throws(() => db.prepare("INSERT INTO provider_connection_attempts (id,creator_id,service,account_id,state_hash,status,expires_at) VALUES ('attempt-cross','adelaide','reddit','second-reddit','hash-cross','pending','2099-01-01')").run(), /FOREIGN KEY constraint failed|provider_connection_attempt_account_scope_invalid/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM social_posts").get().count, postCount);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
