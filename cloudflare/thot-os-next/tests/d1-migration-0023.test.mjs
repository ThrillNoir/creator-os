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
const migrationNames = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0023-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  await mkdir(migrations);
  for (const name of migrationNames) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
    name: "thot-os-0023-local-repro",
    compatibility_date: "2026-08-08",
    d1_databases: [{ binding: "DB", database_name: "thot-os-0023-local-repro", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
  }));
  return { root, state };
}

async function databasePath(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await databasePath(candidate);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") return candidate;
  }
  return null;
}

test("fresh migrations retain device invariants and enable Composio Reddit API delivery", async () => {
  assert.ok(migrationNames.includes("0028_migration_ledger.sql"));
  const local = await workspace();
  try {
    const result = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-0023-local-repro", "--local", "--persist-to", local.state], {
      cwd: local.root,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const file = await databasePath(local.state);
    assert.ok(file);
    const db = new Database(file);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, migrationNames.length);
      assert.ok(db.prepare("SELECT dropbox_link FROM creators WHERE id='adelaide'").get());
      assert.equal(db.prepare("SELECT connection_status FROM operational_accounts WHERE id='adelaide-reddit-main'").get().connection_status, "needs_reconnection");
      assert.equal(db.prepare("SELECT publishing_mode FROM operational_accounts WHERE id='adelaide-reddit-main'").get().publishing_mode, "scheduled_api");
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM bridge_credentials WHERE platform='reddit' AND status='active'").get().count, 0);
      const socialPostColumns = new Set(db.pragma("table_info(social_posts)").map((column) => column.name));
      assert.equal(socialPostColumns.has("reddit_flair_id"), true);
      assert.equal(socialPostColumns.has("reddit_flair_text"), true);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reddit_community_flairs").get().count, 0);
      assert.ok(db.prepare("SELECT 1 FROM asset_preview_jobs LIMIT 1").get() === undefined);
      assert.throws(() => db.prepare(`INSERT INTO operational_accounts
        (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority)
        VALUES ('duplicate-adelaide-fansly','adelaide','fansly','Duplicate Fansly','@duplicate','not_connected','local_bridge','device_only')`).run(), /UNIQUE constraint failed/);
      db.prepare(`INSERT INTO finance_imports
        (id,creator_id,platform,source_name,content_hash,row_count,imported_by)
        VALUES ('finance-fixture','adelaide','fansly','fixture.csv',?,1,'tester@example.com')`).run("a".repeat(64));
      db.prepare(`INSERT INTO finance_daily_metrics
        (creator_id,platform,period_date,currency,net_revenue_minor,import_id)
        VALUES ('adelaide','fansly','2026-08-14','AUD',12345,'finance-fixture')`).run();
      assert.equal(db.prepare("SELECT net_revenue_minor FROM finance_daily_metrics WHERE creator_id='adelaide'").get().net_revenue_minor, 12345);
      assert.throws(() => db.prepare(`INSERT INTO finance_daily_metrics
        (creator_id,platform,period_date,currency,net_revenue_minor,import_id)
        VALUES ('adelaide','fansly','2026-08-14','AUD',99999,'finance-fixture')`).run(), /UNIQUE constraint failed/);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(local.root, { recursive: true, force: true });
  }
});
