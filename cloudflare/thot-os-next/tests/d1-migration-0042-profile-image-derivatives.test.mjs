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

test("0042 keeps profile-image originals private and only permits processed draft attachments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-profile-images-"));
  const migrations = path.join(root, "migrations");
  const state = path.join(root, "state");
  let db;
  try {
    await mkdir(migrations);
    for (const name of (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) await copyFile(path.join(migrationsRoot, name), path.join(migrations, name));
    await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({
      name: "thot-os-profile-images-local",
      compatibility_date: "2026-08-21",
      d1_databases: [{ binding: "DB", database_name: "thot-os-profile-images-local", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "./migrations" }],
    }));
    const result = spawnSync(wrangler, ["d1", "migrations", "apply", "thot-os-profile-images-local", "--local", "--persist-to", state], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    db = new Database(await findDatabase(state));
    const checksum = "a".repeat(64);
    db.prepare("INSERT INTO creator_public_profiles (id,creator_id,slug,created_by) VALUES ('profile','adelaide','adelaide-images','connect@thrillnoir.com')").run();
    db.prepare("INSERT INTO creator_public_profile_versions (id,profile_id,creator_id,version_number,display_name,content_checksum,created_by) VALUES ('draft','profile','adelaide',1,'Adelaide',?,'connect@thrillnoir.com')").run(checksum);
    db.prepare("INSERT INTO creator_profile_image_uploads (id,creator_id,surface,image_role,original_object_key,declared_content_type,detected_content_type,byte_size,source_sha256,width,height,status) VALUES ('processed','adelaide','public_sfw','avatar','profile-private/adelaide/processed/original','image/png','image/png',1,?,1,1,'processed')").run(checksum);
    db.prepare("INSERT INTO creator_profile_image_derivatives (id,creator_id,upload_id,derivative_kind,object_key,content_type,byte_size,width,height,sha256) VALUES ('display','adelaide','processed','display','profile-private/adelaide/processed/display.webp','image/webp',1,1,1,?)").run(checksum);
    db.prepare("INSERT INTO creator_profile_image_attachments (id,creator_id,surface,image_role,public_profile_version_id,derivative_id) VALUES ('attachment','adelaide','public_sfw','avatar','draft','display')").run();
    assert.throws(() => db.prepare("INSERT INTO creator_profile_image_attachments (id,creator_id,surface,image_role,public_profile_version_id,derivative_id) VALUES ('duplicate','adelaide','public_sfw','avatar','draft','display')").run(), /UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT original_object_key FROM creator_profile_image_uploads WHERE id='processed'").get().original_object_key.startsWith("profile-private/"), true);
    db.prepare("INSERT INTO creator_profile_image_uploads (id,creator_id,surface,image_role,original_object_key,declared_content_type,detected_content_type,byte_size,source_sha256,status) VALUES ('unprocessed','adelaide','public_sfw','background','profile-private/adelaide/unprocessed/original','image/png','image/png',1,?,'uploaded')").run(checksum);
    db.prepare("INSERT INTO creator_profile_image_derivatives (id,creator_id,upload_id,derivative_kind,object_key,content_type,byte_size,width,height,sha256) VALUES ('unprocessed-display','adelaide','unprocessed','display','profile-private/adelaide/unprocessed/display.webp','image/webp',1,1,1,?)").run(checksum);
    assert.throws(() => db.prepare("INSERT INTO creator_profile_image_attachments (id,creator_id,surface,image_role,public_profile_version_id,derivative_id) VALUES ('invalid','adelaide','public_sfw','background','draft','unprocessed-display')").run(), /profile_image_attachment_scope_invalid/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
