import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Database from "better-sqlite3";
import { createAmaWorker } from "../src/index.mjs";
import publicWorker from "../../thot-os-public-links/src/index.ts";

const migration = new URL("./schema.sql", import.meta.url);
const origin = "https://www.thathuboverthere.com";

function d1(db) {
  return { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; } };
  } };
}

function b64(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function accessFixture() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const kid = crypto.randomUUID();
  const jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid };
  async function token(email, { expires = Math.floor(Date.now() / 1000) + 3600, aud = "ama-fixture", sign = true } = {}) {
    const head = b64({ alg: "RS256", kid });
    const body = b64({ aud, iss: "https://access.example.test", email, exp: expires });
    const signature = sign ? Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`))).toString("base64url") : b64("forged");
    return `${head}.${body}.${signature}`;
  }
  return { token, fetchJwks: async () => Response.json({ keys: [jwk] }) };
}

async function setup(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE users(email TEXT PRIMARY KEY COLLATE NOCASE,status TEXT NOT NULL);
    CREATE TABLE creator_memberships(creator_id TEXT NOT NULL,user_email TEXT NOT NULL COLLATE NOCASE,role TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE creator_public_profiles(id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,slug TEXT NOT NULL,status TEXT NOT NULL,published_version_id TEXT);
    CREATE TABLE creator_public_profile_versions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,creator_id TEXT NOT NULL,status TEXT NOT NULL,approved_by TEXT);
  `);
  db.exec(await readFile(migration, "utf8"));
  db.prepare("INSERT INTO creators VALUES (?,?,?)").run("a", "Creator A", "active");
  db.prepare("INSERT INTO creators VALUES (?,?,?)").run("b", "Creator B", "active");
  for (const [email, creator, role] of [["a@example.test", "a", "creator"], ["b@example.test", "b", "creator"], ["viewer@example.test", "a", "viewer"], ["suspended@example.test", "a", "creator"]]) {
    db.prepare("INSERT INTO users VALUES (?,?)").run(email, email.startsWith("suspended") ? "suspended" : "active");
    db.prepare("INSERT INTO creator_memberships VALUES (?,?,?,?)").run(creator, email, role, "active");
  }
  db.prepare("INSERT INTO ama_questions(id,creator_id,question_text,source) VALUES (?,?,?,?)").run("q-a", "a", "A question <script>alert(1)</script>?", "import");
  db.prepare("INSERT INTO ama_questions(id,creator_id,question_text,source) VALUES (?,?,?,?)").run("q-a2", "a", "Second A question", "import");
  db.prepare("INSERT INTO ama_questions(id,creator_id,question_text,source) VALUES (?,?,?,?)").run("q-b", "b", "B private question", "import");
  db.prepare("INSERT INTO creator_public_profiles VALUES (?,?,?,?,?)").run("profile-a", "a", "adelaide", "active", "profile-version-1");
  db.prepare("INSERT INTO creator_public_profile_versions VALUES (?,?,?,?,?)").run("profile-version-1", "profile-a", "a", "published", "a@example.test");
  db.prepare("INSERT INTO creator_public_profiles VALUES (?,?,?,?,?)").run("profile-b", "b", "bella", "active", "profile-version-b");
  db.prepare("INSERT INTO creator_public_profile_versions VALUES (?,?,?,?,?)").run("profile-version-b", "profile-b", "b", "published", "b@example.test");
  const keys = await accessFixture();
  const publicKv = new Map([
    ["public-profile:adelaide", { schemaVersion: 1, publishedVersionId: "profile-version-1", creator: { slug: "adelaide", displayName: "Creator A", headline: "", bio: "" }, links: [] }],
    ["public-profile:bella", { schemaVersion: 1, publishedVersionId: "profile-version-b", creator: { slug: "bella", displayName: "Creator B", headline: "", bio: "" }, links: [] }],
  ]);
  const usedChallenges = new Set();
  const worker = createAmaWorker({ fetchJwks: keys.fetchJwks, verifyChallenge: async (token) => {
    if (!token.startsWith("fixture-") || usedChallenges.has(token)) return false;
    usedChallenges.add(token); return true;
  } });
  const env = { DB: d1(db), ACCESS_AUD: "ama-fixture", ACCESS_ISSUER: "https://access.example.test", ACCESS_JWKS_URL: "https://access.example.test/certs", PUBLIC_ORIGIN: origin, TURNSTILE_SECRET: "fixture-only" };
  const publicEnv = { LIVE_PUBLIC_CREATOR_SLUGS: "adelaide,bella", PUBLIC_LINKS: { get: async (key) => publicKv.get(key) ?? null }, LINK_EVENTS: { writeDataPoint() {} },
    AMA_SERVICE: { fetch: (input, init) => worker.fetch(new Request(input, init), env) }, AMA_TURNSTILE_SITE_KEY: "fixture-site-key",
    AMA_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  async function get(path, email, extra = {}) {
    const headers = email ? { "cf-access-jwt-assertion": await keys.token(email, extra) } : {};
    return worker.fetch(new Request(origin + path, { headers }), env);
  }
  async function post(path, email, answer, expected = "0", other = {}) {
    const headers = { "cf-access-jwt-assertion": await keys.token(email), origin, ...other };
    return worker.fetch(new Request(origin + path, { method: "POST", headers, body: new URLSearchParams({ answer, expected_revision: expected }) }), env);
  }
  return { db, get, post, worker, env, keys, publicKv, publicEnv };
}

