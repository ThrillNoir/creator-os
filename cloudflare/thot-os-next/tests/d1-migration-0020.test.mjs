import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const appRoot = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.resolve(appRoot, "../thot-os-app/migrations");
const wrangler = path.resolve(appRoot, "node_modules/.bin/wrangler");
const migrationNames = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const auditTables = [
  "asset_classification_events",
  "social_post_events",
  "reddit_community_events",
  "vault_upload_events",
  "messaging_audit_events",
  "identity_audit_events",
];
const validRoles = ["agency_admin", "operator", "creator", "viewer", "service"];

async function createWorkspace(count) {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0020-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  await mkdir(migrations);
  for (const name of migrationNames.slice(0, count)) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
    name: "thot-os-0020-local-repro",
    compatibility_date: "2026-08-08",
    d1_databases: [{
      binding: "DB",
      database_name: "thot-os-0020-local-repro",
      database_id: "174532e8-5ada-4e30-abba-1276b3540b3f",
      migrations_dir: "./migrations",
    }],
  }));
  return { root, migrations, state };
}

function wranglerRun(workspace, args) {
  return spawnSync(wrangler, args, {
    cwd: workspace.root,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
}

function applyMigrations(workspace) {
  return wranglerRun(workspace, ["d1", "migrations", "apply", "thot-os-0020-local-repro", "--local", "--persist-to", workspace.state]);
}

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

function assertSucceeded(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function seedContractDependencies(db) {
  db.prepare(`INSERT OR IGNORE INTO assets
    (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,source_available,indexed_at)
    VALUES ('phase1f-asset','adelaide','STILLS/phase1f.jpg','phase1f.jpg','jpg',1000,'2026-08-10T00:00:00.000Z','descriptive',1,'2026-08-10T00:00:00.000Z')`).run();
  db.prepare("INSERT OR IGNORE INTO social_posts (id,creator_id,platform,title,caption,status) VALUES ('phase1f-post','adelaide','reddit','Phase 1F','Contract fixture','draft')").run();
  db.prepare(`INSERT OR IGNORE INTO reddit_communities
    (creator_id,name,rules_url,last_verified_at) VALUES ('adelaide','phase1f-contract','https://www.reddit.com/r/phase1f/about/rules','2026-08-10T00:00:00.000Z')`).run();
  const communityId = db.prepare("SELECT id FROM reddit_communities WHERE creator_id='adelaide' AND name='phase1f-contract'").get().id;
  db.prepare(`INSERT OR IGNORE INTO vault_upload_jobs
    (id,creator_id,account_id,asset_id,platform,status,approved_by)
    VALUES ('phase1f-vault-job','adelaide','adelaide-fansly-main','phase1f-asset','fansly','approved','connect@thrillnoir.com')`).run();
  return communityId;
}

function adelaideIdentifiers(db) {
  const ids = (table) => db.prepare(`SELECT id FROM ${table} WHERE creator_id='adelaide' ORDER BY id`).all().map(({ id }) => id);
  return {
    creator: db.prepare("SELECT id,name,slug,initials,status FROM creators WHERE id='adelaide'").get(),
    assets: ids("assets"),
    accounts: ids("operational_accounts"),
    posts: ids("social_posts"),
    threads: ids("message_threads"),
  };
}

function insertOperationalAudit(db, table, id, role, communityId) {
  if (table === "asset_classification_events") return db.prepare(`INSERT INTO asset_classification_events
    (id,asset_id,creator_id,actor,actor_role,event_type,snapshot) VALUES (?,'phase1f-asset','adelaide','phase1f-actor',?,'phase1f','{}')`).run(id, role);
  if (table === "social_post_events") return db.prepare(`INSERT INTO social_post_events
    (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,'phase1f-post','adelaide','phase1f-actor',?,'phase1f','{}')`).run(id, role);
  if (table === "reddit_community_events") return db.prepare(`INSERT INTO reddit_community_events
    (id,community_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,'adelaide','phase1f-actor',?,'phase1f','{}')`).run(id, communityId, role);
  if (table === "vault_upload_events") return db.prepare(`INSERT INTO vault_upload_events
    (id,job_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,'phase1f-vault-job','adelaide','phase1f-actor',?,'phase1f','{}')`).run(id, role);
  if (table === "messaging_audit_events") return db.prepare(`INSERT INTO messaging_audit_events
    (id,creator_id,event_type,actor,actor_role,detail) VALUES (?,'adelaide','phase1f','phase1f-actor',?,'{}')`).run(id, role);
  throw new Error(`Unsupported operational audit table ${table}`);
}

function insertRolelessRollbackAudit(db, table, id, communityId) {
  if (table === "asset_classification_events") return db.prepare(`INSERT INTO asset_classification_events
    (id,asset_id,creator_id,actor,event_type,snapshot) VALUES (?,'phase1f-asset','adelaide','rollback','phase1f','{}')`).run(id);
  if (table === "social_post_events") return db.prepare(`INSERT INTO social_post_events
    (id,post_id,creator_id,actor,event_type,detail) VALUES (?,'phase1f-post','adelaide','rollback','phase1f','{}')`).run(id);
  if (table === "reddit_community_events") return db.prepare(`INSERT INTO reddit_community_events
    (id,community_id,creator_id,actor,event_type,detail) VALUES (?,?,'adelaide','rollback','phase1f','{}')`).run(id, communityId);
  if (table === "vault_upload_events") return db.prepare(`INSERT INTO vault_upload_events
    (id,job_id,creator_id,actor,event_type,detail) VALUES (?,'phase1f-vault-job','adelaide','rollback','phase1f','{}')`).run(id);
  if (table === "messaging_audit_events") return db.prepare(`INSERT INTO messaging_audit_events
    (id,creator_id,event_type,actor,detail) VALUES (?,'adelaide','phase1f','rollback','{}')`).run(id);
  if (table === "identity_audit_events") return db.prepare(`INSERT INTO identity_audit_events
    (id,creator_id,actor_email,event_type,subject,detail) VALUES (?,'adelaide','connect@thrillnoir.com','phase1f','subject','{}')`).run(id);
  throw new Error(`Unsupported audit table ${table}`);
}

test("fresh Wrangler replay applies the 0020 audit-role contract", async () => {
  assert.equal(migrationNames[19], "0020_actor_role_contract.sql");
  const workspace = await createWorkspace(20);
  try {
    assertSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 20);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE '%_actor_role_contract_%'").get().count, 12);
      for (const table of auditTables) {
        assert.deepEqual(
          db.prepare(`SELECT type,"notnull" AS is_not_null,dflt_value FROM pragma_table_info('${table}') WHERE name='actor_role'`).get(),
          { type: "TEXT", is_not_null: 1, dflt_value: "'legacy'" },
        );
      }
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("0019 upgrade preserves historical legacy rows and contracts every new writer", async () => {
  const workspace = await createWorkspace(19);
  try {
    assertSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    let db = new Database(databasePath);
    const communityId = seedContractDependencies(db);
    for (const table of auditTables) insertRolelessRollbackAudit(db, table, `historical-${table}`, communityId);
    const before = adelaideIdentifiers(db);
    db.close();

    await copyFile(path.join(migrationsRoot, migrationNames[19]), path.join(workspace.migrations, migrationNames[19]));
    assertSucceeded(applyMigrations(workspace));
    db = new Database(databasePath);
    try {
      assert.deepEqual(adelaideIdentifiers(db), before);
      for (const table of auditTables) {
        const id = `historical-${table}`;
        assert.equal(db.prepare(`SELECT actor_role FROM ${table} WHERE id=?`).get(id).actor_role, "legacy");
        assert.throws(() => db.prepare(`UPDATE ${table} SET actor_role=actor_role WHERE id=?`).run(id), /audit_actor_role_contract/);
        const beforeRoleless = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
        assert.throws(() => insertRolelessRollbackAudit(db, table, `roleless-${table}`, communityId), /audit_actor_role_contract/);
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, beforeRoleless);
      }

      for (const table of auditTables.slice(0, -1)) {
        for (const role of validRoles) insertOperationalAudit(db, table, `valid-${table}-${role}`, role, communityId);
        for (const role of ["", "legacy", "unknown"]) {
          assert.throws(() => insertOperationalAudit(db, table, `invalid-${table}-${role || "empty"}`, role, communityId), /audit_actor_role_contract|CHECK constraint failed/);
        }
      }

      for (const role of ["operator", "creator", "viewer"]) {
        const email = `phase1f-${role}@example.test`;
        db.prepare("INSERT INTO users (email,display_name) VALUES (?,?)").run(email, `Phase 1F ${role}`);
        db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('adelaide',?,?)").run(email, role);
      }
      db.prepare("INSERT INTO service_credentials (id,service_name,token_hash,status) VALUES ('phase1f-service','phase1f-runner','phase1f-hash','active')").run();
      db.prepare("INSERT INTO service_creator_grants (service_credential_id,creator_id,status) VALUES ('phase1f-service','adelaide','active')").run();
      const identityActors = {
        agency_admin: "connect@thrillnoir.com",
        operator: "phase1f-operator@example.test",
        creator: "phase1f-creator@example.test",
        viewer: "phase1f-viewer@example.test",
        service: "service:phase1f-runner",
      };
      for (const role of validRoles) db.prepare(`INSERT INTO identity_audit_events
        (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,'adelaide',?,?,'phase1f','subject','{}')`).run(`valid-identity-${role}`, identityActors[role], role);
      for (const role of ["", "legacy", "unknown"]) assert.throws(() => db.prepare(`INSERT INTO identity_audit_events
        (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,'adelaide','connect@thrillnoir.com',?,'phase1f','subject','{}')`).run(`invalid-identity-${role || "empty"}`, role), /audit_actor_role_contract|CHECK constraint failed/);

      db.prepare("INSERT INTO creators (id,name,slug,initials,status) VALUES ('phase1f-fixture','Phase 1F Fixture','phase1f-fixture','PF','active')").run();
      db.prepare("INSERT INTO users (email,display_name) VALUES ('phase1f-cross@example.test','Phase 1F Cross')").run();
      db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('phase1f-fixture','phase1f-cross@example.test','creator')").run();
      const beforeCross = db.prepare("SELECT COUNT(*) AS count FROM identity_audit_events").get().count;
      assert.throws(() => db.prepare(`INSERT INTO identity_audit_events
        (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES ('phase1f-cross','adelaide','phase1f-cross@example.test','creator','phase1f','subject','{}')`).run(), /audit_human_actor_scope_invalid/);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM identity_audit_events").get().count, beforeCross);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations WHERE name='0020_actor_role_contract.sql'").get().count, 1);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("failed 0020 migration rolls back every contract trigger and migration record", async () => {
  const workspace = await createWorkspace(19);
  try {
    assertSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    const migration = await readFile(path.join(migrationsRoot, migrationNames[19]), "utf8");
    await writeFile(path.join(workspace.migrations, migrationNames[19]), `${migration}\nCREATE TRIGGER incomplete_0020 BEFORE INSERT ON identity_audit_events BEGIN SELECT 1;\n`);
    const failed = applyMigrations(workspace);
    assert.notEqual(failed.status, 0);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /incomplete input/);
    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 19);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE '%_actor_role_contract_%'").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creators WHERE id='adelaide'").get().count, 1);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});
