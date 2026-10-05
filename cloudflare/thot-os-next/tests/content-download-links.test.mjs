import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";
import {
  claimContentDownloadLink,
  createContentDownloadLink,
  getContentDownloadSession,
  inspectContentDownloadLink,
  listContentDownloadLinks,
  revokeContentDownloadLink,
} from "../src/lib/content-download-links.ts";

const migration = await readFile(new URL("../../thot-os-app/migrations/0063_content_download_links.sql", import.meta.url), "utf8");
const productionBaseline = await readFile(new URL("../../thot-os-app/production-baseline/schema.sql", import.meta.url), "utf8");
const now = "2026-10-05T00:00:00.000Z";
const actor = { creatorId: "creator-a", email: "creator@example.test" };
const token = "a".repeat(64);
const session = "b".repeat(64);

function d1(sqlite) {
  return {
    prepare(sql) {
      return { bind(...values) {
        return {
          async first() { return sqlite.prepare(sql).get(...values) ?? null; },
          async all() { return { results: sqlite.prepare(sql).all(...values) }; },
          async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
        };
      } };
    },
  };
}

function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE creators (id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE users (email TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE creator_memberships (creator_id TEXT,user_email TEXT,role TEXT,status TEXT);
    CREATE TABLE assets (id TEXT PRIMARY KEY,creator_id TEXT,source_available INTEGER);
    CREATE TABLE asset_storage_objects (id TEXT PRIMARY KEY,creator_id TEXT,asset_id TEXT,provider TEXT,storage_role TEXT,bucket_role TEXT,object_key TEXT,byte_count INTEGER,verified_mime_type TEXT,sha256 TEXT,r2_version TEXT,r2_etag TEXT,ingest_status TEXT);
    CREATE TABLE asset_media_authorities (asset_id TEXT PRIMARY KEY,creator_id TEXT,authority_kind TEXT,canonical_storage_object_id TEXT,state TEXT);
    CREATE TABLE asset_video_playback_states (asset_id TEXT PRIMARY KEY,creator_id TEXT,canonical_storage_object_id TEXT,state TEXT);
    CREATE TABLE asset_classifications (asset_id TEXT PRIMARY KEY,creator_id TEXT,safety TEXT,is_multi INTEGER);
    CREATE TABLE asset_people (asset_id TEXT,creator_id TEXT,person_id INTEGER);
    INSERT INTO creators VALUES ('creator-a','active'),('creator-b','active');
    INSERT INTO users VALUES ('creator@example.test','active'),('other@example.test','active'),('viewer@example.test','active'),('inactive@example.test','suspended');
    INSERT INTO creator_memberships VALUES ('creator-a','creator@example.test','creator','active'),('creator-b','other@example.test','creator','active'),('creator-a','viewer@example.test','viewer','active'),('creator-a','inactive@example.test','creator','active');
    INSERT INTO assets VALUES ('asset-a','creator-a',1),('asset-b','creator-b',1);
    INSERT INTO asset_storage_objects VALUES
      ('object-a','creator-a','asset-a','r2','canonical_original','library_media','creators/a/original.mp4',42,'video/mp4','${"c".repeat(64)}','v1','etag-a','verified'),
      ('object-b','creator-b','asset-b','r2','canonical_original','library_media','creators/b/original.mp4',42,'video/mp4','${"d".repeat(64)}','v1','etag-b','verified');
    INSERT INTO asset_media_authorities VALUES ('asset-a','creator-a','r2_native','object-a','canonical_verified'),('asset-b','creator-b','r2_native','object-b','canonical_verified');
    INSERT INTO asset_video_playback_states VALUES ('asset-a','creator-a','object-a','canonical_verified'),('asset-b','creator-b','object-b','canonical_verified');
    INSERT INTO asset_classifications VALUES ('asset-a','creator-a','nsfw',0),('asset-b','creator-b','nsfw',0);
  `);
  sqlite.exec(migration);
  return { sqlite, DB: d1(sqlite) };
}

test("migration applies to the canonical production baseline", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(productionBaseline);
    sqlite.exec(migration);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_download_links'").get().name, "content_download_links");
  } finally { sqlite.close(); }
});

async function create(DB, overrides = {}) {
  return createContentDownloadLink(DB, { actor, assetId: "asset-a", title: "Approved private video", sharingConfirmed: true, now, token, id: "link-a", ...overrides });
}

test("inspection is non-consuming and durable rows keep only hashes", async () => {
  const { sqlite, DB } = fixture();
  try {
    const issued = await create(DB);
    assert.equal(issued.expiresAt, "2026-10-06T00:00:00.000Z");
    const first = await inspectContentDownloadLink(DB, { token, now });
    const second = await inspectContentDownloadLink(DB, { token, now });
    assert.deepEqual(first, second);
    assert.equal(first.title, "Approved private video");
    assert.equal(sqlite.prepare("SELECT redeemed_at FROM content_download_links WHERE id='link-a'").get().redeemed_at, null);
    const row = sqlite.prepare("SELECT token_hash,session_token_hash FROM content_download_links WHERE id='link-a'").get();
    assert.notEqual(row.token_hash, token);
    assert.equal(row.session_token_hash, null);
  } finally { sqlite.close(); }
});

test("a link claims once and its one-hour session is bound to that link", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB);
    const claimed = await claimContentDownloadLink(DB, { token, sessionToken: session, sessionId: "session-a", now });
    assert.deepEqual(claimed, { linkId: "link-a", sessionToken: session, expiresAt: "2026-10-05T01:00:00.000Z", title: "Approved private video", byteCount: 42, mimeType: "video/mp4" });
    assert.equal(await claimContentDownloadLink(DB, { token, sessionToken: "e".repeat(64), now }), null);
    assert.equal(await getContentDownloadSession(DB, { linkToken: "f".repeat(64), sessionToken: session, now }), null);
    assert.equal(await getContentDownloadSession(DB, { linkToken: token, sessionToken: "f".repeat(64), now }), null);
    const access = await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now });
    assert.equal(access.objectKey, "creators/a/original.mp4");
    assert.equal(access.r2Etag, "etag-a");
    assert.notEqual(sqlite.prepare("SELECT session_token_hash FROM content_download_links WHERE id='link-a'").get().session_token_hash, session);
    assert.equal(await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now: "2026-10-05T01:00:00.000Z" }), null);
  } finally { sqlite.close(); }
});

test("a session redeemed just before link expiry remains resumable for its full hour", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB);
    const nearDeadline = "2026-10-05T23:59:59.000Z";
    await claimContentDownloadLink(DB, { token, sessionToken: session, now: nearDeadline });
    assert.equal((await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now: "2026-10-06T00:30:00.000Z" }))?.linkId, "link-a");
  } finally { sqlite.close(); }
});

test("simultaneous claims leave exactly one winner", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB);
    const results = await Promise.all([
      claimContentDownloadLink(DB, { token, sessionToken: "1".repeat(64), sessionId: "one", now }),
      claimContentDownloadLink(DB, { token, sessionToken: "2".repeat(64), sessionId: "two", now }),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM content_download_links WHERE redeemed_at IS NOT NULL").get().n, 1);
  } finally { sqlite.close(); }
});

test("revoke denies unredeemed links and already-issued sessions", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB);
    assert.equal(await revokeContentDownloadLink(DB, { actor, linkId: "link-a", now }), true);
    assert.deepEqual(sqlite.prepare("SELECT revoked_at,revoked_by FROM content_download_links WHERE id='link-a'").get(), { revoked_at: now, revoked_by: actor.email });
    await revokeContentDownloadLink(DB, { actor, linkId: "link-a", now: "2026-10-05T00:10:00.000Z" });
    assert.deepEqual(sqlite.prepare("SELECT revoked_at,revoked_by FROM content_download_links WHERE id='link-a'").get(), { revoked_at: now, revoked_by: actor.email });
    assert.equal(await inspectContentDownloadLink(DB, { token, now }), null);
    assert.equal(await claimContentDownloadLink(DB, { token, now }), null);
    await create(DB, { token: "3".repeat(64), id: "link-b" });
    await claimContentDownloadLink(DB, { token: "3".repeat(64), sessionToken: session, now });
    await revokeContentDownloadLink(DB, { actor, linkId: "link-b", now });
    assert.equal(await getContentDownloadSession(DB, { linkToken: "3".repeat(64), sessionToken: session, now }), null);
  } finally { sqlite.close(); }
});

test("creation and revocation enforce current eligibility and creator scope", async () => {
  const { sqlite, DB } = fixture();
  try {
    await assert.rejects(create(DB, { sharingConfirmed: false }));
    await assert.rejects(create(DB, { sharingConfirmed: "true" }));
    await assert.rejects(createContentDownloadLink(DB, { actor: { creatorId: "creator-a", email: "viewer@example.test" }, assetId: "asset-a", title: "Approved private video", sharingConfirmed: true, now, token: "4".repeat(64) }));
    await assert.rejects(createContentDownloadLink(DB, { actor: { creatorId: "creator-a", email: "inactive@example.test" }, assetId: "asset-a", title: "Approved private video", sharingConfirmed: true, now, token: "5".repeat(64) }));
    sqlite.prepare("INSERT INTO asset_people VALUES ('asset-a','creator-a',1)").run();
    await assert.rejects(create(DB));
    sqlite.prepare("DELETE FROM asset_people WHERE asset_id='asset-a'").run();
    await create(DB);
    assert.equal(await revokeContentDownloadLink(DB, { actor: { creatorId: "creator-b", email: "other@example.test" }, linkId: "link-a", now }), false);
    assert.equal((await listContentDownloadLinks(DB, { actor, assetId: "asset-a", now })).length, 1);
    assert.deepEqual(await listContentDownloadLinks(DB, { actor: { creatorId: "creator-b", email: "other@example.test" }, assetId: "asset-a", now }), []);
    await claimContentDownloadLink(DB, { token, sessionToken: session, now });
    sqlite.prepare("UPDATE creator_memberships SET status='suspended' WHERE creator_id='creator-a'").run();
    assert.equal(await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now }), null);
  } finally { sqlite.close(); }
});

test("archived media authority denies issue and invalidates a claimed session", async () => {
  const denied = fixture();
  try {
    denied.sqlite.prepare("UPDATE asset_media_authorities SET state='archived' WHERE asset_id='asset-a'").run();
    await assert.rejects(create(denied.DB));
  } finally { denied.sqlite.close(); }

  const { sqlite, DB } = fixture();
  try {
    await create(DB);
    await claimContentDownloadLink(DB, { token, sessionToken: session, now });
    sqlite.prepare("UPDATE asset_media_authorities SET state='archived' WHERE asset_id='asset-a'").run();
    assert.equal(await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now }), null);
  } finally { sqlite.close(); }
});
