import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import Database from "better-sqlite3";
import { handleBooking, purgeBookingReceipts } from "../src/booking.ts";
import contactWorker from "../../thot-os-public-contact/src/index.ts";
import { validateBookingConfig, validateBookingEnquiry, bookingLinks, bookingFieldNames } from "../../shared/booking-contract.ts";

const now = Date.parse("2026-09-28T02:00:00Z");
const token = "local-test-only-".repeat(4);
const config = { enabled: true, label: "Book an event", rules: "Be respectful.", wear: [{ id: "formal", label: "Formal", description: "Smart event attire." }], extras: [{ id: "games", label: "Party games", description: "Hosted games." }] };
const enquiry = { firstName: "Ava", lastName: "Example", phone: "+61400000001", email: "visitor@example.test", date: "2026-10-01", time: "18:30", timezone: "Australia/Perth", address: "12 Example Street", suburb: "Example suburb", guests: 10, occasion: "Birthday", wear: "formal", extras: ["games"], specialRequests: "Accessible entrance", consent: true, acknowledged: true };

async function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE creators(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE creator_public_profiles(id TEXT PRIMARY KEY,creator_id TEXT,slug TEXT,published_version_id TEXT,status TEXT);
    CREATE TABLE creator_public_profile_versions(id TEXT PRIMARY KEY,creator_id TEXT,display_name TEXT,status TEXT,approved_by TEXT,approved_at TEXT,UNIQUE(id,creator_id));
    CREATE TABLE creator_booking_configs(profile_version_id TEXT,creator_id TEXT,config_json TEXT);
    CREATE TABLE creator_public_contact_methods(creator_id TEXT,profile_version_id TEXT,channel TEXT,contact_value TEXT,enabled INTEGER);
    CREATE TABLE creator_profile_projection_deliveries(creator_id TEXT,profile_id TEXT,version_id TEXT,surface TEXT,action TEXT);
    CREATE TABLE service_principals(id TEXT,principal_name TEXT,status TEXT);
    CREATE TABLE service_principal_credentials(id TEXT,service_principal_id TEXT,token_hash TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE service_principal_creator_grants(service_principal_id TEXT,creator_id TEXT,status TEXT,capability TEXT);`);
  db.exec(readFileSync(new URL("../../thot-os-app/migrations/0062_booking_delivery_evidence.sql", import.meta.url), "utf8"));
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
  db.exec(`INSERT INTO creators VALUES('creator-a','active'),('creator-b','active');
    INSERT INTO creator_public_profiles VALUES('profile-a','creator-a','creator-a','version-a','active');
    INSERT INTO creator_public_profile_versions VALUES('version-a','creator-a','Creator A','published','operator@example.test','2026-09-01');
    INSERT INTO service_principals VALUES('principal','thot-os-public-contact','active');
    INSERT INTO service_principal_creator_grants VALUES('principal','creator-a','active','booking.enquiry.submit');
    INSERT INTO creator_public_contact_methods VALUES('creator-a','version-a','email','creator@example.test',1),('creator-a','version-a','sms','+61400000000',1);`);
  db.prepare("INSERT INTO service_principal_credentials VALUES('credential','principal',?,'active',NULL)").run(hash);
  db.prepare("INSERT INTO creator_booking_configs VALUES('version-a','creator-a',?)").run(JSON.stringify(config));
  const sent = [];
  const env = { BOOKING_ENQUIRIES_ENABLED: "true", EMAIL: { async send(message) { sent.push(message); } }, DB: {
    prepare(sql) {
      const statement = db.prepare(sql);
      let args = [];
      return { bind(...values) { args = values; return this; }, async first() { return statement.get(...args) ?? null; }, async run() { const result = statement.run(...args); return { success: true, meta: { changes: result.changes } }; } };
    },
  } };
  const payload = (override = {}) => ({ creatorId: "creator-a", slug: "creator-a", versionId: "version-a", submissionId: crypto.randomUUID(), issuedAt: now, enquiry, ...override });
  const request = (body, path = "submit", credential = token) => new Request(`https://private/booking/${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credential}`, "x-thot-os-service-capability": "booking.enquiry.submit" }, body: JSON.stringify(body) });
  return { db, env, sent, payload, request };
}

test("public custom-request form reaches private delivery once and rejects a withdrawn open form", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = await fixture(); t.after(() => f.db.close());
  const custom = validateBookingConfig({ ...config, fields: Object.fromEntries(bookingFieldNames.map(name => [name, { visible: name === "specialRequests", required: name === "specialRequests" }])) });
  f.db.prepare("UPDATE creator_booking_configs SET config_json=?").run(JSON.stringify(custom));
  const snapshot = { schemaVersion: 2, creator: { id: "creator-a", slug: "creator-a", displayName: "Creator A" }, versionId: "version-a", config: custom, channels: { sms: "+61400000000", email: "creator@example.test" } };
  const env = {
    CONTACT_PROFILES: { get: async () => snapshot }, CONTACT_EVENTS: { writeDataPoint() {} },
    BOOKING_SERVICE_TOKEN: token, BOOKING_FORM_SECRET: "synthetic-form-secret-".repeat(3),
    BOOKING_RATE_LIMITER: { limit: async () => ({ success: true }) },
    TURNSTILE_SECRET: "test-only", TURNSTILE_SITE_KEY: "test-only", TURNSTILE_EXPECTED_HOSTNAME: "contact.example",
    PUBLIC_LINKS_CONTROL: { fetch: (url, init) => handleBooking(new Request(url, init), f.env, now) },
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    return Response.json({ success: true, action: "booking", hostname: "contact.example" });
  });
  const url = "https://contact.example/book/creator-a";
  const form = async () => {
    const page = await contactWorker.fetch(new Request(url), env);
    assert.equal(page.status, 200);
    const html = await page.text(), data = new FormData();
    assert.doesNotMatch(html, /name="(?:date|address|phone)"|creator@example\.test/);
    for (const name of ["submissionId", "issuedAt", "signature"]) data.set(name, html.match(new RegExp(`name="${name}" value="([^"]+)"`))[1]);
    for (const [key, value] of Object.entries({ firstName: "Ava", lastName: "Example", email: "visitor@example.test", specialRequests: "A personalised birthday greeting", address: "Hidden injected address", consent: "yes", acknowledged: "yes", "cf-turnstile-response": "local-token" })) data.set(key, value);
    return data;
  };
  const submit = data => contactWorker.fetch(new Request(url, { method: "POST", headers: { origin: "https://contact.example", "cf-connecting-ip": "192.0.2.1" }, body: data }), env);
  const first = await form(), later = await form();
  const accepted = await submit(first);
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /Continue in WhatsApp/);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, "creator@example.test");
  assert.match(f.sent[0].text, /A personalised birthday greeting/);
  assert.doesNotMatch(f.sent[0].text, /Hidden injected address|Address:/);
  assert.equal((await submit(first)).status, 400);
  f.db.exec("INSERT INTO creator_profile_projection_deliveries VALUES('creator-a','profile-a','version-a','public_sfw','withdraw')");
  assert.equal((await submit(later)).status, 400);
  assert.equal((await contactWorker.fetch(new Request(url), env)).status, 404);
  assert.equal(f.sent.length, 1);
});

