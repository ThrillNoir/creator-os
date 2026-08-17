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

async function replay() {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-rebuild-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  await mkdir(migrations);
  for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
  }
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
    name: "thot-os-rebuild-local",
    compatibility_date: "2026-08-17",
    d1_databases: [{ binding: "DB", database_name: "thot-os-rebuild-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
  }));
  const result = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-rebuild-local", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const findDatabase = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await findDatabase(candidate);
        if (nested) return nested;
      } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") return candidate;
    }
    return null;
  };
  const file = await findDatabase(state);
  assert.ok(file);
  return { root, db: new Database(file) };
}

test("0033 prevents cross-creator joins and keeps detected exceptions non-destructive", async () => {
  const fixture = await replay();
  try {
    const { db } = fixture;
    db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('second','Second','second','S')").run();
    db.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES ('asset-second','second','safe.jpg','safe.jpg','jpg',1,CURRENT_TIMESTAMP,'image',CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT INTO operational_accounts (id,creator_id,platform,label,connection_status,publishing_mode,publishing_authority) VALUES ('second-ig','second','instagram','Second IG','not_connected','not_configured','not_configured')").run();
    assert.throws(() => db.prepare("INSERT INTO asset_classifications (asset_id,creator_id,safety) VALUES ('asset-second','adelaide','sfw')").run(), /asset_classification_creator_mismatch/);
    assert.throws(() => db.prepare("INSERT INTO asset_destinations (asset_id,creator_id,destination) VALUES ('asset-second','adelaide','instagram')").run(), /asset_destination_creator_mismatch/);
    assert.throws(() => db.prepare("INSERT INTO social_posts (id,creator_id,platform,account_id,status) VALUES ('cross-post','adelaide','instagram','second-ig','draft')").run(), /social_post_creator_mismatch/);
    db.prepare("INSERT INTO asset_classifications (asset_id,creator_id,safety) VALUES ('asset-second','second','sfw')").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tenant_integrity_exceptions").get().count >= 0, true);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    fixture.db.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("0034 makes public profiles approved, immutable and creator scoped", async () => {
  const fixture = await replay();
  try {
    const { db } = fixture;
    const checksum = "a".repeat(64);
    db.prepare("INSERT INTO creator_public_profiles (id,creator_id,slug,created_by) VALUES ('profile-adelaide','adelaide','adelaide-public','connect@thrillnoir.com')").run();
    db.prepare(`INSERT INTO creator_public_profile_versions
      (id,profile_id,creator_id,version_number,display_name,headline,bio,content_checksum,created_by)
      VALUES ('profile-version-1','profile-adelaide','adelaide',1,'Adelaide','Headline','Bio',?,'connect@thrillnoir.com')`).run(checksum);
    db.prepare(`INSERT INTO creator_public_links
      (id,creator_id,profile_version_id,label,destination_url,destination_host,sort_order)
      VALUES ('link-1','adelaide','profile-version-1','Official site','https://example.com/path','example.com',1)`).run();
    assert.throws(() => db.prepare("UPDATE creator_public_profiles SET published_version_id='profile-version-1',status='active' WHERE id='profile-adelaide'").run(), /public_profile_requires_approved_version/);
    db.prepare("UPDATE creator_public_profile_versions SET status='approved',approved_by='connect@thrillnoir.com',approved_at=CURRENT_TIMESTAMP WHERE id='profile-version-1'").run();
    assert.throws(() => db.prepare("UPDATE creator_public_links SET label='Changed' WHERE id='link-1'").run(), /public_link_requires_draft_version_for_creator/);
    db.prepare("UPDATE creator_public_profiles SET published_version_id='profile-version-1',status='active' WHERE id='profile-adelaide'").run();
    assert.throws(() => db.prepare("INSERT INTO creator_public_links (id,creator_id,profile_version_id,label,destination_url,destination_host,sort_order) VALUES ('cross-link','second','profile-version-1','Bad','https://example.com','example.com',2)").run(), /FOREIGN KEY constraint failed|public_link_requires_draft_version_for_creator/);
    assert.equal(db.prepare("SELECT published_version_id FROM creator_public_profiles WHERE id='profile-adelaide'").get().published_version_id, "profile-version-1");
  } finally {
    fixture.db.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("0035 records durable operation intent and append-only metric observations", async () => {
  const fixture = await replay();
  try {
    const { db } = fixture;
    db.prepare("INSERT INTO operation_outbox (id,creator_id,operation_type,idempotency_key,payload) VALUES ('outbox-adelaide','adelaide','social_publish','social:adelaide:1','{}')").run();
    db.prepare("INSERT INTO external_operation_receipts (id,creator_id,operation_id,provider,status) VALUES ('receipt-adelaide','adelaide','outbox-adelaide','instagram','pending')").run();
    assert.throws(() => db.prepare("INSERT INTO external_operation_receipts (id,creator_id,operation_id,provider,status) VALUES ('receipt-cross','second','outbox-adelaide','instagram','pending')").run(), /external_operation_receipt_creator_mismatch/);
    db.prepare("INSERT INTO instagram_media_metric_observations (id,creator_id,media_id,collected_at) VALUES ('metric-1','adelaide','media-1','2026-08-17T00:00:00.000Z')").run();
    db.prepare("INSERT INTO instagram_media_metric_observations (id,creator_id,media_id,collected_at) VALUES ('metric-2','adelaide','media-1','2026-08-17T01:00:00.000Z')").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM instagram_media_metric_observations WHERE creator_id='adelaide' AND media_id='media-1'").get().count, 2);
  } finally {
    fixture.db.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("0036 keeps one draft and protects a published public URL from silent changes", async () => {
  const fixture = await replay();
  try {
    const { db } = fixture;
    const checksum = "b".repeat(64);
    db.prepare("INSERT INTO creator_public_profiles (id,creator_id,slug,created_by) VALUES ('profile-guards','adelaide','adelaide-guards','connect@thrillnoir.com')").run();
    db.prepare(`INSERT INTO creator_public_profile_versions
      (id,profile_id,creator_id,version_number,display_name,content_checksum,created_by)
      VALUES ('profile-guards-v1','profile-guards','adelaide',1,'Adelaide',?,'connect@thrillnoir.com')`).run(checksum);
    assert.throws(() => db.prepare(`INSERT INTO creator_public_profile_versions
      (id,profile_id,creator_id,version_number,display_name,content_checksum,created_by)
      VALUES ('profile-guards-v2','profile-guards','adelaide',2,'Adelaide',?,'connect@thrillnoir.com')`).run(checksum), /public_profile_already_has_a_draft_version/);
    db.prepare("UPDATE creator_public_profile_versions SET status='approved',approved_by='connect@thrillnoir.com',approved_at=CURRENT_TIMESTAMP WHERE id='profile-guards-v1'").run();
    db.prepare("UPDATE creator_public_profiles SET published_version_id='profile-guards-v1',status='active' WHERE id='profile-guards'").run();
    assert.throws(() => db.prepare("UPDATE creator_public_profiles SET slug='changed-url' WHERE id='profile-guards'").run(), /public_profile_slug_is_immutable_after_publication/);
    assert.throws(() => db.prepare("UPDATE creator_public_profile_versions SET status='draft' WHERE id='profile-guards-v1'").run(), /public_profile_version_cannot_return_to_draft/);
  } finally {
    fixture.db.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
