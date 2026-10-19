import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { isVideoPortfolioItem, suggestedLinkedPreviewAssetId } from "../src/lib/portfolio-video.ts";
import { privatePortfolioImageObjectId } from "../src/lib/portfolio-preview.ts";

const migration = readFileSync(fileURLToPath(new URL("../../thot-os-app/migrations/0066_creator_portfolio_drafts.sql", import.meta.url)), "utf8");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE creators (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id), UNIQUE(id,creator_id));
    INSERT INTO creators(id) VALUES ('creator-a'),('creator-b');
    INSERT INTO assets(id,creator_id) VALUES ('full-a','creator-a'),('preview-a','creator-a'),('full-b','creator-b'),('preview-b','creator-b');`);
  db.exec(migration);
  return db;
}

test("portfolio drafts keep assets, previews, categories and genres in one creator", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO creator_portfolio_categories(id,creator_id,name) VALUES ('category-a','creator-a','Clips'),('category-b','creator-b','Clips')").run();
    db.prepare("INSERT INTO creator_portfolio_genres(id,creator_id,name) VALUES ('genre-a','creator-a','Performance'),('genre-b','creator-b','Performance')").run();
    const insert = db.prepare(`INSERT INTO creator_portfolio_items
      (asset_id,creator_id,category_id,genre_id,preview_asset_id,title,updated_by)
      VALUES (?,?,?,?,?,?,?)`);
    insert.run("full-a", "creator-a", "category-a", "genre-a", "preview-a", "A full clip", "creator@example.invalid");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_portfolio_items WHERE creator_id='creator-a'").get().count, 1);
    assert.throws(() => insert.run("full-b", "creator-a", "category-a", "genre-a", null, "Cross creator", "creator@example.invalid"), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE creator_portfolio_items SET category_id='category-b' WHERE asset_id='full-a'").run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE creator_portfolio_items SET genre_id='genre-b' WHERE asset_id='full-a'").run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare("UPDATE creator_portfolio_items SET preview_asset_id='preview-b' WHERE asset_id='full-a'").run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare("INSERT INTO creator_portfolio_categories(id,creator_id,name) VALUES ('category-a2','creator-a','clips')").run(), /UNIQUE/);
    assert.throws(() => db.prepare("DELETE FROM creator_portfolio_categories WHERE id='category-a'").run(), /FOREIGN KEY/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally { db.close(); }
});

test("a portfolio item is only a private draft row", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO creator_portfolio_items(asset_id,creator_id,title,updated_by) VALUES ('full-a','creator-a','Draft','creator@example.invalid')").run();
    assert.deepEqual(db.prepare("SELECT asset_id,category_id,genre_id,preview_asset_id FROM creator_portfolio_items").get(), {
      asset_id: "full-a", category_id: null, genre_id: null, preview_asset_id: null,
    });
    db.prepare("DELETE FROM creator_portfolio_items WHERE creator_id='creator-a' AND asset_id='full-a'").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_portfolio_items").get().count, 0);
  } finally { db.close(); }
});

test("the editor offers a separate preview chooser for imported videos without playback rows", () => {
  assert.equal(isVideoPortfolioItem({ extension: "MP4", video_state: null }), true);
  assert.equal(isVideoPortfolioItem({ extension: "mov", video_state: null }), true);
  assert.equal(isVideoPortfolioItem({ extension: "jpg", video_state: null }), false);
  assert.equal(isVideoPortfolioItem({ extension: "jpg", video_state: "playback_ready" }), true);
});

test("the editor suggests a Library-linked preview only when the match is unambiguous", () => {
  const linked = { id: "preview-a", teaser_for_asset_id: "full-a" };
  const unrelated = { id: "preview-b", teaser_for_asset_id: "full-b" };
  assert.equal(suggestedLinkedPreviewAssetId("full-a", [linked, unrelated]), "preview-a");
  assert.equal(suggestedLinkedPreviewAssetId("full-a", [unrelated]), "");
  assert.equal(suggestedLinkedPreviewAssetId("full-a", [linked, { id: "preview-c", teaser_for_asset_id: "full-a" }]), "");
});

test("visual draft derives the private preview object ID from its R2 key", () => {
  const objectId = "a".repeat(64);
  const revision = "b".repeat(64);
  assert.equal(privatePortfolioImageObjectId(`creators/creator-a/assets/${objectId}/previews/${revision}.jpg`), objectId);
  assert.equal(privatePortfolioImageObjectId(`creators/creator-a/assets/asset-uuid/previews/${revision}.jpg`), null);
  assert.equal(privatePortfolioImageObjectId(null), null);
});
