import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";
import { buildLibraryAssetsQuery, escapeLibraryLikeQuery, LIBRARY_PAGE_SIZE, normalizeLibraryQuery, parseLibraryPage } from "../src/lib/library-pagination.ts";

function database() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE assets (
      id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, basename TEXT NOT NULL, display_stem TEXT, extension TEXT NOT NULL,
      bytes INTEGER NOT NULL, modified_at TEXT NOT NULL, creator_notes TEXT, preview_r2_key TEXT,
      source_available INTEGER NOT NULL, relative_path TEXT NOT NULL
    );
    CREATE TABLE asset_classifications (
      asset_id TEXT NOT NULL, creator_id TEXT NOT NULL, safety TEXT, is_teaser INTEGER,
      is_multi INTEGER, notes TEXT, PRIMARY KEY(asset_id,creator_id)
    );
    CREATE TABLE asset_media_authorities (
      asset_id TEXT NOT NULL, creator_id TEXT NOT NULL, authority_kind TEXT, state TEXT,
      PRIMARY KEY(asset_id,creator_id)
    );
    CREATE TABLE asset_video_playback_states (
      asset_id TEXT NOT NULL, creator_id TEXT NOT NULL, state TEXT, source_codec TEXT,
      playback_provider TEXT, failure_code TEXT, PRIMARY KEY(asset_id,creator_id)
    );
    CREATE TABLE asset_destinations(asset_id TEXT NOT NULL, creator_id TEXT NOT NULL, destination TEXT);`);
  return db;
}

function query(db, creatorId, filters = {}, lookahead = false) {
  const built = buildLibraryAssetsQuery(filters, ["instagram", "facebook", "tiktok", "threads", "x", "reddit", "subscription", "ppv"], lookahead);
  return db.prepare(built.sql).all(creatorId, ...built.values, built.limit, built.offset);
}

test("library pages reach every stable row once across more than 120 assets", () => {
  const db = database();
  try {
    const insertAsset = db.prepare(`INSERT INTO assets (id,creator_id,basename,extension,bytes,modified_at,creator_notes,preview_r2_key,source_available,relative_path) VALUES (?,?,?,?,?,?,?,?,1,?)`);
    const insertAuthority = db.prepare("INSERT INTO asset_media_authorities VALUES (?,?,'r2_native','canonical_verified')");
    for (let index = 0; index < 250; index += 1) {
      const id = `asset-${String(index).padStart(3, "0")}`;
      insertAsset.run(id, "creator-a", `${id}.jpg`, "jpg", 10, "2026-10-01", "", null, `/${id}`);
      insertAuthority.run(id, "creator-a");
    }
    insertAsset.run("asset-foreign", "creator-b", "foreign.jpg", "jpg", 10, "2026-10-01", "", null, "/foreign");
    insertAuthority.run("asset-foreign", "creator-b");

    const pages = [];
    for (const page of [1, 2, 3]) pages.push(query(db, "creator-a", { page }, true).slice(0, LIBRARY_PAGE_SIZE).map((row) => row.id));
    const all = pages.flat();
    assert.equal(all.length, 250);
    assert.equal(new Set(all).size, 250);
    assert.equal(all.includes("asset-foreign"), false);
    assert.deepEqual(pages[0], query(db, "creator-a", { page: 1 }).map((row) => row.id));
  } finally { db.close(); }
});

test("library type filters include HEIC photos case-insensitively and keep videos separate", () => {
  const db = database();
  try {
    const insertAsset = db.prepare("INSERT INTO assets (id,creator_id,basename,extension,bytes,modified_at,creator_notes,preview_r2_key,source_available,relative_path) VALUES (?,?,?,?,?,?,?,?,1,?)");
    const insertAuthority = db.prepare("INSERT INTO asset_media_authorities VALUES (?,?,'r2_native','canonical_verified')");
    for (const [id, extension] of [["photo", "JPG"], ["heic", "HEIC"], ["video", "MP4"], ["movie", "mov"]]) {
      insertAsset.run(id, "creator-a", id, extension, 10, "2026-10-01", "", null, `/${id}`);
      insertAuthority.run(id, "creator-a");
    }
    assert.deepEqual(query(db, "creator-a", { type: "photos" }).map((row) => row.id).sort(), ["heic", "photo"]);
    assert.deepEqual(query(db, "creator-a", { type: "videos" }).map((row) => row.id).sort(), ["movie", "video"]);
  } finally { db.close(); }
});

test("teaser filter describes the asset itself and stays creator scoped", () => {
  const db = database();
  try {
    const insertAsset = db.prepare("INSERT INTO assets (id,creator_id,basename,extension,bytes,modified_at,creator_notes,preview_r2_key,source_available,relative_path) VALUES (?,?,?,?,?,?,?,?,1,?)");
    const insertAuthority = db.prepare("INSERT INTO asset_media_authorities VALUES (?,?,'r2_native','canonical_verified')");
    const insertClassification = db.prepare("INSERT INTO asset_classifications VALUES (?,?,'nsfw',?,0,'')");
    for (const [id, creator, teaser] of [["teaser-a", "creator-a", 1], ["full-a", "creator-a", 0], ["teaser-b", "creator-b", 1]]) {
      insertAsset.run(id, creator, `${id}.mp4`, "mp4", 10, "2026-10-01", "", null, `/${id}`);
      insertAuthority.run(id, creator);
      insertClassification.run(id, creator, teaser);
    }
    assert.deepEqual(query(db, "creator-a", { teaser: "yes" }).map((row) => row.id), ["teaser-a"]);
    assert.deepEqual(query(db, "creator-a", { teaser: "no" }).map((row) => row.id), ["full-a"]);
    assert.deepEqual(query(db, "creator-a", { teaser: "unknown" }).map((row) => row.id).sort(), ["full-a", "teaser-a"]);
  } finally { db.close(); }
});

test("library search covers notes, creator notes and IDs with literal LIKE wildcards", () => {
  const db = database();
  try {
    const insertAsset = db.prepare("INSERT INTO assets (id,creator_id,basename,extension,bytes,modified_at,creator_notes,preview_r2_key,source_available,relative_path) VALUES (?,?,?,?,?,?,?,?,1,?)");
    const insertAuthority = db.prepare("INSERT INTO asset_media_authorities VALUES (?,?,'r2_native','canonical_verified')");
    const insertClassification = db.prepare("INSERT INTO asset_classifications VALUES (?,?,'sfw',0,0,?)");
    const rows = [
      ["id-note", "plain.jpg", "", "release %_ note"],
      ["id-creator", "plain.jpg", "creator %_ note", ""],
      ["stable-id-special", "plain.jpg", "", ""],
      ["literal-decoy", "plainXjpg", "creator XX note", "release XX note"],
    ];
    for (const [id, name, creatorNotes, notes] of rows) {
      insertAsset.run(id, "creator-a", name, "jpg", 10, "2026-10-01", creatorNotes, null, `/${id}`);
      insertAuthority.run(id, "creator-a");
      insertClassification.run(id, "creator-a", notes);
    }
    assert.deepEqual(query(db, "creator-a", { query: "%_" }).map((row) => row.id).sort(), ["id-creator", "id-note"]);
    assert.deepEqual(query(db, "creator-a", { query: "stable-id-special" }).map((row) => row.id), ["stable-id-special"]);
    db.prepare("UPDATE assets SET display_stem='New archive name' WHERE id='stable-id-special'").run();
    assert.deepEqual(query(db, "creator-a", { query: "New archive name" }).map((row) => row.id), ["stable-id-special"]);
    assert.deepEqual(query(db, "creator-a", { query: "plain.jpg" }).map((row) => row.id).sort(), ["id-creator", "id-note", "stable-id-special"]);
  } finally { db.close(); }
});

test("library page and query inputs are bounded and LIKE escaping is explicit", () => {
  assert.equal(parseLibraryPage("2"), 2);
  assert.equal(parseLibraryPage("0"), 1);
  assert.equal(parseLibraryPage("nonsense"), 1);
  assert.equal(parseLibraryPage("999999999999999999999"), 1);
  assert.equal(normalizeLibraryQuery(" x ".repeat(100)).length, 120);
  assert.equal(escapeLibraryLikeQuery("%_\\"), "\\%\\_\\\\");
  assert.equal(buildLibraryAssetsQuery({ page: 2 }, [], true).limit, LIBRARY_PAGE_SIZE + 1);
});
