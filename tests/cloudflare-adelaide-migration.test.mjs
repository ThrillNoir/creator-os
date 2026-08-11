import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

test("Adelaide export imports into the THOT OS D1-compatible schema", async () => {
  const root = process.cwd();
  const migration = await readFile(path.join(root, "cloudflare/thot-os-app/migrations/0001_adelaide_library.sql"), "utf8");
  // This checked-in fixture is synthetic. CI must not depend on the ignored
  // local export, which can contain private creator-library metadata.
  const fixtureRoot = path.join(root, "tests/fixtures/cloudflare-adelaide-migration");
  const importSql = await readFile(path.join(fixtureRoot, "adelaide-d1-import.sql"), "utf8");
  const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "adelaide-manifest.json"), "utf8"));
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "thot-os-d1-"));
  const databasePath = path.join(temporaryDirectory, "staging.sqlite");
  const db = new Database(databasePath);

  try {
    db.exec(migration);
    db.exec(importSql);
    const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    assert.equal(count("creators"), manifest.counts.creators);
    assert.equal(count("assets"), manifest.counts.assets);
    assert.equal(count("asset_classifications"), manifest.counts.classifications);
    assert.equal(count("asset_destinations"), manifest.counts.destinations);
    assert.equal(count("people"), manifest.counts.people);
    assert.equal(count("asset_people"), manifest.counts.assetPeople);
    assert.equal(count("asset_paid_consent_attestations"), manifest.counts.attestations);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM assets WHERE creator_id='thrill-noir'").get().count, 0);
    assert.match(db.prepare("SELECT dropbox_root FROM creators WHERE id='adelaide'").get().dropbox_root, /^\//);
  } finally {
    db.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
