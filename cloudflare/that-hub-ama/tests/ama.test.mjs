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
  const keys = await accessFixture();
  const publicKv = new Map([["public-profile:adelaide", { schemaVersion: 1, publishedVersionId: "profile-version-1", creator: { slug: "adelaide", displayName: "Creator A", headline: "", bio: "" }, links: [] }]]);
  const worker = createAmaWorker({ fetchJwks: keys.fetchJwks, publishProjection: async ({ creatorId, profile, projection, generation }) => {
    if (db.prepare("SELECT MAX(sequence) AS n FROM ama_publications WHERE creator_id=?").get(creatorId).n !== generation) return false;
    const current = publicKv.get(`public-profile:${profile.slug}`);
    if (current?.publishedVersionId !== profile.version_id) return false;
    publicKv.set(`public-ama:${profile.slug}`, structuredClone(projection));
    return true;
  } });
  const env = { DB: d1(db), ACCESS_AUD: "ama-fixture", ACCESS_ISSUER: "https://access.example.test", ACCESS_JWKS_URL: "https://access.example.test/certs" };
  const publicEnv = { LIVE_PUBLIC_CREATOR_SLUGS: "adelaide", PUBLIC_LINKS: { get: async (key) => publicKv.get(key) ?? null }, LINK_EVENTS: { writeDataPoint() {} } };
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

test("creator reviews, drafts, previews and explicitly publishes one SFW Q&A card", async (t) => {
  const { db, get, post, worker, env, keys, publicKv, publicEnv } = await setup(t);
  const publicUrl = `${origin}/adelaide/ama`;
  assert.equal((await publicWorker.fetch(new Request(publicUrl), publicEnv)).status, 404);
  assert.equal((await get("/dashboard/ama/q-a", "a@example.test")).status, 200);
  assert.equal((await post("/dashboard/ama/q-a/draft", "a@example.test", "A thoughtful answer")).status, 303);
  assert.equal((await publicWorker.fetch(new Request(publicUrl), publicEnv)).status, 404);
  const privatePreview = await (await get("/dashboard/ama/q-a/preview", "a@example.test")).text();
  assert.match(privatePreview, /A question &lt;script&gt;/);
  assert.match(privatePreview, /A thoughtful answer/);
  assert.match(privatePreview, /Publish answer/);
  assert.doesNotMatch(privatePreview, /B private question/);
  const revision = db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a'").get().id;
  const publish = async (email, questionId, ack = "yes", id = revision) => worker.fetch(new Request(`${origin}/dashboard/ama/${questionId}/publish`, {
    method: "POST", headers: { "cf-access-jwt-assertion": await keys.token(email), origin },
    body: new URLSearchParams({ revision_id: id, sfw_ack: ack }),
  }), env);
  assert.equal((await publish("viewer@example.test", "q-a")).status, 404);
  assert.equal((await publish("a@example.test", "q-b")).status, 409);
  assert.equal((await publish("a@example.test", "q-a", "no")).status, 400);
  assert.equal(publicKv.has("public-ama:adelaide"), false);
  assert.equal((await publish("a@example.test", "q-a")).status, 303);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ama_publications WHERE creator_id='a'").get().n, 1);
  const publicResponse = await publicWorker.fetch(new Request(publicUrl), publicEnv);
  assert.equal(publicResponse.status, 200);
  const body = await publicResponse.text();
  assert.match(body, /A question &lt;script&gt;/);
  assert.match(body, /A thoughtful answer/);
  assert.doesNotMatch(body, /B private question|a@example\.test|author_email/);
  assert.equal((await get("/dashboard/ama?queue=published", "a@example.test")).status, 200);
  assert.equal((await publish("a@example.test", "q-a")).status, 303);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ama_publications WHERE creator_id='a'").get().n, 1);
  const draft = await post("/dashboard/ama/q-a/draft", "a@example.test", "Revised but still private", "1");
  assert.equal(draft.status, 303);
  assert.doesNotMatch(await (await publicWorker.fetch(new Request(publicUrl), publicEnv)).text(), /Revised but still private/);
  assert.equal((await publish("a@example.test", "q-a", "yes", revision)).status, 409);
  const secondRevision = db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a' ORDER BY revision DESC LIMIT 1").get().id;
  assert.equal((await publish("a@example.test", "q-a", "yes", secondRevision)).status, 303);
  assert.match(await (await publicWorker.fetch(new Request(publicUrl), publicEnv)).text(), /Revised but still private/);

  assert.equal((await post("/dashboard/ama/q-a2/draft", "a@example.test", "Second public answer")).status, 303);
  const otherRevision = db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a2'").get().id;
  assert.equal((await publish("a@example.test", "q-a2", "yes", otherRevision)).status, 303);
  const withdraw = async (email, questionId, confirm = "withdraw") => worker.fetch(new Request(`${origin}/dashboard/ama/${questionId}/withdraw`, {
    method: "POST", headers: { "cf-access-jwt-assertion": await keys.token(email), origin },
    body: new URLSearchParams({ confirm }),
  }), env);
  assert.equal((await withdraw("viewer@example.test", "q-a")).status, 404);
  assert.equal((await withdraw("a@example.test", "q-b")).status, 404);
  assert.equal((await withdraw("a@example.test", "q-a", "no")).status, 400);
  assert.equal((await withdraw("a@example.test", "q-a")).status, 303);
  const afterWithdrawal = await (await publicWorker.fetch(new Request(publicUrl), publicEnv)).text();
  assert.doesNotMatch(afterWithdrawal, /A question &lt;script|Revised but still private/);
  assert.match(afterWithdrawal, /Second A question|Second public answer/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ama_answer_revisions WHERE question_id='q-a'").get().n, 2);
  assert.equal(db.prepare("SELECT action FROM ama_publications WHERE question_id='q-a' ORDER BY sequence DESC LIMIT 1").get().action, "withdraw");
  assert.equal((await withdraw("a@example.test", "q-a")).status, 303);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ama_publications WHERE question_id='q-a'").get().n, 3);
});

test("publication fails closed when public profile projection is stale", async (t) => {
  const { db, post, worker, env, keys, publicKv } = await setup(t);
  await post("/dashboard/ama/q-a/draft", "a@example.test", "Private answer");
  const revision = db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a'").get().id;
  publicKv.delete("public-profile:adelaide");
  const response = await worker.fetch(new Request(`${origin}/dashboard/ama/q-a/publish`, {
    method: "POST", headers: { "cf-access-jwt-assertion": await keys.token("a@example.test"), origin },
    body: new URLSearchParams({ revision_id: revision, sfw_ack: "yes" }),
  }), env);
  assert.equal(response.status, 503);
  assert.equal(publicKv.has("public-ama:adelaide"), false);
});

test("failed withdrawal remains visibly pending until delivery is retried", async (t) => {
  const { db, post, worker, env, keys, publicKv, publicEnv, get } = await setup(t);
  await post("/dashboard/ama/q-a/draft", "a@example.test", "Approved fixture answer");
  const revision = db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a'").get().id;
  async function action(target, name, fields) {
    return target.fetch(new Request(`${origin}/dashboard/ama/q-a/${name}`, {
      method: "POST", headers: { "cf-access-jwt-assertion": await keys.token("a@example.test"), origin }, body: new URLSearchParams(fields),
    }), env);
  }
  assert.equal((await action(worker, "publish", { revision_id: revision, sfw_ack: "yes" })).status, 303);
  const failing = createAmaWorker({ fetchJwks: keys.fetchJwks, publishProjection: async () => false });
  assert.equal((await action(failing, "withdraw", { confirm: "withdraw" })).status, 503);
  assert.match(await (await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), publicEnv)).text(), /Approved fixture answer/);
  assert.match(await (await get("/dashboard/ama/q-a", "a@example.test")).text(), /Public update pending/);
  assert.equal((await action(worker, "withdraw", { confirm: "withdraw" })).status, 303);
  assert.doesNotMatch(await (await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), publicEnv)).text(), /Approved fixture answer/);
  assert.doesNotMatch(await (await get("/dashboard/ama/q-a", "a@example.test")).text(), /Public update pending/);
  assert.equal(publicKv.get("public-ama:adelaide").cards.length, 0);
});

