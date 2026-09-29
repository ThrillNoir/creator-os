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

test("0057 keeps legacy sync state and scopes new Instagram analytics by account", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0057-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  let db;
  try {
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
      await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    }
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
      name: "thot-os-0057-local",
      compatibility_date: "2026-08-31",
      d1_databases: [{ binding: "DB", database_name: "thot-os-0057-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
    }));
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-0057-local", "--local", "--persist-to", state], {
      cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    const databasePath = await findDatabase(state);
    assert.ok(databasePath);
    db = new Database(databasePath);

    const legacy = db.prepare("SELECT creator_id,connection_id,last_analytics_sync_at FROM instagram_sync_state WHERE creator_id='adelaide'").get();
    assert.equal(legacy.creator_id, "adelaide");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM instagram_account_sync_state WHERE creator_id='adelaide'").get().count, 1);

    db.prepare("INSERT INTO operational_accounts (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority) VALUES ('adelaide-instagram-alt','adelaide','instagram','Alt Instagram','@alt','connected','scheduled_api','confirmed')").run();
    db.prepare("INSERT INTO instagram_account_sync_state (creator_id,account_id,last_analytics_sync_at) VALUES ('adelaide','adelaide-instagram-alt','2026-09-02T00:00:00Z')").run();
    assert.deepEqual(db.prepare("SELECT account_id FROM instagram_account_sync_state WHERE creator_id='adelaide' ORDER BY account_id").all().map((row) => row.account_id), ["adelaide-instagram-alt", "adelaide-instagram-main"]);

    db.prepare("INSERT INTO instagram_analytics_collection_runs (id,creator_id,account_id,trigger_type,status) VALUES ('run-main','adelaide','adelaide-instagram-main','cron','running')").run();
    db.prepare("INSERT INTO instagram_analytics_collection_runs (id,creator_id,account_id,trigger_type,status) VALUES ('run-alt','adelaide','adelaide-instagram-alt','cron','running')").run();
    assert.throws(() => db.prepare("INSERT INTO instagram_analytics_collection_runs (id,creator_id,account_id,trigger_type,status) VALUES ('run-alt-duplicate','adelaide','adelaide-instagram-alt','manual','running')").run(), /UNIQUE constraint failed/);
    db.prepare("INSERT INTO instagram_analytics_collection_runs (id,creator_id,account_id,trigger_type,status) VALUES ('run-legacy','adelaide',NULL,'cron','running')").run();
    assert.throws(() => db.prepare("INSERT INTO instagram_analytics_collection_runs (id,creator_id,account_id,trigger_type,status) VALUES ('run-legacy-duplicate','adelaide',NULL,'cron','running')").run(), /UNIQUE constraint failed/);

    db.prepare("INSERT INTO instagram_media_metric_observations (id,creator_id,account_id,media_id,collected_at) VALUES ('obs-main','adelaide','adelaide-instagram-main','same-media','2026-09-02T00:00:00Z')").run();
    db.prepare("INSERT INTO instagram_media_metric_observations (id,creator_id,account_id,media_id,collected_at) VALUES ('obs-alt','adelaide','adelaide-instagram-alt','same-media','2026-09-02T00:01:00Z')").run();
    assert.deepEqual(db.prepare("SELECT account_id,media_id FROM instagram_media_metric_observations WHERE creator_id=? GROUP BY account_id,media_id").all("adelaide"), [
      { account_id: "adelaide-instagram-alt", media_id: "same-media" },
      { account_id: "adelaide-instagram-main", media_id: "same-media" },
    ]);

    db.prepare("INSERT INTO messaging_connections (id,creator_id,account_id,platform,display_name,status) VALUES ('msg-main','adelaide','adelaide-instagram-main','instagram','Main inbox','connected')").run();
    db.prepare("INSERT INTO messaging_connections (id,creator_id,account_id,platform,display_name,status) VALUES ('msg-alt','adelaide','adelaide-instagram-alt','instagram','Alt inbox','connected')").run();
    db.prepare("INSERT INTO message_threads (id,creator_id,connection_id,external_thread_id) VALUES ('thread-main','adelaide','msg-main','main-thread')").run();
    const selectedThread = db.prepare("SELECT c.account_id FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id WHERE t.id=? AND t.creator_id=? AND c.platform='instagram'").get("thread-main", "adelaide");
    assert.equal(selectedThread.account_id, "adelaide-instagram-main");
    assert.notEqual(selectedThread.account_id, "adelaide-instagram-alt", "a posted account selector cannot retarget another thread's connection");
    assert.deepEqual(db.prepare("SELECT t.id FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id WHERE t.creator_id=? AND c.platform='instagram' AND c.account_id=?").all("adelaide", "adelaide-instagram-alt"), [], "account browsing stays empty when the selected account has no threads");

    db.prepare("INSERT INTO instagram_media_metrics (creator_id,account_id,media_id,like_count) VALUES ('adelaide','adelaide-instagram-main','same-media',1)").run();
    db.prepare("INSERT INTO instagram_media_metrics (creator_id,account_id,media_id,like_count) VALUES ('adelaide','adelaide-instagram-alt','same-media',2) ON CONFLICT(creator_id,media_id) DO UPDATE SET account_id=excluded.account_id,like_count=excluded.like_count WHERE instagram_media_metrics.account_id IS NULL OR instagram_media_metrics.account_id=excluded.account_id").run();
    assert.deepEqual(db.prepare("SELECT account_id,like_count FROM instagram_media_metrics WHERE creator_id='adelaide' AND media_id='same-media'").get(), { account_id: "adelaide-instagram-main", like_count: 1 });

    db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('other','Other','other','O')").run();
    db.prepare("INSERT INTO operational_accounts (id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority) VALUES ('other-instagram','other','instagram','Other Instagram','@other','connected','scheduled_api','confirmed')").run();
    db.prepare("INSERT INTO provider_connections (creator_id,service,account_id,connected_account_id,composio_user_id,status,external_account_id) VALUES ('other','instagram','other-instagram','other-connected','creator-os:other:service:instagram','active','other-external')").run();
    const runCountBeforeWrongScope = db.prepare("SELECT COUNT(*) AS count FROM instagram_analytics_collection_runs WHERE creator_id='adelaide'").get().count;
    const wrongCreatorConnection = db.prepare("SELECT pc.account_id FROM provider_connections pc JOIN operational_accounts oa ON oa.id=pc.account_id AND oa.creator_id=pc.creator_id AND oa.platform='instagram' AND oa.is_active=1 WHERE pc.creator_id=? AND pc.service='instagram' AND oa.id=?").get("adelaide", "other-instagram");
    assert.equal(wrongCreatorConnection, undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM instagram_analytics_collection_runs WHERE creator_id='adelaide'").get().count, runCountBeforeWrongScope);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM instagram_account_sync_state WHERE creator_id='adelaide'").get().count, 2);

    const observationColumns = new Set(db.pragma("table_info(instagram_media_metric_observations)").map((column) => column.name));
    const metricColumns = new Set(db.pragma("table_info(instagram_media_metrics)").map((column) => column.name));
    assert.ok(observationColumns.has("account_id"));
    assert.ok(metricColumns.has("account_id"));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM instagram_analytics_snapshots WHERE creator_id='adelaide'").get().count, 0);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
