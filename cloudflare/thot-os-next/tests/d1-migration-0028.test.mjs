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
const checksum = "a".repeat(64);

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0028-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  await mkdir(migrations);
  for (const name of migrationNames) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
    name: "thot-os-0028-local-repro",
    compatibility_date: "2026-08-08",
    d1_databases: [{ binding: "DB", database_name: "thot-os-0028-local-repro", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
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

test("expand migrations retain legacy service audit while adding canonical principals and activation records", async () => {
  assert.ok(migrationNames.includes("0028_migration_ledger.sql"));
  const local = await workspace();
  try {
    const replay = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-0028-local-repro", "--local", "--persist-to", local.state], {
      cwd: local.root,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
    });
    assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    const file = await databasePath(local.state);
    assert.ok(file);
    const db = new Database(file);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, migrationNames.length);
      const beforeAssets = db.prepare("SELECT COUNT(*) AS count FROM assets").get().count;
      const beforePosts = db.prepare("SELECT COUNT(*) AS count FROM social_posts").get().count;
      db.prepare(`INSERT INTO migration_ledger_runs
        (id,creator_id,environment,source_snapshot_label,source_snapshot_sha256,target_database_id,target_snapshot_sha256,target_migration_state_sha256,manifest_sha256,tool_git_sha,approval_ref,operator_identity)
        VALUES ('run-adelaide','adelaide','staging','protected.sqlite',?,?,?,?,?,?,?,?)`)
        .run(checksum, "174532e8-5ada-4e30-abba-1276b3540b3f", checksum, checksum, checksum, "fixture-git-sha", "approved-manifest-fixture", "fixture-operator");
      db.prepare(`INSERT INTO migration_ledger_records
        (id,run_id,creator_id,domain,source_table,source_record_ref,source_record_checksum,operation,result)
        VALUES ('record-adelaide','run-adelaide','adelaide','assets','assets','source-ref',?,'INSERT','PLANNED')`).run(checksum);
      db.prepare(`INSERT INTO migration_ledger_events
        (id,run_id,record_id,creator_id,event_type,actor_identity)
        VALUES ('event-adelaide','run-adelaide','record-adelaide','adelaide','RECORD_PLANNED','fixture-operator')`).run();
      assert.throws(() => db.prepare(`INSERT INTO migration_ledger_records
        (id,run_id,creator_id,domain,source_table,source_record_ref,source_record_checksum,operation,result)
        VALUES ('record-wrong-creator','run-adelaide','bryshanagy','assets','assets','foreign-ref',?,'INSERT','PLANNED')`).run(checksum), /migration_ledger_creator_scope/);
      assert.throws(() => db.prepare("UPDATE migration_ledger_runs SET approval_ref='changed' WHERE id='run-adelaide'").run(), /migration_ledger_append_only/);
      assert.throws(() => db.prepare("DELETE FROM migration_ledger_records WHERE id='record-adelaide'").run(), /migration_ledger_append_only/);
      assert.throws(() => db.prepare("UPDATE migration_ledger_events SET actor_identity='changed' WHERE id='event-adelaide'").run(), /migration_ledger_append_only/);
      db.prepare("INSERT INTO service_principals (id,principal_name) VALUES ('web-reddit','thot-os-web-reddit')").run();
      db.prepare("INSERT INTO service_principal_credentials (id,service_principal_id,token_hash) VALUES ('web-reddit-current','web-reddit',?)").run("b".repeat(64));
      db.prepare("INSERT INTO service_principal_credentials (id,service_principal_id,token_hash) VALUES ('web-reddit-next','web-reddit',?)").run("c".repeat(64));
      db.prepare("INSERT INTO service_principal_creator_grants (service_principal_id,creator_id,capability) VALUES ('web-reddit','adelaide','reddit.status.read')").run();
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_principal_credentials WHERE service_principal_id='web-reddit' AND status='active'").get().count, 2);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_principal_creator_grants WHERE creator_id='adelaide' AND capability='reddit.status.read'").get().count, 1);
      db.prepare("INSERT INTO service_credentials (id,service_name,token_hash) VALUES ('legacy-reddit','legacy-reddit',?)").run("d".repeat(64));
      db.prepare("INSERT INTO service_creator_grants (service_credential_id,creator_id) VALUES ('legacy-reddit','adelaide')").run();
      db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('legacy-request','adelaide','service:legacy-reddit','service','legacy_request','/status','{}')").run();
      db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('principal-request','adelaide','service:thot-os-web-reddit','service','internal_service_request_authorized','/status','{}')").run();
      assert.throws(() => db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('principal-foreign','bryshanagy','service:thot-os-web-reddit','service','internal_service_request_authorized','/status','{}')").run(), /audit_service_actor_scope_invalid/);
      db.prepare("INSERT INTO service_principal_audit_events (id,service_principal_id,credential_id,creator_id,event_type,actor_identity) VALUES ('principal-event','web-reddit','web-reddit-current','adelaide','credential_created','fixture-operator')").run();
      assert.throws(() => db.prepare("UPDATE service_principal_audit_events SET event_type='changed' WHERE id='principal-event'").run(), /service_principal_audit_events_append_only/);
      db.prepare(`INSERT INTO service_auth_activation_runs
        (id,environment,plan_sha256,registry_sha256,backup_receipt_sha256,target_database_id,target_migration_state_sha256,git_sha,git_branch,operator_identity)
        VALUES ('activation-fixture','staging',?,?,?,?,?,?,?,?)`).run(checksum, checksum, checksum, "174532e8-5ada-4e30-abba-1276b3540b3f", checksum, "fixture-git", "fixture-branch", "fixture-operator");
      db.prepare("INSERT INTO service_auth_activation_steps (id,activation_id,step) VALUES ('activation-planned','activation-fixture','PLANNED')").run();
      db.prepare("INSERT INTO service_auth_telemetry (id,creator_id,principal_name,auth_path,capability,route,outcome) VALUES ('canonical-telemetry','adelaide','thot-os-web-reddit','canonical','reddit.status.read','/status','allowed')").run();
      assert.throws(() => db.prepare("UPDATE service_auth_activation_runs SET git_sha='changed' WHERE id='activation-fixture'").run(), /service_auth_activation_runs_append_only/);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM assets").get().count, beforeAssets);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM social_posts").get().count, beforePosts);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(local.root, { recursive: true, force: true });
  }
});
