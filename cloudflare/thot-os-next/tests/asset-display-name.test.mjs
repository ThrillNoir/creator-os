import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import test from "node:test";
import { assetDisplayName, numberedDisplayStems, originalAssetStem, portfolioInitialTitle, validDisplayStem } from "../src/lib/asset-display-name.ts";

test("a new Portfolio card starts with the current Library name", () => {
  const asset = { basename: "62A811B5.mp4", display_stem: "Adelaide teaser" };
  assert.equal(portfolioInitialTitle(asset), "Adelaide teaser");
  assert.equal(portfolioInitialTitle({ ...asset, display_stem: null }), "62A811B5");
  assert.equal(portfolioInitialTitle({ ...asset, display_stem: "a".repeat(120) }).length, 100);
});

test("numbered Library names keep each original extension and stable asset identity", () => {
  const assets = [
    { id: "creator-a-video", basename: "original.mov", extension: "mov", display_stem: null, media_r2_key: "opaque-a" },
    { id: "creator-a-photo", basename: "image.HEIC", extension: "HEIC", display_stem: null, media_r2_key: "opaque-b" },
  ];
  const names = numberedDisplayStems("FILENAME", 3, assets.length);
  const renamed = assets.map((asset, index) => ({ ...asset, display_stem: names[index] }));
  assert.deepEqual(renamed.map(assetDisplayName), ["FILENAME_3.mov", "FILENAME_4.HEIC"]);
  assert.deepEqual(renamed.map(({ id, basename, media_r2_key }) => ({ id, basename, media_r2_key })),
    assets.map(({ id, basename, media_r2_key }) => ({ id, basename, media_r2_key })));
  assert.equal(originalAssetStem("original.MOV", "mov"), "original");
  assert.equal(validDisplayStem(" New title "), "New title");
  assert.throws(() => validDisplayStem("../escape"));
  assert.throws(() => numberedDisplayStems("", 1, 2));
  assert.throws(() => numberedDisplayStems("name", 0, 2));
  assert.throws(() => numberedDisplayStems("x".repeat(120), 1, 2));
});

test("display name migration preserves existing metadata and rejects empty names", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE assets (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, basename TEXT NOT NULL, media_r2_key TEXT NOT NULL)");
    db.prepare("INSERT INTO assets VALUES (?,?,?,?)").run("a", "creator-a", "original.mp4", "opaque-a");
    db.prepare("INSERT INTO assets VALUES (?,?,?,?)").run("b", "creator-b", "other.mp4", "opaque-b");
    db.exec(readFileSync(new URL("../../thot-os-app/migrations/0070_asset_display_names.sql", import.meta.url), "utf8"));
    db.prepare("UPDATE assets SET display_stem=? WHERE id=? AND creator_id=?").run("New name", "a", "creator-a");
    assert.deepEqual(db.prepare("SELECT id,creator_id,basename,media_r2_key,display_stem FROM assets ORDER BY id").all(), [
      { id: "a", creator_id: "creator-a", basename: "original.mp4", media_r2_key: "opaque-a", display_stem: "New name" },
      { id: "b", creator_id: "creator-b", basename: "other.mp4", media_r2_key: "opaque-b", display_stem: null },
    ]);
    assert.throws(() => db.prepare("UPDATE assets SET display_stem='' WHERE id='a'").run());
  } finally { db.close(); }
});