test("email resolves approved recipient; receipt excludes enquiry PII; duplicate never sends again", async (t) => {
  const f = await fixture(); t.after(() => f.db.close());
  const payload = f.payload({ recipient: "attacker@example.test" });
  const result = await handleBooking(f.request(payload), f.env, now);
  assert.equal(result.status, 200);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, "creator@example.test");
  assert.match(f.sent[0].text, /12 Example Street/);
  const links = await result.json();
  assert.match(links.whatsapp, /^https:\/\/wa.me\/61400000000/);
  assert.match(decodeURIComponent(decodeURIComponent(links.sms)), /12 Example Street/);
  assert.doesNotMatch(decodeURIComponent(links.sms), /Accessible entrance|visitor@example/);
  const receipt = f.db.prepare("SELECT * FROM creator_booking_receipts").get();
  assert.equal(receipt.state, "accepted");
  assert.doesNotMatch(JSON.stringify(receipt), /Example|visitor@|Street|614/);
  assert.equal((await handleBooking(f.request(payload), f.env, now)).status, 409);
  assert.equal(f.sent.length, 1);
  await purgeBookingReceipts(f.env, now + 604800000);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM creator_booking_receipts").get().n, 0);
  assert.equal((await handleBooking(f.request(payload), f.env, now + 604800000)).status, 400);
});

test("foreign creator, invalid credentials, stale version, withdrawal and disabled config fail closed", async (t) => {
  const f = await fixture(); t.after(() => f.db.close());
  assert.equal((await handleBooking(f.request(f.payload({ creatorId: "creator-b" })), f.env, now)).status, 401);
  assert.equal((await handleBooking(f.request(f.payload(), "submit", "wrong"), f.env, now)).status, 401);
  assert.equal((await handleBooking(f.request(f.payload({ versionId: "old" })), f.env, now)).status, 404);
  f.db.prepare("UPDATE creator_booking_configs SET config_json=?").run(JSON.stringify({ ...config, enabled: false }));
  assert.equal((await handleBooking(f.request(f.payload()), f.env, now)).status, 404);
  f.db.prepare("UPDATE creator_booking_configs SET config_json=?").run(JSON.stringify(config));
  f.db.exec("INSERT INTO creator_profile_projection_deliveries VALUES('creator-a','profile-a','version-a','public_sfw','withdraw')");
  assert.equal((await handleBooking(f.request(f.payload(), "check"), f.env, now)).status, 404);
  assert.equal((await handleBooking(f.request(f.payload()), f.env, now)).status, 404);
  assert.equal(f.sent.length, 0);
});

