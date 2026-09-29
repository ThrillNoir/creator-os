import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const normalise = (sql) => `${sql.replaceAll("\r\n", "\n").trim()}\n`;
const digest = (sql) => createHash("sha256").update(normalise(sql)).digest("hex");

async function replay(through) {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-expand-boundary-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  await mkdir(migrations);
  for (const name of migrationNames.filter((name) => name <= through)) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({ name: "thot-os-expand-boundary", compatibility_date: "2026-08-08", d1_databases: [{ binding: "DB", database_name: "thot-os-expand-boundary", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }] }));
  const result = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-expand-boundary", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const find = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, item.name);
      if (item.isDirectory()) { const nested = await find(candidate); if (nested) return nested; }
      else if (item.name.endsWith(".sqlite") && item.name !== "metadata.sqlite") return candidate;
    }
    return null;
  };
  const file = await find(state);
  assert.ok(file);
  return { root, db: new Database(file) };
}

test("EXPAND through 0031 leaves the legacy service-audit trigger byte-identical and dormant", async () => {
  const before = await replay("0027_reddit_post_flairs.sql");
  const expanded = await replay("0031_service_auth_activation_support.sql");
  try {
    const beforeTrigger = before.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='identity_audit_service_scope'").get().sql;
    const expandedTrigger = expanded.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='identity_audit_service_scope'").get().sql;
    assert.equal(normalise(expandedTrigger), normalise(beforeTrigger));
    assert.equal(digest(expandedTrigger), digest(beforeTrigger));
    for (const table of ["service_principals", "service_principal_credentials", "service_principal_creator_grants", "service_auth_activation_runs", "service_auth_activation_steps", "service_auth_telemetry"]) assert.ok(expanded.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    assert.equal(expanded.db.prepare("SELECT COUNT(*) AS count FROM service_principals").get().count, 0);
    assert.equal(expanded.db.prepare("SELECT COUNT(*) AS count FROM service_principal_credentials").get().count, 0);
    assert.equal(expanded.db.prepare("SELECT COUNT(*) AS count FROM service_principal_creator_grants").get().count, 0);
    for (const table of ["creators", "assets", "messages"]) assert.equal(expanded.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, before.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    expanded.db.prepare("INSERT INTO service_credentials (id,service_name,token_hash) VALUES ('legacy-fixture','legacy-fixture',?)").run("a".repeat(64));
    expanded.db.prepare("INSERT INTO service_creator_grants (service_credential_id,creator_id) VALUES ('legacy-fixture','adelaide')").run();
    expanded.db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('legacy-ok','adelaide','service:legacy-fixture','service','fixture','/fixture','{}')").run();
    assert.throws(() => expanded.db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('legacy-foreign','bryshanagy','service:legacy-fixture','service','fixture','/fixture','{}')").run(), /audit_service_actor_scope_invalid/);
    expanded.db.prepare("UPDATE service_credentials SET status='revoked' WHERE id='legacy-fixture'").run();
    assert.throws(() => expanded.db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('legacy-revoked','adelaide','service:legacy-fixture','service','fixture','/fixture','{}')").run(), /audit_service_actor_scope_invalid/);
    assert.throws(() => expanded.db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('canonical-dormant','adelaide','service:canonical','service','fixture','/fixture','{}')").run(), /audit_service_actor_scope_invalid/);
    assert.equal(expanded.db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    before.db.close(); expanded.db.close();
    await rm(before.root, { recursive: true, force: true }); await rm(expanded.root, { recursive: true, force: true });
  }
});
