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

test("0040 keeps interaction data creator scoped and requires an approved adult-media release", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-profile-interactions-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  let db;
  try {
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
      name: "thot-os-profile-interactions-local",
      compatibility_date: "2026-08-21",
      d1_databases: [{ binding: "DB", database_name: "thot-os-profile-interactions-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
    }));
    const result = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-profile-interactions-local", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const databasePath = await findDatabase(state);
    db = new Database(databasePath);
    const checksum = "a".repeat(64);
    db.prepare("INSERT INTO creators (id,name,slug,initials) VALUES ('second','Second','second','S')").run();
    db.prepare("INSERT INTO assets (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES ('adult-asset','adelaide','adult.jpg','adult.jpg','jpg',1,CURRENT_TIMESTAMP,'image',CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT INTO asset_classifications (asset_id,creator_id,safety) VALUES ('adult-asset','adelaide','nsfw')").run();
    db.prepare("INSERT INTO creator_public_profiles (id,creator_id,slug,created_by) VALUES ('safe-profile','adelaide','adelaide-safe','connect@thrillnoir.com')").run();
    db.prepare("INSERT INTO creator_public_profile_versions (id,profile_id,creator_id,version_number,display_name,content_checksum,created_by) VALUES ('safe-version','safe-profile','adelaide',1,'Internal label',?,'connect@thrillnoir.com')").run(checksum);
    db.prepare("INSERT INTO creator_public_profile_details (profile_version_id,creator_id,public_display_name,public_bio) VALUES ('safe-version','adelaide','Adelaide','Safe bio')").run();
    db.prepare("INSERT INTO creator_public_contact_methods (id,creator_id,profile_version_id,channel,contact_value) VALUES ('contact-sms','adelaide','safe-version','sms','+61400000000')").run();
    db.prepare("INSERT INTO creator_public_link_entities (id,creator_id) VALUES ('public-link','adelaide')").run();
    db.prepare("INSERT INTO creator_public_link_revisions (id,creator_id,link_id,profile_version_id,label,destination_url,destination_host,sort_order) VALUES ('public-link-r1','adelaide','public-link','safe-version','Instagram','https://instagram.com/example','instagram.com',0)").run();
    assert.throws(() => db.prepare("INSERT INTO creator_public_contact_methods (id,creator_id,profile_version_id,channel,contact_value) VALUES ('cross-contact','second','safe-version','email','x@example.com')").run(), /FOREIGN KEY constraint failed|public_contact_requires_draft_version/);

    db.prepare("INSERT INTO creator_adult_profiles (id,creator_id,created_by) VALUES ('adult-profile','adelaide','connect@thrillnoir.com')").run();
    db.prepare("INSERT INTO creator_adult_profile_versions (id,profile_id,creator_id,version_number,adult_bio,content_checksum,created_by) VALUES ('adult-version','adult-profile','adelaide',1,'Adult bio',?,'connect@thrillnoir.com')").run(checksum);
    db.prepare("INSERT INTO creator_adult_profiles (id,creator_id,created_by) VALUES ('second-adult-profile','second','connect@thrillnoir.com')").run();
    db.prepare("INSERT INTO creator_adult_profile_versions (id,profile_id,creator_id,version_number,adult_bio,content_checksum,created_by) VALUES ('second-adult-version','second-adult-profile','second',1,'Second adult bio',?,'connect@thrillnoir.com')").run(checksum);
    assert.throws(() => db.prepare("INSERT INTO creator_adult_profile_versions (id,profile_id,creator_id,version_number,adult_bio,content_checksum,created_by) VALUES ('cross-adult-version','adult-profile','second',2,'Cross creator',?,'connect@thrillnoir.com')").run(checksum), /adult_profile_version_creator_mismatch/);
    assert.throws(() => db.prepare("UPDATE creator_adult_profile_versions SET profile_id='second-adult-profile' WHERE id='adult-version'").run(), /adult_profile_version_creator_mismatch/);
    assert.throws(() => db.prepare("UPDATE creator_adult_profile_versions SET creator_id='second' WHERE id='adult-version'").run(), /adult_profile_version_creator_mismatch/);
    db.prepare("INSERT INTO creator_adult_link_entities (id,creator_id) VALUES ('adult-link','adelaide')").run();
    db.prepare("INSERT INTO creator_adult_link_revisions (id,creator_id,link_id,profile_version_id,label,destination_url,destination_host,sort_order) VALUES ('adult-link-r1','adelaide','adult-link','adult-version','Fans','https://example.com/fans','example.com',0)").run();
    assert.throws(() => db.prepare("INSERT INTO creator_adult_profile_media (id,creator_id,profile_version_id,asset_id,derivative_object_key,sort_order) VALUES ('adult-media','adelaide','adult-version','adult-asset','adult/adelaide/asset.jpg',0)").run(), /adult_media_requires_approved_release/);
    db.prepare("INSERT INTO creator_media_release_attestations (id,creator_id,asset_id,surface,status,approved_by,approved_at) VALUES ('release','adelaide','adult-asset','adult_profile','approved','connect@thrillnoir.com',CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT INTO people (id,creator_id,display_name,consent_status) VALUES (101,'adelaide','Recorded person','not_recorded')").run();
    db.prepare("INSERT INTO asset_people (asset_id,creator_id,person_id) VALUES ('adult-asset','adelaide',101)").run();
    assert.throws(() => db.prepare("INSERT INTO creator_adult_profile_media (id,creator_id,profile_version_id,asset_id,derivative_object_key,sort_order) VALUES ('adult-media','adelaide','adult-version','adult-asset','adult/adelaide/asset.jpg',0)").run(), /adult_media_requires_approved_release/);
    db.prepare("INSERT INTO asset_paid_consent_attestations (asset_id,creator_id,person_id,evidence_platform,confirmed_by) VALUES ('adult-asset','adelaide',101,'fansly','connect@thrillnoir.com')").run();
    db.prepare("INSERT INTO creator_adult_profile_media (id,creator_id,profile_version_id,asset_id,derivative_object_key,alt_text,sort_order) VALUES ('adult-media','adelaide','adult-version','adult-asset','adult/adelaide/asset.jpg','Approved image',0)").run();
    db.prepare("INSERT INTO creator_adult_profile_publications (id,creator_id,profile_id,version_id,status,published_by,adult_snapshot_key) VALUES ('adult-publication','adelaide','adult-profile','adult-version','published','connect@thrillnoir.com','adult/adelaide/v1.json')").run();
    assert.throws(() => db.prepare("INSERT INTO creator_adult_profile_publications (id,creator_id,profile_id,version_id,status,published_by,adult_snapshot_key) VALUES ('cross-publication-creator','second','adult-profile','second-adult-version','published','connect@thrillnoir.com','adult/second/v1.json')").run(), /adult_profile_publication_scope_invalid/);
    assert.throws(() => db.prepare("INSERT INTO creator_adult_profile_publications (id,creator_id,profile_id,version_id,status,published_by,adult_snapshot_key) VALUES ('cross-publication-profile','adelaide','second-adult-profile','adult-version','published','connect@thrillnoir.com','adult/adelaide/v2.json')").run(), /adult_profile_publication_scope_invalid/);
    assert.throws(() => db.prepare("UPDATE creator_adult_profile_publications SET creator_id='second' WHERE id='adult-publication'").run(), /adult_profile_publication_scope_invalid/);
    assert.throws(() => db.prepare("UPDATE creator_adult_profile_publications SET profile_id='second-adult-profile' WHERE id='adult-publication'").run(), /adult_profile_publication_scope_invalid/);
    assert.throws(() => db.prepare("UPDATE creator_adult_profile_publications SET version_id='second-adult-version' WHERE id='adult-publication'").run(), /adult_profile_publication_scope_invalid/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_adult_profile_media WHERE creator_id='adelaide'").get().count, 1);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
