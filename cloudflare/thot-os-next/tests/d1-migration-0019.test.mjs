import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const appRoot = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.resolve(appRoot, "../thot-os-app/migrations");
const fixturePath = path.resolve(appRoot, "../thot-os-app/fixtures/staging/phase1d-g-synthetic-creator.sql");
const wrangler = path.resolve(appRoot, "node_modules/.bin/wrangler");
const migrationNames = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();

async function createWorkspace(count) {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0019-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  await mkdir(migrations);
  for (const name of migrationNames.slice(0, count)) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
    name: "thot-os-0019-local-repro",
    compatibility_date: "2026-08-08",
    d1_databases: [{
      binding: "DB",
      database_name: "thot-os-0019-local-repro",
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
  return wranglerRun(workspace, ["d1", "migrations", "apply", "thot-os-0019-local-repro", "--local", "--persist-to", workspace.state]);
}

function applyFixture(workspace) {
  return wranglerRun(workspace, ["d1", "execute", "thot-os-0019-local-repro", "--local", "--persist-to", workspace.state, "--file", fixturePath]);
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

function seedRealisticAdelaide(db) {
  const insertAsset = db.prepare(`INSERT INTO assets
    (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,source_available,indexed_at)
    VALUES (?,?,?,?,?,?,?,?,1,?)`);
  const insertPost = db.prepare("INSERT INTO social_posts (id,creator_id,platform,account_id,title,caption,status) VALUES (?,?,?,?,?,?,?)");
  const insertThread = db.prepare(`INSERT INTO message_threads
    (id,creator_id,connection_id,external_thread_id,participant_name,participant_handle,status)
    VALUES (?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (let index = 0; index < 195; index += 1) {
      const suffix = String(index).padStart(3, "0");
      insertAsset.run(`adelaide-asset-${suffix}`, "adelaide", `STILLS/adelaide-${suffix}.jpg`, `adelaide-${suffix}.jpg`, "jpg", 1000 + index, "2026-08-09T00:00:00.000Z", "descriptive", "2026-08-09T00:00:00.000Z");
    }
    for (let index = 0; index < 6; index += 1) insertPost.run(`adelaide-post-${index}`, "adelaide", "reddit", "adelaide-reddit-main", `Post ${index}`, "Migration fixture", "draft");
    for (let index = 0; index < 45; index += 1) insertThread.run(`adelaide-thread-${index}`, "adelaide", "adelaide-messages-fansly", `fansly-thread-${index}`, `Participant ${index}`, `participant-${index}`, "open");
  })();
}

function adelaideSnapshot(db) {
  const ids = (table) => db.prepare(`SELECT id FROM ${table} WHERE creator_id='adelaide' ORDER BY id`).all().map(({ id }) => id);
  return {
    creator: db.prepare("SELECT id,name,slug,initials,status FROM creators WHERE id='adelaide'").get(),
    assets: ids("assets"), accounts: ids("operational_accounts"), posts: ids("social_posts"), threads: ids("message_threads"),
  };
}

function insertAudit(db, { id, creator = "adelaide", actor, role, action = "qa_action" }) {
  db.prepare(`INSERT INTO identity_audit_events
    (id,creator_id,actor_email,actor_role,event_type,subject,detail)
    VALUES (?,?,?,?,?,'qa-subject','{}')`).run(id, creator, actor, role, action);
}

test("fresh Wrangler replay applies migrations 0001 through 0019", async () => {
  assert.equal(migrationNames.at(-1), "0019_actor_role_audit.sql");
  const workspace = await createWorkspace(19);
  try {
    assertSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 19);
      const role = db.prepare("SELECT type,\"notnull\" AS is_not_null,dflt_value FROM pragma_table_info('identity_audit_events') WHERE name='actor_role'").get();
      assert.deepEqual(role, { type: "TEXT", is_not_null: 1, dflt_value: "'legacy'" });
      for (const table of ["asset_classification_events", "social_post_events", "reddit_community_events", "vault_upload_events", "messaging_audit_events"]) {
        assert.deepEqual(
          db.prepare(`SELECT type,"notnull" AS is_not_null,dflt_value FROM pragma_table_info('${table}') WHERE name='actor_role'`).get(),
          { type: "TEXT", is_not_null: 1, dflt_value: "'legacy'" },
        );
      }
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'identity_audit_%'").get().count, 3);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("realistic 0018 Adelaide database upgrades without changing identifiers and keeps rollback writers compatible", async () => {
  const workspace = await createWorkspace(18);
  try {
    assertSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    let db = new Database(databasePath);
    seedRealisticAdelaide(db);
    db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,event_type,subject,detail,created_at) VALUES ('legacy-admin','adelaide','connect@thrillnoir.com','legacy','subject','{}','2026-08-09 00:00:00')").run();
    db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,event_type,subject,detail,created_at) VALUES ('legacy-unknown','adelaide','former@example.test','legacy','subject','{}','2026-08-09 00:00:01')").run();
    db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,event_type,subject,detail,created_at) VALUES ('legacy-service','adelaide','service:legacy-worker','legacy','subject','{}','2026-08-09 00:00:02')").run();
    db.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail,created_at) VALUES ('legacy-post-event','adelaide-post-0','adelaide','connect@thrillnoir.com','legacy','{}','2026-08-09 00:00:03')").run();
    const before = adelaideSnapshot(db);
    db.close();

    await copyFile(path.join(migrationsRoot, migrationNames[18]), path.join(workspace.migrations, migrationNames[18]));
    assertSucceeded(applyMigrations(workspace));
    db = new Database(databasePath);
    try {
      assert.deepEqual(adelaideSnapshot(db), before);
      assert.deepEqual(db.prepare("SELECT id,actor_role,created_at FROM identity_audit_events ORDER BY id").all(), [
        { id: "legacy-admin", actor_role: "legacy", created_at: "2026-08-09 00:00:00" },
        { id: "legacy-service", actor_role: "legacy", created_at: "2026-08-09 00:00:02" },
        { id: "legacy-unknown", actor_role: "legacy", created_at: "2026-08-09 00:00:01" },
      ]);
      assert.deepEqual(db.prepare("SELECT actor_role,created_at FROM social_post_events WHERE id='legacy-post-event'").get(), { actor_role: "legacy", created_at: "2026-08-09 00:00:03" });

      // The currently deployed rollback application and Workers omit actor_role.
      // Every legacy INSERT shape must remain valid during the expand interval.
      db.prepare("INSERT INTO asset_classification_events (id,asset_id,creator_id,actor,event_type,snapshot) VALUES ('rollback-classification','adelaide-asset-000','adelaide','connect@thrillnoir.com','rollback','{}')").run();
      db.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES ('rollback-social-post','adelaide-post-0','adelaide','connect@thrillnoir.com','rollback','{}')").run();
      db.prepare("INSERT INTO reddit_community_events (id,community_id,creator_id,actor,event_type,detail) VALUES ('rollback-community',1,'adelaide','connect@thrillnoir.com','rollback','{}')").run();
      db.prepare("INSERT INTO vault_upload_jobs (id,creator_id,account_id,asset_id,platform,status,approved_by) VALUES ('rollback-vault-job','adelaide','adelaide-fansly-main','adelaide-asset-000','fansly','approved','connect@thrillnoir.com')").run();
      db.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,event_type,detail) VALUES ('rollback-vault-event','rollback-vault-job','adelaide','service:vault-bridge','rollback','{}')").run();
      db.prepare("INSERT INTO messaging_audit_events (id,creator_id,event_type,actor,detail) VALUES ('rollback-message-event','adelaide','rollback','service:telegram-bridge','{}')").run();
      db.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,event_type,subject,detail) VALUES ('rollback-identity-event','adelaide','connect@thrillnoir.com','rollback','subject','{}')").run();

      for (const [table, id] of [
        ["asset_classification_events", "rollback-classification"],
        ["social_post_events", "rollback-social-post"],
        ["reddit_community_events", "rollback-community"],
        ["vault_upload_events", "rollback-vault-event"],
        ["messaging_audit_events", "rollback-message-event"],
        ["identity_audit_events", "rollback-identity-event"],
      ]) assert.equal(db.prepare(`SELECT actor_role FROM ${table} WHERE id=?`).get(id).actor_role, "legacy");

      assert.deepEqual({ assets: before.assets.length, accounts: before.accounts.length, posts: before.posts.length, threads: before.threads.length }, { assets: 195, accounts: 5, posts: 6, threads: 45 });
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations WHERE name='0019_actor_role_audit.sql'").get().count, 1);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("audit constraints reject role spoofing and cross-creator misleading records", async () => {
  const workspace = await createWorkspace(19);
  try {
    assertSucceeded(applyMigrations(workspace));
    assertSucceeded(applyFixture(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    const db = new Database(databasePath);
    try {
      db.prepare("INSERT INTO users (email,display_name) VALUES ('qa-creator@example.test','QA Creator')").run();
      db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('staging-authz-fixture','qa-creator@example.test','creator')").run();
      db.prepare("INSERT INTO users (email,display_name) VALUES ('legacy-attempt@example.test','Legacy Attempt')").run();
      assert.throws(() => db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('staging-authz-fixture','legacy-attempt@example.test','legacy')").run(), /CHECK constraint failed/);
      insertAudit(db, { id: "creator-own", creator: "staging-authz-fixture", actor: "qa-creator@example.test", role: "creator" });
      assert.throws(() => insertAudit(db, { id: "creator-spoof", creator: "staging-authz-fixture", actor: "qa-creator@example.test", role: "agency_admin" }), /audit_human_actor_scope_invalid/);
      const beforeCross = db.prepare("SELECT COUNT(*) AS count FROM identity_audit_events").get().count;
      assert.throws(() => insertAudit(db, { id: "creator-cross", creator: "adelaide", actor: "qa-creator@example.test", role: "creator" }), /audit_human_actor_scope_invalid/);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM identity_audit_events").get().count, beforeCross);

      insertAudit(db, { id: "admin-fixture", creator: "staging-authz-fixture", actor: "connect@thrillnoir.com", role: "agency_admin" });
      for (const role of ["operator", "viewer"]) {
        const email = `${role}@example.test`;
        db.prepare("INSERT INTO users (email,display_name) VALUES (?,?)").run(email, role);
        db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('staging-authz-fixture',?,?)").run(email, role);
        insertAudit(db, { id: `${role}-own`, creator: "staging-authz-fixture", actor: email, role });
      }

      db.prepare("INSERT INTO service_credentials (id,service_name,token_hash,status) VALUES ('qa-service','staging-qa-runner','test-hash','active')").run();
      db.prepare("INSERT INTO service_creator_grants (service_credential_id,creator_id,status) VALUES ('qa-service','staging-authz-fixture','active')").run();
      insertAudit(db, { id: "service-own", creator: "staging-authz-fixture", actor: "service:staging-qa-runner", role: "service" });
      assert.throws(() => insertAudit(db, { id: "service-cross", creator: "adelaide", actor: "service:staging-qa-runner", role: "service" }), /audit_service_actor_scope_invalid/);
      db.prepare("INSERT INTO service_credentials (id,service_name,token_hash,status,expires_at) VALUES ('expired-service','expired-qa-runner','expired-hash','active',strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour'))").run();
      db.prepare("INSERT INTO service_creator_grants (service_credential_id,creator_id,status) VALUES ('expired-service','staging-authz-fixture','active')").run();
      assert.throws(() => insertAudit(db, { id: "service-expired", creator: "staging-authz-fixture", actor: "service:expired-qa-runner", role: "service" }), /audit_service_actor_scope_invalid/);

      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM operational_accounts WHERE creator_id='staging-authz-fixture'").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM assets WHERE creator_id='staging-authz-fixture'").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM message_threads WHERE creator_id='staging-authz-fixture'").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM social_posts WHERE creator_id='staging-authz-fixture'").get().count, 0);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("failed 0019 migration rolls back schema, triggers and migration record", async () => {
  const workspace = await createWorkspace(18);
  try {
    assertSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    const migration = await readFile(path.join(migrationsRoot, migrationNames[18]), "utf8");
    await writeFile(path.join(workspace.migrations, migrationNames[18]), `${migration}\nCREATE TRIGGER incomplete_0019 BEFORE INSERT ON identity_audit_events BEGIN SELECT 1;\n`);
    const failed = applyMigrations(workspace);
    assert.notEqual(failed.status, 0);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /incomplete input/);
    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 18);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('service_creator_grants','identity_audit_creator_required','identity_audit_human_scope','identity_audit_service_scope')").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('identity_audit_events') WHERE name='actor_role'").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creators WHERE id='adelaide'").get().count, 1);
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});