test("local schema keeps questions and immutable answer revisions inside one creator", async (t) => {
  const { db } = await setup(t);
  assert.throws(() => db.prepare("INSERT INTO ama_answer_revisions(id,question_id,creator_id,revision,answer_text,author_email) VALUES ('bad','q-b','a',1,'Wrong owner','a@example.test')").run(), /FOREIGN KEY constraint failed/);
  db.prepare("INSERT INTO ama_answer_revisions(id,question_id,creator_id,revision,answer_text,author_email) VALUES ('rev-a','q-a','a',1,'Private answer','a@example.test')").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ama_audit_events WHERE creator_id='a' AND event_type='draft_saved'").get().count, 1);
  assert.throws(() => db.prepare("DELETE FROM ama_questions WHERE id='q-a'").run(), /FOREIGN KEY constraint failed/);
  assert.throws(() => db.prepare("UPDATE ama_answer_revisions SET answer_text='changed' WHERE id='rev-a'").run(), /ama_revision_immutable/);
  assert.throws(() => db.prepare("DELETE FROM ama_audit_events WHERE revision_id='rev-a'").run(), /ama_audit_immutable/);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='ama_audit_events'").get().sql.includes("answer_text"), false);
  assert.equal(db.pragma("quick_check", { simple: true }), "ok");
});

test("private inbox verifies Access and hides foreign creator content", async (t) => {
  const { get } = await setup(t);
  assert.equal((await get("/dashboard/ama", null)).status, 404);
  assert.equal((await get("/dashboard/ama/styles.css", null)).status, 404);
  assert.equal((await get("/dashboard/ama/styles.css", "a@example.test")).status, 200);
  for (const options of [{ sign: false }, { expires: 1 }, { aud: "wrong" }]) assert.equal((await get("/dashboard/ama", "a@example.test", options)).status, 404);
  assert.equal((await get("/dashboard/ama", "suspended@example.test")).status, 404);
  const page = await get("/dashboard/ama", "a@example.test");
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /A question &lt;script&gt;/);
  assert.doesNotMatch(html, /B private question|<script>/);
  assert.equal(page.headers.get("cache-control"), "private, no-store");
  assert.equal((await get("/dashboard/ama/q-b", "a@example.test")).status, 404);
  assert.equal((await get("/dashboard/ama/q-b", "b@example.test")).status, 200);
  assert.equal((await get("/dashboard/ama/public", "a@example.test")).status, 404);
});

test("viewer is read only; creator saves a scoped private draft with replay protection", async (t) => {
  const { db, get, post, worker, env, keys } = await setup(t);
  const viewerPage = await (await get("/dashboard/ama/q-a", "viewer@example.test")).text();
  assert.match(viewerPage, /View only/);
  assert.doesNotMatch(viewerPage, /<form/);
  assert.equal((await post("/dashboard/ama/q-a/draft", "viewer@example.test", "Viewer answer")).status, 404);
  assert.equal((await post("/dashboard/ama/q-b/draft", "a@example.test", "Foreign answer")).status, 409);
  const badOrigin = await worker.fetch(new Request(`${origin}/dashboard/ama/q-a/draft`, { method: "POST", headers: { "cf-access-jwt-assertion": await keys.token("a@example.test"), origin: "https://attacker.example" }, body: new URLSearchParams({ answer: "Bad", expected_revision: "0" }) }), env);
  assert.equal(badOrigin.status, 403);
  const saved = await post("/dashboard/ama/q-a/draft", "a@example.test", "A private answer");
  assert.equal(saved.status, 303);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ama_answer_revisions").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ama_audit_events").get().count, 1);
  assert.equal((await post("/dashboard/ama/q-a/draft", "a@example.test", "Duplicate", "0")).status, 409);
  const answered = await (await get("/dashboard/ama?queue=answered", "a@example.test")).text();
  assert.match(answered, /A question/);
  assert.doesNotMatch(answered, /B private question/);
  const newQueue = await (await get("/dashboard/ama?queue=new", "a@example.test")).text();
  assert.doesNotMatch(newQueue, /A question &lt;script/);
  const detail = await (await get("/dashboard/ama/q-a", "a@example.test")).text();
  assert.match(detail, /A private answer/);
  assert.match(detail, /expected_revision" value="1"/);
  assert.equal((await post("/dashboard/ama/q-a/draft", "a@example.test", "Updated private answer", "1")).status, 303);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ama_answer_revisions").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ama_audit_events").get().count, 2);
  assert.equal(db.prepare("SELECT answer_text FROM ama_answer_revisions WHERE revision=1").get().answer_text, "A private answer");
});

