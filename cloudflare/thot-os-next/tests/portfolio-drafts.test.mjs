import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { isVideoPortfolioItem, suggestedLinkedPreviewAssetId } from "../src/lib/portfolio-video.ts";
import { privatePortfolioImageObjectId } from "../src/lib/portfolio-preview.ts";
import { portfolioBulkAssetIds } from "../src/lib/portfolio-bulk.ts";
import { portfolioPublicationReadiness } from "../src/lib/portfolio-publication-readiness.ts";
import { portfolioLibraryEligible } from "../src/lib/portfolio-library-eligibility.ts";
import { portfolioAddFields } from "../src/lib/portfolio-add-fields.ts";

const migration = readFileSync(fileURLToPath(new URL("../../thot-os-app/migrations/0066_creator_portfolio_drafts.sql", import.meta.url)), "utf8");
const previewFirstMigration = readFileSync(fileURLToPath(new URL("../../thot-os-app/migrations/0068_portfolio_preview_first.sql", import.meta.url)), "utf8");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE creators (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id), extension TEXT NOT NULL, UNIQUE(id,creator_id));
    INSERT INTO creators(id) VALUES ('creator-a'),('creator-b');
    INSERT INTO assets(id,creator_id,extension) VALUES ('full-a','creator-a','mp4'),('preview-a','creator-a','mp4'),('image-a','creator-a','jpg'),('full-b','creator-b','mp4'),('preview-b','creator-b','mp4');`);
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

test("preview-first migration preserves a legacy full clip unchanged for creator review", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO creator_portfolio_items(asset_id,creator_id,preview_asset_id,title,updated_by) VALUES ('full-a','creator-a','preview-a','Draft','creator@example.invalid')").run();
    db.exec(previewFirstMigration);
    assert.deepEqual(db.prepare("SELECT asset_id,full_length_asset_id,preview_asset_id,preview_confirmed FROM creator_portfolio_items").get(),
      { asset_id: "full-a", full_length_asset_id: null, preview_asset_id: "preview-a", preview_confirmed: 0 });
    assert.throws(() => db.prepare("UPDATE creator_portfolio_items SET full_length_asset_id='full-b'").run(), /portfolio_full_asset_creator_mismatch/);
    assert.equal(db.prepare("SELECT revision FROM creator_portfolio_draft_state WHERE creator_id='creator-a'").get().revision, 0);
    db.prepare("UPDATE creator_portfolio_draft_state SET revision=CASE WHEN revision=0 THEN revision+1 ELSE -1 END WHERE creator_id='creator-a'").run();
    assert.throws(() => db.prepare("UPDATE creator_portfolio_draft_state SET revision=CASE WHEN revision=0 THEN revision+1 ELSE -1 END WHERE creator_id='creator-a'").run(), /CHECK/);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally { db.close(); }
});

test("old full-video drafts without a teaser remain blocked until a preview is explicitly selected", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO creator_portfolio_items(asset_id,creator_id,title,updated_by) VALUES ('full-a','creator-a','Old full video','creator@example.invalid')").run();
    db.exec(previewFirstMigration);
    assert.deepEqual(db.prepare("SELECT asset_id,preview_asset_id,preview_confirmed FROM creator_portfolio_items").get(),
      { asset_id: "full-a", preview_asset_id: null, preview_confirmed: 0 });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_portfolio_items WHERE preview_confirmed=1").get().count, 0);
    db.prepare("DELETE FROM creator_portfolio_items WHERE asset_id='full-a'").run();
    db.prepare("INSERT INTO creator_portfolio_items(asset_id,creator_id,title,updated_by,preview_confirmed) VALUES ('preview-a','creator-a','Selected preview','creator@example.invalid',1)").run();
    assert.equal(db.prepare("SELECT preview_confirmed FROM creator_portfolio_items").get().preview_confirmed, 1);
    assert.throws(() => db.prepare("UPDATE creator_portfolio_items SET preview_confirmed=2").run(), /CHECK/);
  } finally { db.close(); }
});

test("existing image cards retain their preview intent during migration", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO creator_portfolio_items(asset_id,creator_id,title,updated_by) VALUES ('image-a','creator-a','Photo','creator@example.invalid')").run();
    db.exec(previewFirstMigration);
    assert.equal(db.prepare("SELECT preview_confirmed FROM creator_portfolio_items WHERE asset_id='image-a'").get().preview_confirmed, 1);
  } finally { db.close(); }
});

test("migration leaves full videos sharing a teaser private for manual review", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO assets(id,creator_id,extension) VALUES ('second-full-a','creator-a','mp4')").run();
    const add = db.prepare("INSERT INTO creator_portfolio_items(asset_id,creator_id,preview_asset_id,title,updated_by) VALUES (?,'creator-a','preview-a',?,'creator@example.invalid')");
    add.run("full-a", "First full video");
    add.run("second-full-a", "Second full video");
    db.exec(previewFirstMigration);
    assert.deepEqual(db.prepare("SELECT asset_id,preview_asset_id,preview_confirmed FROM creator_portfolio_items ORDER BY asset_id").all(), [
      { asset_id: "full-a", preview_asset_id: "preview-a", preview_confirmed: 0 },
      { asset_id: "second-full-a", preview_asset_id: "preview-a", preview_confirmed: 0 },
    ]);
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
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

test("bulk category selection is bounded and rejects duplicate or malformed IDs", () => {
  assert.deepEqual(portfolioBulkAssetIds(["asset-a", "asset-b"]), ["asset-a", "asset-b"]);
  assert.throws(() => portfolioBulkAssetIds([]), /between 1 and 50/);
  assert.throws(() => portfolioBulkAssetIds(Array.from({ length: 51 }, (_, index) => `asset-${index}`)), /between 1 and 50/);
  assert.throws(() => portfolioBulkAssetIds(["asset-a", "asset-a"]), /once/);
  assert.throws(() => portfolioBulkAssetIds(["asset-a", "../other"]), /between 1 and 50/);
});

test("publication readiness accepts a preview-only card without a full-length link", () => {
  const image = { asset_id: "image-a", title: "Image", safety: "nsfw", source_available: 1, category_id: null,
    preview_r2_key: "private-preview.jpg", extension: "jpg", video_state: null };
  assert.deepEqual(portfolioPublicationReadiness(image), {
    ready: false, message: "Choose a category", issues: [{ message: "Choose a category", href: "#portfolio-item-image-a" }],
  });
  assert.equal(portfolioPublicationReadiness({ ...image, category_id: "category-a" }).ready, true);
  const video = { ...image, asset_id: "preview-a", extension: "mp4", category_id: "category-a" };
  assert.equal(portfolioPublicationReadiness({ ...video, preview_r2_key: null }).issues[0].message, "Choose a thumbnail for this short clip");
  assert.equal(portfolioPublicationReadiness(video).ready, true);
  assert.equal(portfolioPublicationReadiness({ ...video, source_available: 0 }).ready, false);
});

test("Library Add to Portfolio appears only for verified 18+ preview formats", () => {
  const clip = { safety: "nsfw", media_authority_state: "canonical_verified", extension: "mp4", video_codec: "h264" };
  assert.equal(portfolioLibraryEligible(clip), true);
  assert.equal(portfolioLibraryEligible({ ...clip, safety: null }), false);
  assert.equal(portfolioLibraryEligible({ ...clip, video_codec: "h265" }), false);
  assert.equal(portfolioLibraryEligible({ ...clip, media_authority_state: "ingesting" }), false);
});

test("Library add captures category and optional full video in one submission", () => {
  const form = new FormData();
  form.set("confirmAdd", "yes");
  form.set("categoryChoice", "11111111-1111-4111-8111-111111111111");
  form.set("fullLengthAssetId", "full-a");
  assert.deepEqual(portfolioAddFields(form, "preview-a"), {
    categoryId: "11111111-1111-4111-8111-111111111111", newCategoryName: null, fullLengthAssetId: "full-a",
  });
  form.set("categoryChoice", "__new__");
  form.set("newCategoryName", "  New   Clips  ");
  form.delete("fullLengthAssetId");
  assert.deepEqual(portfolioAddFields(form, "preview-a"), {
    categoryId: null, newCategoryName: "New Clips", fullLengthAssetId: null,
  });
  form.set("fullLengthAssetId", "preview-a");
  assert.throws(() => portfolioAddFields(form, "preview-a"), /separate private/);
  form.delete("confirmAdd");
  assert.throws(() => portfolioAddFields(form, "preview-a"), /Tick Add/);
  form.set("confirmAdd", "yes");
  form.set("categoryChoice", "other-creator-category");
  assert.throws(() => portfolioAddFields(form, "preview-a"), /Choose a category/);
});

test("one Library save can persist a preview category and same-creator private full link", () => {
  const db = fixture();
  try {
    db.exec(previewFirstMigration);
    db.transaction(() => {
      db.prepare("INSERT INTO creator_portfolio_categories(id,creator_id,name) VALUES ('category-a','creator-a','Clips')").run();
      db.prepare(`INSERT INTO creator_portfolio_items
        (asset_id,creator_id,title,category_id,full_length_asset_id,preview_confirmed,updated_by)
        VALUES ('preview-a','creator-a','A short clip','category-a','full-a',1,'creator@example.invalid')`).run();
    })();
    assert.deepEqual(db.prepare("SELECT asset_id,category_id,full_length_asset_id,preview_confirmed FROM creator_portfolio_items").get(), {
      asset_id: "preview-a", category_id: "category-a", full_length_asset_id: "full-a", preview_confirmed: 1,
    });
    assert.throws(() => db.prepare("UPDATE creator_portfolio_items SET full_length_asset_id='full-b' WHERE asset_id='preview-a'").run(), /portfolio_full_asset_creator_mismatch/);
  } finally { db.close(); }
});