test("provider uncertainty reserves nonce; no automatic resend or draft disclosure", async (t) => {
  const f = await fixture(); t.after(() => f.db.close());
  f.env.EMAIL.send = async () => { throw new Error("provider timeout with private details"); };
  const body = f.payload();
  const result = await handleBooking(f.request(body), f.env, now);
  assert.equal(result.status, 502);
  assert.doesNotMatch(await result.text(), /private|sms|whatsapp/);
  assert.equal(f.db.prepare("SELECT state FROM creator_booking_receipts").get().state, "uncertain");
  assert.equal((await handleBooking(f.request(body), f.env, now)).status, 409);
});

test("concurrent same nonce sends once, creator-wide hourly limit caps fresh nonces", async (t) => {
  const f = await fixture(); t.after(() => f.db.close());
  const body = f.payload();
  const responses = await Promise.all([handleBooking(f.request(body), f.env, now), handleBooking(f.request(body), f.env, now)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  for (let i = 1; i < 20; i++) assert.equal((await handleBooking(f.request(f.payload()), f.env, now)).status, 200);
  assert.equal((await handleBooking(f.request(f.payload()), f.env, now)).status, 429);
  assert.equal(f.sent.length, 20);
});

test("bounded configuration and actual calendar dates, consent and configured selections are enforced", () => {
  assert.deepEqual(validateBookingConfig(config), config);
  assert.throws(() => validateBookingConfig({ ...config, wear: [config.wear[0], config.wear[0]] }));
  for (const change of [{ date: "2026-02-31" }, { time: "27:00" }, { timezone: "not/a-zone" }, { consent: false }, { acknowledged: false }, { extras: ["unknown"] }, { wear: "unknown" }, { guests: 1.5 }, { email: "user@example.test\r\nBcc: other@example.test" }]) {
    assert.throws(() => validateBookingEnquiry({ ...enquiry, ...change }, config, new Date(now)));
  }
  assert.throws(() => bookingLinks("javascript:alert(1)", "Creator", enquiry));
});

test("public projection contains only CTA; private projection is version-bound and disabling removes it", async () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const extract = (start, end) => stripTypeScriptTypes(source.slice(source.indexOf(start), source.indexOf(end)));
  const actions = new Function("configuredActionHref", "configuredFriendlyMoreHref", "adultProjectionIsEligible", `return (${extract("async function publicActions(", "async function copyPublicDisplayMedia(")})`)(() => "https://contact.example/book/creator-a", () => null, async () => false);
  const snapshot = new Function("publicDisplayMediaProjection", "publicActions", `return (${extract("async function toPublicSnapshot(", "async function writeContactProjection(")})`)(() => [], actions);
  const project = new Function("contactSnapshotKey", "configuredActionHref", `return (${extract("async function writeContactProjection(", "async function refreshCurrentPublicSnapshot(")})`)((slug) => `public-contact:${slug}`, () => "https://contact.example/book/creator-a");
  const writes = new Map();
  const env = { BOOKING_ENQUIRIES_ENABLED: "true", CONTACT_PROFILES: { async put(key, value) { writes.set(key, value); }, async delete(key) { writes.delete(key); } } };
  const profile = { creator_id: "creator-a", slug: "creator-a", version_id: "version-a", display_name: "Creator A", booking: config };
  const contacts = [{ channel: "sms", contact_value: "+61400000000" }, { channel: "email", contact_value: "creator@example.test" }];
  const safe = await snapshot(env, profile, [], contacts, []);
  assert.deepEqual(safe.actions, [{ id: "book", label: config.label, href: "https://contact.example/book/creator-a" }]);
  assert.doesNotMatch(JSON.stringify(safe), /61400000000|creator@example|Be respectful|Smart event attire/);
  await project(env, profile, contacts);
  const privateProjection = JSON.parse(writes.get("public-contact:creator-a"));
  assert.equal(privateProjection.versionId, "version-a");
  assert.equal(privateProjection.creator.id, "creator-a");
  assert.equal(privateProjection.channels.email, "creator@example.test");
  profile.booking = { ...config, enabled: false };
  await project(env, profile, contacts);
  assert.equal(writes.size, 0);
  assert.deepEqual((await snapshot(env, profile, [], contacts, [])).actions, []);
});