test("creator can reach older questions through inbox pages", async (t) => {
  const { db, get } = await setup(t);
  const insert = db.prepare("INSERT INTO ama_questions(id,creator_id,question_text,source,received_at) VALUES (?,?,?,?,?)");
  for (let index = 0; index < 50; index++) insert.run(`new-${index}`, "a", `New question ${index}`, "import", "2026-10-19 12:00:00");
  const first = await (await get("/dashboard/ama?queue=new", "a@example.test")).text();
  assert.match(first, /page=2/);
  assert.doesNotMatch(first, /A question &lt;script&gt;/);
  const second = await (await get("/dashboard/ama?queue=new&page=2", "a@example.test")).text();
  assert.match(second, /A question &lt;script&gt;/);
  assert.doesNotMatch(second, /B private question/);
});

async function action(fixture, questionId, name, fields, email = "a@example.test") {
  return fixture.worker.fetch(new Request(`${origin}/dashboard/ama/${questionId}/${name}`, {
    method: "POST", headers: { "cf-access-jwt-assertion": await fixture.keys.token(email), origin }, body: new URLSearchParams(fields),
  }), fixture.env);
}

async function ask(fixture, slug, fields, headers = {}) {
  return publicWorker.fetch(new Request(`${origin}/${slug}/ama/ask`, {
    method: "POST", headers: { origin, "cf-connecting-ip": "192.0.2.10", ...headers },
    body: new URLSearchParams({ question: "Could this be answered?", acknowledge: "yes", website: "", "cf-turnstile-response": "fixture-one", ...fields }),
  }), fixture.publicEnv);
}

test("public form stores a bounded, verified question only in the selected creator inbox", async (t) => {
  const f = await setup(t);
  const page = await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), f.publicEnv);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const html = await page.text();
  assert.match(html, /Ask a question/);
  assert.match(html, /cf-turnstile/);
  assert.doesNotMatch(html, /A question &lt;script|B private question/);
  assert.equal((await ask(f, "adelaide", {}, { origin: "https://bad.example" })).status, 403);
  assert.equal((await ask(f, "adelaide", { website: "spam" })).status, 400);
  assert.equal((await ask(f, "adelaide", { question: "x".repeat(801) })).status, 400);
  assert.equal((await ask(f, "adelaide", { "cf-turnstile-response": "bad" })).status, 403);
  const sent = await ask(f, "adelaide", { question: "Can <script> this be answered?" });
  assert.equal(sent.status, 303);
  assert.equal(sent.headers.get("location"), "/adelaide/ama?sent=1");
  assert.equal((await ask(f, "adelaide", { question: "Replay" })).status, 403);
  const row = f.db.prepare("SELECT creator_id,question_text,source FROM ama_questions WHERE source='public'").get();
  assert.deepEqual(row, { creator_id: "a", question_text: "Can <script> this be answered?", source: "public" });
  assert.match(await (await f.get("/dashboard/ama", "a@example.test")).text(), /Can &lt;script&gt; this be answered/);
  assert.doesNotMatch(await (await f.get("/dashboard/ama", "b@example.test")).text(), /Can &lt;script&gt;/);
  assert.doesNotMatch(await (await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), f.publicEnv)).text(), /Can &lt;script&gt;/);
  assert.equal((await ask(f, "bella", { question: "A question for B", "cf-turnstile-response": "fixture-two" })).status, 303);
  assert.equal(f.db.prepare("SELECT creator_id FROM ama_questions WHERE question_text='A question for B'").get().creator_id, "b");
  assert.equal((await ask(f, "unknown", { "cf-turnstile-response": "fixture-three" })).status, 404);
});

test("rate limit and missing service fail closed before an intake write", async (t) => {
  const f = await setup(t);
  f.publicEnv.AMA_RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await ask(f, "adelaide", {})).status, 429);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ama_questions WHERE source='public'").get().n, 0);
  delete f.publicEnv.AMA_SERVICE;
  assert.equal((await ask(f, "adelaide", {})).status, 503);
  assert.equal((await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), f.publicEnv)).status, 404);
  assert.equal((await f.worker.fetch(new Request(`${origin}/internal/ama/public/adelaide`), f.env)).status, 404);
});

