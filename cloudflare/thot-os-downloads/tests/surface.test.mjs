import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import test from "node:test";
import worker from "../src/index.ts";

const token = "a".repeat(64);
const hash = (value) => createHash("sha256").update(value).digest("hex");

function d1(db) {
  return { prepare(sql) { return { bind(...params) { return {
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
  }; } }; } };
}

function environment({ byteCount = 10, creatorName, customMessage } = {}) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE creators(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE users(email TEXT PRIMARY KEY,status TEXT); CREATE TABLE creator_memberships(creator_id TEXT,user_email TEXT,status TEXT,role TEXT);
    CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,source_available INTEGER); CREATE TABLE asset_storage_objects(id TEXT PRIMARY KEY,creator_id TEXT,asset_id TEXT,provider TEXT,storage_role TEXT,bucket_role TEXT,ingest_status TEXT,object_key TEXT,byte_count INTEGER,verified_mime_type TEXT,sha256 TEXT,r2_version TEXT,r2_etag TEXT);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,canonical_storage_object_id TEXT,state TEXT); CREATE TABLE asset_video_playback_states(asset_id TEXT,creator_id TEXT,canonical_storage_object_id TEXT,state TEXT); CREATE TABLE asset_classifications(asset_id TEXT,creator_id TEXT,safety TEXT,is_multi INTEGER); CREATE TABLE asset_people(creator_id TEXT,asset_id TEXT);
    CREATE TABLE creator_public_profiles(id TEXT PRIMARY KEY,creator_id TEXT,status TEXT,published_version_id TEXT); CREATE TABLE creator_public_profile_versions(id TEXT PRIMARY KEY,profile_id TEXT,creator_id TEXT,status TEXT,approved_by TEXT,approved_at TEXT,display_name TEXT);
    CREATE TABLE content_download_links(id TEXT PRIMARY KEY,creator_id TEXT,asset_id TEXT,storage_object_id TEXT,title TEXT,custom_message TEXT,object_key TEXT,byte_count INTEGER,mime_type TEXT,sha256 TEXT,r2_version TEXT,r2_etag TEXT,token_hash TEXT,expires_at TEXT,redeemed_at TEXT,session_id TEXT,session_token_hash TEXT,session_expires_at TEXT,revoked_at TEXT,created_by TEXT,created_at TEXT);`);
  db.exec("INSERT INTO creators VALUES ('c','active'); INSERT INTO users VALUES ('owner@example.test','active'); INSERT INTO creator_memberships VALUES ('c','owner@example.test','active','creator'); INSERT INTO assets VALUES ('a','c',1); INSERT INTO asset_media_authorities VALUES ('a','c','r2_native','o','canonical_verified'); INSERT INTO asset_video_playback_states VALUES ('a','c','o','playback_ready'); INSERT INTO asset_classifications VALUES ('a','c','sfw',0);");
  db.prepare("INSERT INTO asset_storage_objects VALUES ('o','c','a','r2','canonical_original','library_media','verified','private/video',?,'video/mp4',?,'v1','e1')").run(byteCount, "a".repeat(64));
  db.prepare("INSERT INTO content_download_links(id,creator_id,asset_id,storage_object_id,title,object_key,byte_count,mime_type,sha256,r2_version,r2_etag,token_hash,expires_at,created_by,created_at) VALUES ('l','c','a','o','Safe title','private/video',?,'video/mp4',?,?,?, ?,datetime('now','+1 day'),'owner@example.test',CURRENT_TIMESTAMP)").run(byteCount, "a".repeat(64), "v1", "e1", hash(token));
  if (creatorName !== undefined) {
    db.prepare("INSERT INTO creator_public_profiles VALUES ('p','c','active','pv')").run();
    db.prepare("INSERT INTO creator_public_profile_versions VALUES ('pv','p','c','published','owner@example.test',CURRENT_TIMESTAMP,?)").run(creatorName);
  }
  if (customMessage !== undefined) db.prepare("UPDATE content_download_links SET custom_message=?").run(customMessage);
  const bytes = new TextEncoder().encode("0123456789"); const calls = []; let identity = { size: byteCount, version: "v1", etag: "e1" };
  return { db, calls, setIdentity: (value) => { identity = value; }, env: { ENABLED: "true", DB: d1(db), LIBRARY_MEDIA: { head: async () => identity, get: async (_key, options = {}) => { calls.push(options); const range = options.range; const body = range ? bytes.slice(range.offset, range.offset + range.length) : bytes; return { ...identity, body: new Blob([body]) }; } } } };
}

test("metadata never redeems; same-origin POST creates a scoped session and download supports resume", async () => {
  const { env, db, calls } = environment(); const link = `https://downloads.test/d/${token}`;
  const page = await worker.fetch(new Request(link), env);
  assert.equal(page.headers.get("referrer-policy"), "same-origin", "same-origin form POST must retain its Origin; external requests receive no referrer");
  const body = await page.text();
  assert.equal(page.status, 200); assert.match(page.headers.get("content-security-policy"), /style-src 'self'/); assert.match(body, /Download link expires/); assert.match(body, /Safe title/); assert.equal(db.prepare("SELECT redeemed_at FROM content_download_links").get().redeemed_at, null);
  const css = await worker.fetch(new Request("https://downloads.test/download.css"), env);
  assert.equal(css.status, 200); assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8"); assert.equal(css.headers.get("cache-control"), "no-store"); assert.match(await css.text(), /:focus-visible/);
  const redeemed = await worker.fetch(new Request(link, { method: "POST", headers: { origin: "https://downloads.test", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env);
  assert.equal(redeemed.status, 303); const cookie = redeemed.headers.get("set-cookie"); assert.match(cookie, /HttpOnly; SameSite=Strict; Secure/); assert.match(cookie, new RegExp(`Path=/d/${token};`));
  assert.match(await (await worker.fetch(new Request(link, { headers: { cookie } }), env)).text(), /Resume download/);
  const download = await worker.fetch(new Request(`${link}/download`, { headers: { cookie } }), env);
  assert.equal(download.status, 200); assert.equal(await download.text(), "0123456789");
  const resumed = await worker.fetch(new Request(`${link}/download`, { headers: { cookie, range: "bytes=4-7" } }), env);
  assert.equal(resumed.status, 206); assert.equal(await resumed.text(), "4567"); assert.deepEqual(calls.at(-1).range, { offset: 4, length: 4 });
});

test("optional creator name is escaped and resume expiry is labeled as a session", async () => {
  const { env } = environment({ creatorName: `<img src=x onerror="alert(1)">` }); const link = `https://downloads.test/d/${token}`;
  const page = await worker.fetch(new Request(link), env); const body = await page.text();
  assert.match(body, /Shared by &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(body, /<img src=x/);
  const redemption = await worker.fetch(new Request(link, { method: "POST", headers: { origin: "https://downloads.test", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env);
  const resumed = await worker.fetch(new Request(link, { headers: { cookie: redemption.headers.get("set-cookie") } }), env);
  assert.match(await resumed.text(), /Resume session expires/);
});

test("wrong token, revoked links, and cross-origin redemption do not expose the object", async () => {
  const { env, db } = environment(); const link = `https://downloads.test/d/${token}`;
  const forbidden = await worker.fetch(new Request(link, { method: "POST", headers: { origin: "https://elsewhere.test", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env);
  assert.equal(forbidden.status, 403); assert.equal(db.prepare("SELECT redeemed_at FROM content_download_links").get().redeemed_at, null);
  for (const origin of ["null", ""]) {
    assert.equal((await worker.fetch(new Request(link, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env)).status, 403);
  }
  const redemption = await worker.fetch(new Request(link, { method: "POST", headers: { origin: "https://downloads.test", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env);
  const cookie = redemption.headers.get("set-cookie");
  assert.equal((await worker.fetch(new Request(`https://downloads.test/d/${"b".repeat(64)}/download`, { headers: { cookie } }), env)).status, 404);
  db.exec("UPDATE content_download_links SET revoked_at=CURRENT_TIMESTAMP");
  assert.equal((await worker.fetch(new Request(`${link}/download`, { headers: { cookie } }), env)).status, 404);
});

test("a changed R2 identity is rejected before its body is read", async () => {
  const { env, setIdentity, calls } = environment(); const link = `https://downloads.test/d/${token}`;
  const redemption = await worker.fetch(new Request(link, { method: "POST", headers: { origin: "https://downloads.test", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env);
  setIdentity({ size: 10, version: "changed", etag: "e1" });
  assert.equal((await worker.fetch(new Request(`${link}/download`, { headers: { cookie: redemption.headers.get("set-cookie") } }), env)).status, 404);
  assert.equal(calls.length, 0);
});

test("the worker fails closed unless explicitly enabled", async () => {
  const { env, db, calls } = environment(); env.ENABLED = "false";
  assert.equal((await worker.fetch(new Request(`https://downloads.test/d/${token}`, { method: "POST", headers: { origin: "https://downloads.test", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env)).status, 404);
  assert.equal(db.prepare("SELECT redeemed_at FROM content_download_links").get().redeemed_at, null);
  assert.equal(calls.length, 0);
});

test("large objects pass each resume range directly to R2 without buffering", async () => {
  const byteCount = 5 * 1024 * 1024 * 1024 + 17;
  const { env, calls } = environment({ byteCount }); const link = `https://downloads.test/d/${token}`;
  const redemption = await worker.fetch(new Request(link, { method: "POST", headers: { origin: "https://downloads.test", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env);
  const cookie = redemption.headers.get("set-cookie");
  for (const [value, range] of [["bytes=0-1048575", { offset: 0, length: 1048576 }], [`bytes=${byteCount - 3}-${byteCount - 1}`, { offset: byteCount - 3, length: 3 }]]) {
    const response = await worker.fetch(new Request(`${link}/download`, { headers: { cookie, range: value } }), env);
    assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), `bytes ${range.offset}-${range.offset + range.length - 1}/${byteCount}`);
  }
  assert.deepEqual(calls.map((call) => call.range), [{ offset: 0, length: 1048576 }, { offset: byteCount - 3, length: 3 }]);
});


test("recipient message is escaped and disappears with unavailable link or session", async () => {
  const { env, db } = environment({ customMessage: '<script>alert("private-message")</script>\nThanks for watching' });
  try {
    const url = `https://downloads.test/d/${token}`;
    const page = await (await worker.fetch(new Request(url), env)).text();
    assert.match(page, /&lt;script&gt;alert\(&quot;private-message&quot;\)&lt;\/script&gt;\nThanks for watching/);
    assert.doesNotMatch(page, /<script>/);
    db.exec("UPDATE content_download_links SET expires_at=datetime('now','-1 day')");
    const expired = await worker.fetch(new Request(url), env);
    assert.equal(expired.status, 404); assert.doesNotMatch(await expired.text(), /private-message/);
    db.exec("UPDATE content_download_links SET expires_at=datetime('now','+1 day')");
    const claim = await worker.fetch(new Request(url, { method: 'POST', headers: { origin:'https://downloads.test', 'content-type':'application/x-www-form-urlencoded' }, body:'intent=download' }), env);
    const cookie = claim.headers.get('set-cookie');
    assert.match(await (await worker.fetch(new Request(url, { headers:{cookie} }), env)).text(), /Thanks for watching/);
    const stranger = await worker.fetch(new Request(url), env);
    assert.equal(stranger.status,404); assert.doesNotMatch(await stranger.text(), /private-message/);
    db.exec("UPDATE content_download_links SET revoked_at=CURRENT_TIMESTAMP");
    const revoked = await worker.fetch(new Request(url, { headers:{cookie} }), env);
    assert.equal(revoked.status,404); assert.doesNotMatch(await revoked.text(), /private-message/);
  } finally { db.close(); }
});
