import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";
import {
  ContentDownloadLinkError,
  claimContentDownloadLink,
  createContentDownloadLink,
  getContentDownloadSession,
  inspectContentDownloadLink,
  listContentDownloadLinks,
  revokeContentDownloadLink,
} from "../src/lib/content-download-links.ts";
import { getDownloadSales, updateDownloadSale } from "../src/lib/content-download-sales.ts";

const migration = await readFile(new URL("../../thot-os-app/migrations/0064_content_download_message.sql", import.meta.url), "utf8");
const salesMigration = await readFile(new URL("../../thot-os-app/migrations/0065_content_download_sales.sql", import.meta.url), "utf8");
const previousMigration = await readFile(new URL("../../thot-os-app/migrations/0063_content_download_links.sql", import.meta.url), "utf8");
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
    CREATE TABLE creator_public_profiles (id TEXT PRIMARY KEY,creator_id TEXT,status TEXT,published_version_id TEXT);
    CREATE TABLE creator_public_profile_versions (id TEXT PRIMARY KEY,profile_id TEXT,creator_id TEXT,status TEXT,approved_by TEXT,approved_at TEXT,display_name TEXT);
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
  sqlite.exec(previousMigration);
  sqlite.exec(migration);
  sqlite.exec(salesMigration);
  return { sqlite, DB: d1(sqlite) };
}

test("migration applies to the canonical production baseline", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(productionBaseline);
    sqlite.exec(previousMigration);
    sqlite.exec(migration);
    sqlite.exec(salesMigration);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_download_links'").get().name, "content_download_links");
  } finally { sqlite.close(); }
});

test("message migration preserves existing links with a null message", async () => {
  const { sqlite, DB } = fixture();
  try {
    sqlite.exec("DROP TABLE content_download_links");
    sqlite.exec("DROP TABLE content_download_sale_audit");
    sqlite.exec(previousMigration);
    sqlite.prepare(`INSERT INTO content_download_links
      (id,creator_id,asset_id,storage_object_id,title,object_key,byte_count,mime_type,sha256,r2_version,r2_etag,token_hash,expires_at,created_by,created_at)
      VALUES ('link-a','creator-a','asset-a','object-a','Legacy title','creators/a/original.mp4',42,'video/mp4',?,'v1','etag-a',?,'2026-10-06T00:00:00.000Z','creator@example.test',?)`).run("c".repeat(64), "d".repeat(64), now);
    sqlite.exec(migration);
    assert.equal(sqlite.prepare("SELECT title,custom_message FROM content_download_links WHERE id='link-a'").get().custom_message, null);
    sqlite.exec(salesMigration);
    assert.deepEqual(sqlite.prepare("SELECT recipient_reference,amount_minor,sale_currency,revision FROM content_download_links WHERE id='link-a'").get(), { recipient_reference: null, amount_minor: null, sale_currency: null, revision: 0 });
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
    assert.equal(first.customMessage, null);
    assert.equal(sqlite.prepare("SELECT redeemed_at FROM content_download_links WHERE id='link-a'").get().redeemed_at, null);
    const row = sqlite.prepare("SELECT token_hash,session_token_hash FROM content_download_links WHERE id='link-a'").get();
    assert.notEqual(row.token_hash, token);
    assert.equal(row.session_token_hash, null);
    assert.equal(Object.hasOwn(first, "recipientReference"), false);
    assert.equal(Object.hasOwn(first, "amountMinor"), false);
  } finally { sqlite.close(); }
});

