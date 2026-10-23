import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { latestInstagramResultsSql, useEventsSql } from "../src/lib/asset-use-query.ts";
import { assetUseSummary, safePostUrl, useLabel } from "../src/lib/asset-use-summary.ts";

function database() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE social_posts(id TEXT,creator_id TEXT,asset_id TEXT,status TEXT,platform TEXT,account_id TEXT,community_id INTEGER,published_at TEXT,scheduled_at TEXT,created_at TEXT,external_post_id TEXT,external_url TEXT);
    CREATE TABLE operational_accounts(id TEXT,creator_id TEXT,label TEXT);
    CREATE TABLE reddit_communities(id INTEGER,creator_id TEXT,name TEXT);
    CREATE TABLE vault_upload_jobs(id TEXT,creator_id TEXT,asset_id TEXT,status TEXT,platform TEXT,account_id TEXT,completed_at TEXT,created_at TEXT);
    CREATE TABLE creator_portfolio_release_versions(id TEXT,creator_id TEXT,manifest_json TEXT,status TEXT,published_at TEXT,approved_at TEXT);
    CREATE TABLE creator_profile_library_photo_selections(id TEXT,creator_id TEXT,surface TEXT,public_profile_version_id TEXT,adult_profile_version_id TEXT,derivative_id TEXT,created_at TEXT);
    CREATE TABLE creator_profile_library_photo_derivatives(id TEXT,creator_id TEXT,asset_id TEXT);
    CREATE TABLE creator_public_profiles(creator_id TEXT,published_version_id TEXT,status TEXT);
    CREATE TABLE creator_adult_profiles(creator_id TEXT,published_version_id TEXT,status TEXT);
    CREATE TABLE creator_public_media(id TEXT,creator_id TEXT,asset_id TEXT,status TEXT,created_at TEXT);
    CREATE TABLE creator_public_profile_versions(id TEXT,creator_id TEXT,avatar_media_id TEXT);
    CREATE TABLE creator_adult_profile_media(id TEXT,creator_id TEXT,profile_version_id TEXT,asset_id TEXT,enabled INTEGER,created_at TEXT);
    CREATE TABLE content_download_links(id TEXT,creator_id TEXT,asset_id TEXT,revoked_at TEXT,redeemed_at TEXT,expires_at TEXT,created_at TEXT);
    CREATE TABLE asset_destinations(asset_id TEXT,creator_id TEXT,destination TEXT);
    CREATE TABLE messaging_connections(id TEXT,creator_id TEXT,platform TEXT,display_name TEXT);
    CREATE TABLE message_threads(id TEXT,creator_id TEXT,connection_id TEXT);
    CREATE TABLE messages(id TEXT,creator_id TEXT,thread_id TEXT,external_message_id TEXT,direction TEXT,delivery_status TEXT,sent_at TEXT,created_at TEXT);
    CREATE TABLE message_attachments(id TEXT,creator_id TEXT,message_id TEXT,asset_id TEXT,status TEXT);
    CREATE TABLE instagram_media_metric_observations(id TEXT,creator_id TEXT,account_id TEXT,media_id TEXT,view_count INTEGER,like_count INTEGER,collected_at TEXT,source TEXT);
  `);
  return db;
}

test("asset-use query reads actual creator-scoped activity, not destination classifications", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO operational_accounts VALUES ('amber-ig','amber','Amber Instagram'),('coral-ig','coral','Coral Instagram')").run();
    db.prepare(`INSERT INTO social_posts VALUES
      ('amber-post','amber','shared-asset','published','instagram','amber-ig',NULL,'2026-10-22',NULL,'2026-10-22','media-amber','https://www.instagram.com/p/synthetic-amber/'),
      ('coral-post','coral','shared-asset','published','instagram','coral-ig',NULL,'2026-10-22',NULL,'2026-10-22','media-coral','https://www.instagram.com/p/synthetic-coral/')`).run();
    db.prepare("INSERT INTO vault_upload_jobs VALUES ('amber-vault','amber','shared-asset','verified','fansly',NULL,'2026-10-22','2026-10-22')").run();
    db.prepare("INSERT INTO asset_destinations VALUES ('tag-only','amber','reddit')").run();
    db.prepare("INSERT INTO messaging_connections VALUES ('amber-connection','amber','instagram','Amber inbox'),('coral-connection','coral','instagram','Coral inbox')").run();
    db.prepare("INSERT INTO message_threads VALUES ('amber-thread','amber','amber-connection'),('coral-thread','coral','coral-connection')").run();
    db.prepare("INSERT INTO messages VALUES ('amber-message','amber','amber-thread','provider-amber','outbound','sent','2026-10-22','2026-10-22'),('coral-message','coral','coral-thread','provider-coral','outbound','sent','2026-10-22','2026-10-22')").run();
    db.prepare("INSERT INTO message_attachments VALUES ('amber-attachment','amber','amber-message','shared-asset','ready'),('coral-attachment','coral','coral-message','shared-asset','ready')").run();
    db.prepare("INSERT INTO creator_portfolio_release_versions VALUES ('amber-release','amber',?,'published','2026-10-22','2026-10-22')")
      .run(JSON.stringify({ cards: [{ id: "card", assetId: "preview-asset", fullLengthAssetId: "private-full" }] }));
    db.prepare("INSERT INTO creator_profile_library_photo_derivatives VALUES ('derivative','amber','profile-photo')").run();
    db.prepare("INSERT INTO creator_profile_library_photo_selections VALUES ('photo-selection','amber','public_sfw','public-version',NULL,'derivative','2026-10-22')").run();
    db.prepare("INSERT INTO creator_public_profiles VALUES ('amber','public-version','active')").run();
    db.prepare("INSERT INTO content_download_links VALUES ('link','amber','private-full',NULL,'2026-10-22','2026-10-25','2026-10-21')").run();

    const rows = db.prepare(`WITH use_events AS (${useEventsSql}) SELECT asset_id,kind,status,role FROM use_events ORDER BY kind,id`).all({ creator: "amber" });
    assert.equal(rows.length, 7);
    assert.equal(rows.some((row) => row.asset_id === "tag-only"), false);
    assert.equal(rows.filter((row) => row.asset_id === "shared-asset").length, 3);
    assert.equal(rows.find((row) => row.kind === "message").status, "sent");
    assert.deepEqual(rows.filter((row) => row.kind === "portfolio").map((row) => [row.asset_id, row.role]).sort(), [
      ["preview-asset", "Public preview"], ["private-full", "Linked private full video"],
    ]);
    assert.equal(rows.find((row) => row.kind === "download_link").status, "redeemed");
    assert.equal(rows.find((row) => row.kind === "public_profile").asset_id, "profile-photo");
    const other = db.prepare(`WITH use_events AS (${useEventsSql}) SELECT asset_id,kind FROM use_events`).all({ creator: "coral" });
    assert.deepEqual(other.sort((a, b) => a.kind.localeCompare(b.kind)), [{ asset_id: "shared-asset", kind: "message" }, { asset_id: "shared-asset", kind: "social" }]);
  } finally { db.close(); }
});

test("summary keeps private references and incomplete receipts out of confirmed placements", () => {
  const event = (overrides) => ({ id: "1", asset_id: "asset", kind: "social", status: "published", destination: "instagram",
    account_label: null, role: null, occurred_at: "2026-10-22", external_id: "media", external_url: "https://www.instagram.com/p/synthetic/", ...overrides });
  const events = [
    event({ id: "verified", metrics: { views: 120, likes: 7, comments: null, saves: null, shares: null, collected_at: "2026-10-23T00:00:00Z" } }),
    event({ id: "incomplete", external_url: null }),
    event({ id: "unsafe", external_url: "javascript:alert(1)" }),
    event({ id: "private", kind: "portfolio", status: "published", role: "Linked private full video", destination: "More portfolio" }),
  ];
  const summary = assetUseSummary(events);
  assert.equal(summary.posted, 1);
  assert.equal(summary.onPage, 0);
  assert.match(summary.result, /120 views · 7 likes/);
  assert.match(useLabel(events[3]), /private video/);
  assert.equal(safePostUrl("instagram", "https://example.com/p/synthetic/"), null);
  const newer = event({ id: "newer", occurred_at: "2026-10-22", metrics: { views: 230, likes: null, comments: null, saves: null, shares: null, collected_at: "2026-10-23T02:00:00Z" } });
  assert.match(assetUseSummary([...events, newer]).result, /230 views/);
});

test("asset results match the exact creator, account and media ID", () => {
  const db = database();
  try {
    db.prepare("INSERT INTO operational_accounts VALUES ('amber-main','amber','Amber main'),('amber-other','amber','Amber other'),('coral-main','coral','Coral main')").run();
    db.prepare(`INSERT INTO social_posts VALUES
      ('amber-post','amber','asset','published','instagram','amber-main',NULL,'2026-10-22',NULL,'2026-10-22','shared-media','https://www.instagram.com/p/synthetic/'),
      ('coral-post','coral','asset','published','instagram','coral-main',NULL,'2026-10-22',NULL,'2026-10-22','shared-media','https://www.instagram.com/p/other/')`).run();
    db.prepare(`INSERT INTO instagram_media_metric_observations VALUES
      ('amber-good','amber','amber-main','shared-media',123,7,'2026-10-23 01:00:00','instagram_api'),
      ('amber-wrong-account','amber','amber-other','shared-media',9999,999,'2026-10-23 02:00:00','instagram_api'),
      ('coral-wrong-creator','coral','coral-main','shared-media',8888,888,'2026-10-23 03:00:00','instagram_api')`).run();
    const sql = latestInstagramResultsSql(1).replace("@creator", "?");
    assert.deepEqual(db.prepare(sql).all("amber", "asset"), [{ asset_id: "asset", view_count: 123, like_count: 7, collected_at: "2026-10-23 01:00:00" }]);
  } finally { db.close(); }
});