test("stale publish completion cannot restore a card after withdrawal", async (t) => {
  const { db, post, env, keys, publicKv, publicEnv } = await setup(t);
  await post("/dashboard/ama/q-a/draft", "a@example.test", "Race fixture answer");
  const revision = db.prepare("SELECT id FROM ama_answer_revisions WHERE question_id='q-a'").get().id;
  let release, entered;
  const paused = new Promise((resolve) => { release = resolve; });
  const atPublisher = new Promise((resolve) => { entered = resolve; });
  let first = true;
  const racing = createAmaWorker({ fetchJwks: keys.fetchJwks, publishProjection: async ({ creatorId, profile, projection, generation }) => {
    if (first) { first = false; entered(); await paused; }
    const current = db.prepare("SELECT MAX(sequence) AS n FROM ama_publications WHERE creator_id=?").get(creatorId).n;
    if (current !== generation || publicKv.get(`public-profile:${profile.slug}`)?.publishedVersionId !== profile.version_id) return false;
    publicKv.set(`public-ama:${profile.slug}`, projection);
    return true;
  } });
  async function action(name, fields) {
    return racing.fetch(new Request(`${origin}/dashboard/ama/q-a/${name}`, {
      method: "POST", headers: { "cf-access-jwt-assertion": await keys.token("a@example.test"), origin }, body: new URLSearchParams(fields),
    }), env);
  }
  const publishing = action("publish", { revision_id: revision, sfw_ack: "yes" });
  await atPublisher;
  assert.equal((await action("withdraw", { confirm: "withdraw" })).status, 303);
  release();
  assert.equal((await publishing).status, 409);
  assert.equal(publicKv.get("public-ama:adelaide").cards.length, 0);
  assert.equal(db.prepare("SELECT delivered_sequence FROM ama_projection_delivery_state WHERE creator_id='a'").get().delivered_sequence, 2);
  assert.doesNotMatch(await (await publicWorker.fetch(new Request(`${origin}/adelaide/ama`), publicEnv)).text(), /Race fixture answer/);
});