test("manual sale fields stay private and support scoped corrections, clearing, voiding, and stale-write rejection", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB, { recipientReference: "  buyer-42  ", saleAmount: "12.50", saleCurrency: "AUD" });
    const sale = await getDownloadSales(DB, { actor, assetId: "asset-a" });
    assert.equal(sale.rows[0].recipientReference, "buyer-42");
    assert.deepEqual(sale.totals, [{ currency: "AUD", amountMinor: 1250, paidCount: 1, complimentaryCount: 0 }]);
    assert.equal(Object.hasOwn(await inspectContentDownloadLink(DB, { token, now }), "amountMinor"), false);
    await claimContentDownloadLink(DB, { token, sessionToken: session, now });
    assert.equal(Object.hasOwn(await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now }), "recipientReference"), false);
    assert.equal(await updateDownloadSale(DB, { actor, linkId: "link-a", expectedRevision: 0, operation: "clear_recipient", now }), true);
    assert.equal(await updateDownloadSale(DB, { actor, linkId: "link-a", expectedRevision: 0, operation: "save", recipientReference: "restored", saleAmount: "12.50", saleCurrency: "AUD", now }), false);
    const cleared = await getDownloadSales(DB, { actor, assetId: "asset-a" });
    assert.equal(cleared.rows[0].recipientReference, null);
    assert.equal(cleared.rows[0].amountMinor, 1250);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM content_download_sale_audit WHERE instr(actor,'buyer-42')>0 OR instr(event_type,'buyer-42')>0").get().n, 0);
    assert.equal(await updateDownloadSale(DB, { actor, linkId: "link-a", expectedRevision: 1, operation: "void", now }), true);
    assert.deepEqual((await getDownloadSales(DB, { actor, assetId: "asset-a" })).totals, []);
    assert.equal(await updateDownloadSale(DB, { actor, linkId: "link-a", expectedRevision: 2, operation: "save", recipientReference: "corrected", saleAmount: "15.00", saleCurrency: "AUD", now }), true);
    const savedVoided = (await getDownloadSales(DB, { actor, assetId: "asset-a" })).rows[0];
    assert.equal(savedVoided.voidedAt, now);
    assert.equal(savedVoided.amountMinor, 1500);
    assert.deepEqual((await getDownloadSales(DB, { actor, assetId: "asset-a" })).totals, []);
    assert.equal(await updateDownloadSale(DB, { actor: { creatorId: "creator-a", email: "viewer@example.test" }, linkId: "link-a", expectedRevision: 3, operation: "clear_recipient", now }), false);
    assert.equal(await updateDownloadSale(DB, { actor: { creatorId: "creator-b", email: "other@example.test" }, linkId: "link-a", expectedRevision: 3, operation: "clear_recipient", now }), false);
    for (const deniedActor of [
      { creatorId: "creator-a", email: "viewer@example.test" },
      { creatorId: "creator-b", email: "other@example.test" },
      { creatorId: "creator-a", email: "inactive@example.test" },
    ]) assert.deepEqual(await getDownloadSales(DB, { actor: deniedActor, assetId: "asset-a" }), { rows: [], totals: [], nextOffset: null });
  } finally { sqlite.close(); }
});

test("sale history pages all recipient records while totals include every page", async () => {
  const { sqlite, DB } = fixture();
  try {
    for (let index = 0; index < 51; index++) {
      await create(DB, { id: `sale-${index}`, token: index.toString(16).padStart(64, "0"), recipientReference: `buyer-${index}`, saleAmount: "0", saleCurrency: "JPY" });
    }
    const first = await getDownloadSales(DB, { actor, assetId: "asset-a" });
    assert.equal(first.rows.length, 50);
    assert.equal(first.nextOffset, 50);
    assert.deepEqual(first.totals, [{ currency: "JPY", amountMinor: 0, paidCount: 0, complimentaryCount: 51 }]);
    const second = await getDownloadSales(DB, { actor, assetId: "asset-a", offset: first.nextOffset });
    assert.equal(second.rows.length, 1);
    assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.recipientReference)).size, 51);
    assert.equal(second.nextOffset, null);
    await create(DB, { id: "sale-usd", token: "f".repeat(64), recipientReference: "usd-buyer", saleAmount: "2.25", saleCurrency: "USD" });
    assert.deepEqual((await getDownloadSales(DB, { actor, assetId: "asset-a" })).totals, [
      { currency: "JPY", amountMinor: 0, paidCount: 0, complimentaryCount: 51 },
      { currency: "USD", amountMinor: 225, paidCount: 1, complimentaryCount: 0 },
    ]);
  } finally { sqlite.close(); }
});

test("voiding a sale leaves the download link usable", async () => {
  const { sqlite, DB } = fixture();
  try {
    const otherToken = "3".repeat(64);
    await create(DB, { token: otherToken, id: "link-void" });
    assert.equal(await updateDownloadSale(DB, { actor, linkId: "link-void", expectedRevision: 0, operation: "void", now }), true);
    assert.equal((await inspectContentDownloadLink(DB, { token: otherToken, now }))?.id, "link-void");
    assert.equal((await claimContentDownloadLink(DB, { token: otherToken, sessionToken: "4".repeat(64), now }))?.linkId, "link-void");
  } finally { sqlite.close(); }
});

test("sale mutations recheck the active actor grant in the update statement", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB, { recipientReference: "buyer", saleAmount: "1", saleCurrency: "AUD" });
    const racedDB = {
      prepare(sql) {
        const statement = DB.prepare(sql);
        return { bind(...values) {
          const bound = statement.bind(...values);
          return {
            async first() {
              const result = await bound.first();
              if (sql.includes("FROM creator_memberships") && result) sqlite.prepare("UPDATE creator_memberships SET status='suspended' WHERE creator_id='creator-a' AND user_email='creator@example.test'").run();
              return result;
            },
            all: () => bound.all(), run: () => bound.run(),
          };
        } };
      },
    };
    assert.equal(await updateDownloadSale(racedDB, { actor, linkId: "link-a", expectedRevision: 0, operation: "clear_recipient", now }), false);
    assert.equal(sqlite.prepare("SELECT recipient_reference,revision FROM content_download_links WHERE id='link-a'").get().recipient_reference, "buyer");
  } finally { sqlite.close(); }
});

