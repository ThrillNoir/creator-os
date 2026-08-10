import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { unstable_splitSqlQuery } from "wrangler";

const appRoot = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.resolve(appRoot, "../thot-os-app/migrations");
const wrangler = path.resolve(appRoot, "node_modules/.bin/wrangler");
const migrationNames = Array.from({ length: 18 }, (_, index) =>
  `${String(index + 1).padStart(4, "0")}_${[
    "adelaide_library",
    "library_classification_events",
    "operations_foundation",
    "reddit_scheduler",
    "reddit_queue_controls",
    "instagram_operations",
    "vault_bridge",
    "reddit_native_bridge",
    "unified_messages",
    "telegram_connector",
    "instagram_completion",
    "instagram_replies",
    "instagram_reply_window",
    "instagram_message_subscription",
    "message_attachments",
    "telegram_fansly_messages",
    "reddit_community_events",
    "creator_identity_profiles",
  ][index]}.sql`,
);

async function createWorkspace(count) {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-0018-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  await mkdir(migrations);
  for (const name of migrationNames.slice(0, count)) {
    await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
  }
  await writeFile(
    path.join(root, "wrangler.jsonc"),
    JSON.stringify({
      name: "thot-os-0018-local-repro",
      compatibility_date: "2026-08-08",
      d1_databases: [{
        binding: "DB",
        database_name: "thot-os-0018-local-repro",
        database_id: "174532e8-5ada-4e30-abba-1276b3540b3f",
        migrations_dir: "./migrations",
      }],
    }),
  );
  return { root, migrations, state };
}

function applyMigrations(workspace) {
  return spawnSync(
    wrangler,
    ["d1", "migrations", "apply", "thot-os-0018-local-repro", "--local", "--persist-to", workspace.state],
    {
      cwd: workspace.root,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDatabase(candidate);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") {
      return candidate;
    }
  }
  return null;
}

