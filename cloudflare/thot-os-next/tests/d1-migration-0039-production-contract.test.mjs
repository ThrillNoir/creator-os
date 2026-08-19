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
const checksum = "a".repeat(64);

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

async function runMigrations(root, state) {
  const result = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-contract-local", "--local", "--persist-to", state], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test("0039 preserves staging audit rows and permits a separately recorded production audit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-production-contract-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  let db;
  try {
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0039_").sort()) {
      await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    }
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
      name: "thot-os-contract-local",
      compatibility_date: "2026-08-19",
      d1_databases: [{ binding: "DB", database_name: "thot-os-contract-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
    }));
    await runMigrations(root, state);
    const databasePath = await findDatabase(state);
    assert.ok(databasePath);
    db = new Database(databasePath);

    db.prepare(`INSERT INTO migration_ledger_runs
      (id,creator_id,environment,source_snapshot_label,source_snapshot_sha256,target_database_id,target_snapshot_sha256,target_migration_state_sha256,manifest_sha256,tool_git_sha,approval_ref,operator_identity)
      VALUES ('staging-ledger','adelaide','staging','fixture',?,?,?,?,?,?,?,?)`).run(checksum, "staging-db", checksum, checksum, checksum, "fixture-sha", "fixture-approval", "operator@example.com");
    db.prepare(`INSERT INTO migration_ledger_records
      (id,run_id,creator_id,domain,source_table,source_record_ref,source_record_checksum,operation,result)
      VALUES ('staging-record','staging-ledger','adelaide','fixture','source','source-1',?,'VERIFY','VERIFIED')`).run(checksum);
    db.prepare(`INSERT INTO migration_ledger_events
      (id,run_id,record_id,creator_id,event_type,actor_identity)
      VALUES ('staging-event','staging-ledger','staging-record','adelaide','VERIFICATION_PASSED','operator@example.com')`).run();
    db.prepare(`INSERT INTO service_auth_activation_runs
      (id,environment,plan_sha256,registry_sha256,backup_receipt_sha256,target_database_id,target_migration_state_sha256,git_sha,git_branch,operator_identity)
      VALUES ('staging-activation','staging',?,?,?,'staging-db',?,'fixture-sha','fixture','operator@example.com')`).run(checksum, checksum, checksum, checksum);
    db.prepare("INSERT INTO service_auth_activation_steps (id,activation_id,step) VALUES ('staging-step','staging-activation','VERIFIED')").run();
    db.close();
    db = undefined;

    await copyFile(path.join(migrationsRoot, "0039_production_environment_audit_contract.sql"), path.join(migrations, "0039_production_environment_audit_contract.sql"));
    await runMigrations(root, state);
    db = new Database(databasePath);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM migration_ledger_events WHERE id='staging-event'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_auth_activation_steps WHERE id='staging-step'").get().count, 1);
    db.prepare(`INSERT INTO migration_ledger_runs
      (id,creator_id,environment,source_snapshot_label,source_snapshot_sha256,target_database_id,target_snapshot_sha256,target_migration_state_sha256,manifest_sha256,tool_git_sha,approval_ref,operator_identity)
      VALUES ('production-ledger','adelaide','production','fixture',?,?,?,?,?,?,?,?)`).run("b".repeat(64), "production-db", checksum, checksum, checksum, "fixture-sha", "production-approval", "operator@example.com");
    db.prepare(`INSERT INTO service_auth_activation_runs
      (id,environment,plan_sha256,registry_sha256,backup_receipt_sha256,target_database_id,target_migration_state_sha256,git_sha,git_branch,operator_identity)
      VALUES ('production-activation','production',?,?,?,'production-db',?,'fixture-sha','fixture','operator@example.com')`).run("b".repeat(64), checksum, checksum, checksum);
    assert.throws(() => db.prepare("UPDATE migration_ledger_runs SET approval_ref='changed' WHERE id='staging-ledger'").run(), /migration_ledger_append_only/);
    assert.throws(() => db.prepare("UPDATE service_auth_activation_runs SET git_branch='changed' WHERE id='staging-activation'").run(), /service_auth_activation_runs_append_only/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