test("custom messages normalize blanks, validate bounds, and persist through retrieval", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB, { customMessage: "  Please enjoy!  " });
    assert.equal((await inspectContentDownloadLink(DB, { token, now })).customMessage, "Please enjoy!");
    await claimContentDownloadLink(DB, { token, sessionToken: session, now });
    assert.equal((await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now })).customMessage, "Please enjoy!");
    for (const [index, value] of ["x".repeat(501), "bad\0message", 7, null].entries()) {
      await assert.rejects(create(DB, { id: `invalid-${index}`, token: `${index + 1}`.repeat(64).slice(0, 64), customMessage: value }), (error) => error instanceof ContentDownloadLinkError && error.code === "invalid_request");
    }
    await create(DB, { id: "blank", token: "f".repeat(64), customMessage: " \t\n" });
    assert.equal(sqlite.prepare("SELECT custom_message FROM content_download_links WHERE id='blank'").get().custom_message, null);
    await create(DB, { id: "boundary", token: "e".repeat(64), customMessage: "😀".repeat(250) });
    assert.equal(sqlite.prepare("SELECT length(custom_message) AS n FROM content_download_links WHERE id='boundary'").get().n, 250);
    assert.throws(() => sqlite.prepare("UPDATE content_download_links SET custom_message=? WHERE id='boundary'").run("x".repeat(501)));
    assert.throws(() => sqlite.prepare("UPDATE content_download_links SET custom_message=? WHERE id='boundary'").run("x\0y"));
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
    await assert.rejects(create(DB, { sharingConfirmed: false }), (error) => error instanceof ContentDownloadLinkError && error.code === "invalid_request");
    await assert.rejects(create(DB, { sharingConfirmed: "true" }), (error) => error instanceof ContentDownloadLinkError && error.code === "invalid_request");
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

test("review state, multiple creators and attached people remain server-side eligibility gates", async () => {
  const { sqlite, DB } = fixture();
  try {
    for (const update of [
      () => sqlite.prepare("UPDATE asset_classifications SET safety=NULL WHERE asset_id='asset-a'").run(),
      () => sqlite.prepare("UPDATE asset_classifications SET safety='nsfw',is_multi=1 WHERE asset_id='asset-a'").run(),
      () => { sqlite.prepare("UPDATE asset_classifications SET safety='nsfw',is_multi=0 WHERE asset_id='asset-a'").run(); sqlite.prepare("INSERT INTO asset_people VALUES ('asset-a','creator-a',1)").run(); },
    ]) {
      update();
      await assert.rejects(create(DB), (error) => error instanceof ContentDownloadLinkError && error.code === "not_eligible");
      sqlite.prepare("DELETE FROM asset_people WHERE asset_id='asset-a'").run();
      sqlite.prepare("UPDATE asset_classifications SET safety='nsfw',is_multi=0 WHERE asset_id='asset-a'").run();
    }
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


test("download branding uses only the owning creator's currently published approved public name", async () => {
  const { sqlite, DB } = fixture();
  try {
    await create(DB);
    const inspect = () => inspectContentDownloadLink(DB, { token, now });
    assert.equal((await inspect()).creatorName, null);
    sqlite.exec(`INSERT INTO creator_public_profiles VALUES ('profile-a','creator-a','active','version-a');
      INSERT INTO creator_public_profile_versions VALUES ('version-a','profile-a','creator-a','published','admin','2026-10-01','Public stage name');`);
    assert.equal((await inspect()).creatorName, 'Public stage name');
    for (const change of [
      "UPDATE creator_public_profiles SET status='paused'",
      "UPDATE creator_public_profile_versions SET status='draft'",
      "UPDATE creator_public_profile_versions SET approved_at=NULL",
      "UPDATE creator_public_profile_versions SET approved_by=NULL",
      "UPDATE creator_public_profile_versions SET creator_id='creator-b'",
      "UPDATE creator_public_profile_versions SET profile_id='foreign-profile'",
      "UPDATE creator_public_profiles SET published_version_id='missing-version'",
    ]) {
      sqlite.exec(change);
      assert.equal((await inspect()).creatorName, null);
      sqlite.exec("UPDATE creator_public_profiles SET status='active',published_version_id='version-a'; UPDATE creator_public_profile_versions SET status='published',approved_by='admin',approved_at='2026-10-01',creator_id='creator-a',profile_id='profile-a';");
    }
    await claimContentDownloadLink(DB, { token, sessionToken: session, now });
    assert.equal((await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now })).creatorName, 'Public stage name');
    sqlite.exec("UPDATE creator_public_profiles SET status='paused'");
    assert.equal((await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now })).creatorName, null);
    await revokeContentDownloadLink(DB, { actor, linkId: 'link-a', now });
    assert.equal(await inspect(), null);
    assert.equal(await getContentDownloadSession(DB, { linkToken: token, sessionToken: session, now }), null);
  } finally { sqlite.close(); }
});