function assertWranglerSucceeded(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function adelaideSnapshot(db) {
  const ids = (table) => db.prepare(`SELECT id FROM ${table} WHERE creator_id='adelaide' ORDER BY id`).all().map(({ id }) => id);
  return {
    creator: db.prepare("SELECT id,name,slug,initials,status FROM creators WHERE id='adelaide'").get(),
    assets: ids("assets"),
    accounts: ids("operational_accounts"),
    posts: ids("social_posts"),
    threads: ids("message_threads"),
  };
}

function seedRealisticAdelaide(db) {
  const insertAsset = db.prepare(`
    INSERT INTO assets
      (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,source_available,indexed_at)
    VALUES (?,?,?,?,?,?,?,?,1,?)
  `);
  const insertPost = db.prepare(`
    INSERT INTO social_posts (id,creator_id,platform,account_id,title,caption,status)
    VALUES (?,?,?,?,?,?,?)
  `);
  const insertThread = db.prepare(`
    INSERT INTO message_threads
      (id,creator_id,connection_id,external_thread_id,participant_name,participant_handle,status)
    VALUES (?,?,?,?,?,?,?)
  `);
  db.transaction(() => {
    for (let index = 0; index < 195; index += 1) {
      const suffix = String(index).padStart(3, "0");
      insertAsset.run(
        `adelaide-asset-${suffix}`,
        "adelaide",
        `STILLS/adelaide-${suffix}.jpg`,
        `adelaide-${suffix}.jpg`,
        "jpg",
        1000 + index,
        "2026-08-09T00:00:00.000Z",
        "descriptive",
        "2026-08-09T00:00:00.000Z",
      );
    }
    for (let index = 0; index < 6; index += 1) {
      insertPost.run(
        `adelaide-post-${index}`,
        "adelaide",
        "reddit",
        "adelaide-reddit-main",
        `Post ${index}`,
        "Approved local migration fixture",
        "draft",
      );
    }
    for (let index = 0; index < 45; index += 1) {
      insertThread.run(
        `adelaide-thread-${index}`,
        "adelaide",
        "adelaide-messages-fansly",
        `fansly-thread-${index}`,
        `Participant ${index}`,
        `participant-${index}`,
        "open",
      );
    }
  })();
}

test("Wrangler 4.120.0 parses comments and quotes but the preserved nested CASE is the compound split boundary", async () => {
  const version = spawnSync(wrangler, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.match(version.stdout, /4\.120\.0/);
  const repro = await readFile(path.join(appRoot, "tests/fixtures/0018-nested-case-repro.sql"), "utf8");
  const parts = unstable_splitSqlQuery(repro);
  assert.equal(parts.length, 2);
  assert.match(parts[1], /SELECT CASE[\s\S]*END;\s*END$/);
  assert.match(parts[1], /'creator_identity_must_be_single_workspace'/);
});

test("fresh Wrangler replay applies migrations 0001 through repaired 0018", async () => {
  const workspace = await createWorkspace(18);
  try {
    assertWranglerSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 18);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'creator_memberships_%'").get().count, 4);
      assert.equal(db.prepare("SELECT role FROM creator_memberships WHERE creator_id='adelaide' AND user_email='connect@thrillnoir.com'").get().role, "agency_admin");
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("realistic Adelaide 0017 database upgrades without changing counts or identifiers", async () => {
  const workspace = await createWorkspace(17);
  try {
    assertWranglerSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    let db = new Database(databasePath);
    seedRealisticAdelaide(db);
    const before = adelaideSnapshot(db);
    assert.deepEqual(
      { assets: before.assets.length, accounts: before.accounts.length, posts: before.posts.length, threads: before.threads.length },
      { assets: 195, accounts: 5, posts: 6, threads: 45 },
    );
    db.close();

    await copyFile(path.join(migrationsRoot, migrationNames[17]), path.join(workspace.migrations, migrationNames[17]));
    assertWranglerSucceeded(applyMigrations(workspace));
    db = new Database(databasePath);
    try {
      assert.deepEqual(adelaideSnapshot(db), before);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations WHERE name=?").get(migrationNames[17]).count, 1);
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");

      db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('second','Second','second','S')").run();
      db.prepare("INSERT INTO users (email,display_name) VALUES ('locked@example.test','Locked Creator')").run();
      db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('adelaide','locked@example.test','creator')").run();
      assert.throws(
        () => db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('second','locked@example.test','creator')").run(),
        /creator_identity_must_be_single_workspace/,
      );
      assert.throws(
        () => db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('second','locked@example.test','operator')").run(),
        /creator_identity_cannot_be_staff/,
      );

      db.prepare("INSERT INTO users (email,display_name) VALUES ('update-creator@example.test','Update Creator')").run();
      db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('adelaide','update-creator@example.test','operator')").run();
      db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role,status) VALUES ('second','update-creator@example.test','viewer','suspended')").run();
      assert.throws(
        () => db.prepare("UPDATE creator_memberships SET role='creator',status='active' WHERE creator_id='second' AND user_email='update-creator@example.test'").run(),
        /creator_identity_must_be_single_workspace/,
      );

      db.prepare("INSERT INTO users (email,display_name) VALUES ('update-staff@example.test','Update Staff')").run();
      db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role) VALUES ('adelaide','update-staff@example.test','creator')").run();
      db.prepare("INSERT INTO creator_memberships (creator_id,user_email,role,status) VALUES ('second','update-staff@example.test','viewer','suspended')").run();
      assert.throws(
        () => db.prepare("UPDATE creator_memberships SET status='active' WHERE creator_id='second' AND user_email='update-staff@example.test'").run(),
        /creator_identity_cannot_be_staff/,
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("failed 0018 migration rolls back every object and its migration record", async () => {
  const workspace = await createWorkspace(17);
  try {
    assertWranglerSucceeded(applyMigrations(workspace));
    const databasePath = await findDatabase(workspace.state);
    assert.ok(databasePath);
    const repaired = await readFile(path.join(migrationsRoot, migrationNames[17]), "utf8");
    await writeFile(
      path.join(workspace.migrations, migrationNames[17]),
      `${repaired}\nCREATE TRIGGER incomplete_repro BEFORE INSERT ON creator_memberships BEGIN SELECT 1;\n`,
    );
    const failed = applyMigrations(workspace);
    assert.notEqual(failed.status, 0);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /incomplete input/);

    const db = new Database(databasePath, { readonly: true });
    try {
      const names = [
        "users",
        "creator_memberships",
        "browser_profiles",
        "account_browser_profiles",
        "bridge_credentials",
        "service_credentials",
        "identity_audit_events",
        "telegram_bot_state",
        "creator_memberships_user",
        "bridge_credentials_scope",
        "identity_audit_creator_created",
        "creator_memberships_creator_workspace_insert",
        "creator_memberships_staff_class_insert",
        "creator_memberships_creator_workspace_update",
        "creator_memberships_staff_class_update",
      ];
      const placeholders = names.map(() => "?").join(",");
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN (${placeholders})`).get(...names).count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations WHERE name=?").get(migrationNames[17]).count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creators WHERE id='adelaide'").get().count, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM operational_accounts WHERE creator_id='adelaide'").get().count, 5);
    } finally {
      db.close();
    }
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});
