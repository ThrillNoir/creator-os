// Synthetic local That Hub preview. No Cloudflare or creator account is accessed.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { createAmaWorker } from "../src/index.mjs";
import publicWorker from "../../thot-os-public-links/src/index.ts";

const host = "127.0.0.1";
const port = Number(process.env.THAT_HUB_AMA_PREVIEW_PORT ?? 8789);
const origin = `http://${host}:${port}`;
const db = new Database(":memory:");
db.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE creators(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL);
  CREATE TABLE users(email TEXT PRIMARY KEY COLLATE NOCASE,status TEXT NOT NULL);
  CREATE TABLE creator_memberships(creator_id TEXT NOT NULL,user_email TEXT NOT NULL COLLATE NOCASE,role TEXT NOT NULL,status TEXT NOT NULL);
  CREATE TABLE creator_public_profiles(id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,slug TEXT NOT NULL,status TEXT NOT NULL,published_version_id TEXT);
  CREATE TABLE creator_public_profile_versions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,creator_id TEXT NOT NULL,status TEXT NOT NULL,approved_by TEXT);
`);
db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
db.prepare("INSERT INTO creators VALUES (?,?,?)").run("fixture-a", "Fixture Creator", "active");
db.prepare("INSERT INTO users VALUES (?,?)").run("creator@example.test", "active");
db.prepare("INSERT INTO creator_memberships VALUES (?,?,?,?)").run("fixture-a", "creator@example.test", "creator", "active");
db.prepare("INSERT INTO creator_public_profiles VALUES (?,?,?,?,?)").run("fixture-profile", "fixture-a", "adelaide", "active", "fixture-profile-v1");
db.prepare("INSERT INTO creator_public_profile_versions VALUES (?,?,?,?,?)").run("fixture-profile-v1", "fixture-profile", "fixture-a", "published", "creator@example.test");
const insertQuestion = db.prepare("INSERT INTO ama_questions(id,creator_id,question_text,source,received_at) VALUES (?,?,?,?,?)");
insertQuestion.run("question-one", "fixture-a", "What happens after I send a question?", "import", "2026-10-19T09:10:00.000Z");
insertQuestion.run("question-two", "fixture-a", "Can I share a published answer?", "import", "2026-10-19T09:11:00.000Z");
insertQuestion.run("question-three", "fixture-a", "Where can I find the booking form?", "import", "2026-10-19T09:12:00.000Z");
db.prepare("INSERT INTO ama_answer_revisions(id,question_id,creator_id,revision,answer_text,author_email) VALUES (?,?,?,?,?,?)")
  .run("draft-one", "question-one", "fixture-a", 1, "This is a synthetic local preview. Questions stay private until the creator reviews the answer and explicitly publishes the finished card.", "creator@example.test");
db.prepare("INSERT INTO ama_answer_revisions(id,question_id,creator_id,revision,answer_text,author_email) VALUES (?,?,?,?,?,?)")
  .run("draft-two", "question-two", "fixture-a", 1, "Yes. A published question and answer can be shared as one card.", "creator@example.test");
const publish = db.prepare("INSERT INTO ama_publications(id,creator_id,question_id,revision_id,profile_version_id,actor_email,action,safety) VALUES (?,?,?,?,?,?,'publish','sfw')");
publish.run("sample-publication-one", "fixture-a", "question-one", "draft-one", "fixture-profile-v1", "creator@example.test");
publish.run("sample-publication-two", "fixture-a", "question-two", "draft-two", "fixture-profile-v1", "creator@example.test");

const profile = {
  schemaVersion: 1, publishedVersionId: "fixture-profile-v1",
  creator: { slug: "adelaide", displayName: "Fixture Creator", headline: "A local That Hub AMA preview", bio: "Synthetic content only. Nothing here is published to the real site." },
  links: [{ id: "ama", label: "Questions & answers", destinationUrl: "https://www.thathuboverthere.com/adelaide/ama", destinationHost: "www.thathuboverthere.com" }],
};
const kv = new Map([["public-profile:adelaide", profile]]);

function d1() {
  return { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; } };
  } };
}

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const kid = crypto.randomUUID();
const jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid };
const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
async function token() {
  const head = b64({ alg: "RS256", kid });
  const body = b64({ aud: "local-ama", iss: "https://fixture.invalid", email: "creator@example.test", exp: Math.floor(Date.now() / 1000) + 3600 });
  const signature = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`))).toString("base64url");
  return `${head}.${body}.${signature}`;
}
const usedChallenges = new Set();
const privateWorker = createAmaWorker({ fetchJwks: async () => Response.json({ keys: [jwk] }), verifyChallenge: async (value) => {
  if (value !== "fixture-demo-1" || usedChallenges.has(value)) return false;
  usedChallenges.add(value); return true;
} });
const privateEnv = { DB: d1(), ACCESS_AUD: "local-ama", ACCESS_ISSUER: "https://fixture.invalid", ACCESS_JWKS_URL: "https://fixture.invalid/certs", PUBLIC_ORIGIN: origin, TURNSTILE_SECRET: "fixture-only" };
const publicEnv = { LIVE_PUBLIC_CREATOR_SLUGS: "adelaide", PUBLIC_LINKS: { get: async (key) => kv.get(key) ?? null }, LINK_EVENTS: { writeDataPoint() {} }, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  AMA_SERVICE: { fetch: (input, init) => privateWorker.fetch(new Request(input, init), privateEnv) }, AMA_TURNSTILE_SITE_KEY: "fixture-site-key", AMA_RATE_LIMITER: { limit: async () => ({ success: true }) } };

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (url.pathname === "/") { outgoing.writeHead(302, { location: "/adelaide" }); outgoing.end(); return; }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const headers = new Headers(incoming.headers);
    if (url.pathname.startsWith("/dashboard/ama")) headers.set("cf-access-jwt-assertion", await token());
    if (url.pathname.endsWith("/ama/ask")) headers.set("cf-connecting-ip", "192.0.2.40");
    const request = new Request(url, { method: incoming.method, headers, body: ["GET", "HEAD"].includes(incoming.method) ? undefined : Buffer.concat(chunks) });
    const worker = url.pathname.startsWith("/dashboard/ama") ? privateWorker : publicWorker;
    const result = await worker.fetch(request, url.pathname.startsWith("/dashboard/ama") ? privateEnv : publicEnv);
    const outputHeaders = Object.fromEntries(result.headers);
    if (outputHeaders.location === "https://www.thathuboverthere.com/adelaide/ama") outputHeaders.location = "/adelaide/ama";
    let body = Buffer.from(await result.arrayBuffer());
    if (url.pathname === "/adelaide/ama" && incoming.method === "GET" && result.status === 200) {
      body = Buffer.from(body.toString().replace('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>', "")
        .replace('<div class="cf-turnstile" data-sitekey="fixture-site-key"></div>', '<input type="hidden" name="cf-turnstile-response" value="fixture-demo-1"><p class="fixture-note">Synthetic local challenge · one submission per preview restart</p>'));
    }
    outgoing.writeHead(result.status, outputHeaders);
    outgoing.end(body);
  } catch (error) { outgoing.writeHead(500); outgoing.end(String(error)); }
});
server.listen(port, host, () => process.stdout.write(`Synthetic That Hub AMA preview: ${origin}/adelaide and ${origin}/dashboard/ama\n`));