test("creator draft stays private until explicit SFW publish, then D1 serves one current card", async (t) => {
  const f = await setup(t);
  const publicUrl = `${origin}/adelaide/ama`;
  assert.equal((await f.post("/dashboard/ama/q-a/draft", "a@example.test", "First approved answer")).status, 303);
  const first = f.db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a'").get().id;
  assert.match(await (await f.get("/dashboard/ama/q-a/preview", "a@example.test")).text(), /expected_sequence" value="0"/);
  assert.doesNotMatch(await (await publicWorker.fetch(new Request(publicUrl), f.publicEnv)).text(), /First approved answer/);
  const fields = { revision_id: first, expected_sequence: "0", sfw_ack: "yes" };
  assert.equal((await action(f, "q-a", "publish", fields, "viewer@example.test")).status, 404);
  assert.equal((await action(f, "q-b", "publish", fields)).status, 409);
  assert.equal((await action(f, "q-a", "publish", { ...fields, sfw_ack: "no" })).status, 400);
  assert.equal((await action(f, "q-a", "publish", fields)).status, 303);
  const live = await publicWorker.fetch(new Request(publicUrl), f.publicEnv);
  assert.equal(live.status, 200);
  const body = await live.text();
  assert.match(body, /A question &lt;script&gt;/);
  assert.match(body, /First approved answer/);
  assert.doesNotMatch(body, /B private question|a@example\.test|author_email/);
  assert.equal((await action(f, "q-a", "publish", fields)).status, 409);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ama_publications WHERE question_id='q-a'").get().n, 1);
  assert.equal((await f.post("/dashboard/ama/q-a/draft", "a@example.test", "New private answer", "1")).status, 303);
  assert.doesNotMatch(await (await publicWorker.fetch(new Request(publicUrl), f.publicEnv)).text(), /New private answer/);
  const second = f.db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a' ORDER BY revision DESC LIMIT 1").get().id;
  assert.equal((await action(f, "q-a", "publish", { revision_id: second, expected_sequence: "1", sfw_ack: "yes" })).status, 303);
  assert.match(await (await publicWorker.fetch(new Request(publicUrl), f.publicEnv)).text(), /New private answer/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ama_publications WHERE question_id='q-a'").get().n, 2);
});

test("withdrawal takes effect on the next origin read and stale publication cannot restore it", async (t) => {
  const f = await setup(t);
  await f.post("/dashboard/ama/q-a/draft", "a@example.test", "Approved answer");
  const first = f.db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a'").get().id;
  assert.equal((await action(f, "q-a", "publish", { revision_id: first, expected_sequence: "0", sfw_ack: "yes" })).status, 303);
  await f.post("/dashboard/ama/q-a/draft", "a@example.test", "Private replacement", "1");
  const second = f.db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a' ORDER BY revision DESC LIMIT 1").get().id;
  const stalePreview = { revision_id: second, expected_sequence: "1", sfw_ack: "yes" };
  assert.equal((await action(f, "q-a", "withdraw", { confirm: "withdraw", expected_sequence: "1" }, "viewer@example.test")).status, 404);
  assert.equal((await action(f, "q-a", "withdraw", { confirm: "withdraw", expected_sequence: "1" })).status, 303);
  assert.equal((await action(f, "q-a", "publish", stalePreview)).status, 409);
  assert.equal((await action(f, "q-a", "withdraw", { confirm: "withdraw", expected_sequence: "1" })).status, 409);
  const after = await (await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), f.publicEnv)).text();
  assert.doesNotMatch(after, /Approved answer|Private replacement/);
  assert.equal(f.db.prepare("SELECT action FROM ama_publications WHERE question_id='q-a' ORDER BY sequence DESC LIMIT 1").get().action, "withdraw");
  assert.equal((await action(f, "q-a", "publish", { revision_id: second, expected_sequence: "2", sfw_ack: "yes" })).status, 303);
  assert.match(await (await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), f.publicEnv)).text(), /Private replacement/);
});

test("profile revocation or version mismatch closes the public view despite a stale KV profile", async (t) => {
  const f = await setup(t);
  await f.post("/dashboard/ama/q-a/draft", "a@example.test", "Approved answer");
  const revision = f.db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a'").get().id;
  assert.equal((await action(f, "q-a", "publish", { revision_id: revision, expected_sequence: "0", sfw_ack: "yes" })).status, 303);
  f.db.prepare("UPDATE creator_public_profiles SET status='paused' WHERE creator_id='a'").run();
  assert.equal((await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), f.publicEnv)).status, 404);
  assert.equal((await ask(f, "adelaide", { "cf-turnstile-response": "fixture-new" })).status, 404);
  assert.equal(f.publicKv.get("public-profile:adelaide").publishedVersionId, "profile-version-1");
});
