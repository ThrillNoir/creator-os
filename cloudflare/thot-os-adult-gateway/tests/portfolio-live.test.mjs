import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { validLivePortfolio } from "../src/portfolio.ts";

const slug = "adelaide";
const profileVersion = "adult-profile-v1";
const portfolioVersion = "portfolio-v1";
const cardId = "preview-card-1";
const profile = {
  schemaVersion: 1, publishedVersionId: profileVersion,
  creator: { slug, displayName: "Adelaide", bio: "Fixture", safeProfileUrl: "https://www.thathuboverthere.com/adelaide" },
  links: [], media: [],
};
const previewBytes = new TextEncoder().encode("synthetic video preview bytes");
const posterBytes = new TextEncoder().encode("synthetic poster bytes");
async function checksum(bytes) { return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex"); }
function base64url(value) { return Buffer.from(value).toString("base64url"); }
async function session(versionId = profileVersion, sessionSlug = slug) {
  const payload = base64url(JSON.stringify({ slug: sessionSlug, versionId, expiresAt: Math.floor(Date.now() / 1000) + 600 }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("local-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `__Host-thot-age=${payload}.${base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))}`;
}
async function setup() {
  const previewChecksum = await checksum(previewBytes);
  const posterChecksum = await checksum(posterBytes);
  const previewKey = `adult-portfolio/${slug}/${portfolioVersion}/${cardId}/preview.mp4`;
  const posterKey = `adult-portfolio/${slug}/${portfolioVersion}/${cardId}/poster.jpg`;
  const projection = { schemaVersion: 2, creatorSlug: slug, publishedProfileVersionId: profileVersion, portfolioVersionId: portfolioVersion,
    contact: { telegramUsername: "TestCreator", email: "creator@example.test", message: "Please send me details about this preview." },
    cards: [{ id: cardId, title: "A short preview", description: "A public teaser", section: "Creator clips", genre: "Studio",
      kind: "video", previewPath: `/portfolio-media/${slug}/${cardId}/preview`, posterPath: `/portfolio-media/${slug}/${cardId}/poster`,
      mediaKey: previewKey, checksum: previewChecksum, posterKey, posterChecksum }] };
  const privateReferences = { schemaVersion: 1, creatorSlug: slug, publishedProfileVersionId: profileVersion,
    portfolioVersionId: portfolioVersion, names: { [cardId]: "Renamed full video.mp4" } };
  const objects = new Map([
    [previewKey, { bytes: previewBytes, checksum: previewChecksum, contentType: "video/mp4", kind: "preview" }],
    [posterKey, { bytes: posterBytes, checksum: posterChecksum, contentType: "image/jpeg", kind: "poster" }],
  ]);
  const r2Object = (key, range) => {
    const item = objects.get(key);
    if (!item) return null;
    const bodyBytes = range ? item.bytes.subarray(range.offset, range.offset + range.length) : item.bytes;
    return { size: item.bytes.byteLength, etag: item.checksum, version: "version-1",
      httpMetadata: { contentType: item.contentType },
      checksums: { sha256: Uint8Array.from(Buffer.from(item.checksum, "hex")).buffer },
      customMetadata: { surface: "adult_portfolio", creatorSlug: slug, profileVersionId: profileVersion,
        portfolioVersionId: portfolioVersion, cardId, kind: item.kind, checksum: item.checksum },
      body: new Response(bodyBytes).body };
  };
  const env = { AGE_SESSION_SECRET: "local-secret", ADULT_EVENTS: { writeDataPoint() {} },
    ADULT_PROFILES: { async get(key) { return key === `adult-profile:${slug}` ? profile : key === `adult-portfolio:${slug}` ? projection
      : key === `adult-portfolio-contact:${slug}:${portfolioVersion}` ? privateReferences : null; } },
    ADULT_MEDIA: { async head(key) { return r2Object(key); }, async get(key, options) { return r2Object(key, options?.range); } } };
  return { projection, privateReferences, objects, env };
}
async function fetchPage(env, path, cookie, init = {}) {
  return worker.fetch(new Request(`https://more.example${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } }), env);
}

function contactLink(markup) {
  const href = /<a class="action" href="([^"]+)"/.exec(markup)?.[1];
  assert.ok(href, "the visitor needs an explicit link to open their chosen app");
  return href.replaceAll("&amp;", "&");
}

test("live projection accepts creator labels and never exposes private source IDs", async () => {
  const { projection, env } = await setup();
  assert.equal(validLivePortfolio(projection, slug, profileVersion), true);
  assert.equal(validLivePortfolio({ ...projection, cards: [{ ...projection.cards[0], fullLengthBasename: "private-full-length.mp4" }] }, slug, profileVersion), false,
    "a private full-video filename cannot enter the public projection");
  assert.equal(validLivePortfolio({ ...projection, contact: { ...projection.contact, message: "<script>" } }, slug, profileVersion), false);
  assert.equal(validLivePortfolio({ ...projection, contact: { ...projection.contact, email: "o'hara@example.com" } }, slug, profileVersion), true,
    "an older published address remains readable");
  const legacyEmail = `${"a".repeat(64)}@${"b".repeat(190)}`;
  assert.equal(legacyEmail.length, 255);
  assert.equal(validLivePortfolio({ ...projection, contact: { email: legacyEmail } }, slug, profileVersion), true,
    "the longest address accepted by the original contract remains readable");
  assert.equal(validLivePortfolio(projection, slug, "old-profile"), false);
  assert.equal((await fetchPage(env, `/${slug}`)).status, 404);
  const response = await fetchPage(env, `/${slug}`, await session());
  const html = await response.text();
  assert.match(html, /Creator clips|Studio|A short preview/);
  assert.match(html, /Please send me details about this preview/);
  assert.doesNotMatch(html, /adult-portfolio\/adelaide|private-source-asset/);
  assert.doesNotMatch(html, /private-full-length\.mp4/);
  assert.doesNotMatch(html, /Renamed full video\.mp4/);
  assert.doesNotMatch(html, /portfolio\/request|MADE FOR YOU/);
  assert.match((await (await fetchPage(env, `/${slug}?section=Other`, await session())).text()), /A short preview/);
  assert.equal((await fetchPage(env, `/${slug}`, await session("old-profile"))).status, 404);
});

test("preview bytes require the current session, projection, checksum and exact media metadata", async () => {
  const { projection, objects, env } = await setup();
  const path = `/portfolio-media/${slug}/${cardId}/preview`;
  assert.equal((await fetchPage(env, path)).status, 404);
  const cookie = await session();
  const partial = await fetchPage(env, path, cookie, { headers: { range: "bytes=0-8" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 0-8/${previewBytes.byteLength}`);
  assert.equal(await partial.text(), "synthetic");
  assert.equal((await fetchPage(env, path, cookie, { headers: { range: "bytes=999-" } })).status, 416);
  const preview = objects.get(projection.cards[0].mediaKey);
  preview.checksum = "0".repeat(64);
  assert.equal((await fetchPage(env, path, cookie)).status, 404);
  objects.delete(projection.cards[0].mediaKey);
  assert.equal((await fetchPage(env, path, cookie)).status, 404);
  env.ADULT_PROFILES.get = async (key) => key === `adult-profile:${slug}` ? profile : null;
  assert.equal((await fetchPage(env, path, cookie)).status, 404);
});

test("full length contact uses only configured destinations and needs a same-origin aged session", async () => {
  const { env, projection } = await setup();
  const path = `/${slug}/portfolio/full-length/request`;
  const body = new URLSearchParams({ previewId: cardId, name: "Viewer", contactMethod: "telegram", message: "Please send the full clip and payment option." });
  const post = (cookie, origin, requestBody = body) => fetchPage(env, path, cookie, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: requestBody });
  assert.equal((await post(null, "https://more.example")).status, 404);
  assert.equal((await post(await session(), "https://other.example")).status, 404);
  const response = await post(await session(), "https://more.example");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const telegramPage = await response.text();
  assert.match(telegramPage, /Message ready · not sent|Open Telegram with this message/);
  assert.doesNotMatch(telegramPage, /href="https:\/\/t\.me\/TestCreator[^\"]*preview-card-1/);
  const telegramLink = new URL(contactLink(telegramPage));
  assert.equal(telegramLink.origin, "https://t.me");
  assert.equal(telegramLink.pathname, "/TestCreator");
  assert.match(telegramLink.searchParams.get("text"), /From: Viewer/);
  assert.match(telegramLink.searchParams.get("text"), /Creator file: Renamed full video\.mp4/);
  const wrong = new URLSearchParams(body); wrong.set("previewId", "private-source-asset");
  assert.equal((await post(await session(), "https://more.example", wrong)).status, 400);
  const email = new URLSearchParams(body); email.set("contactMethod", "email");
  const emailPage = await (await post(await session(), "https://more.example", email)).text();
  assert.match(emailPage, /Open email app with this message/);
  const emailLink = new URL(contactLink(emailPage));
  assert.equal(emailLink.protocol, "mailto:");
  assert.equal(emailLink.pathname, "creator@example.test");
  assert.equal(emailLink.searchParams.get("subject"), "Full-length request: A short preview");
  assert.match(emailLink.searchParams.get("body"), /Creator file: Renamed full video\.mp4\r\nFrom: Viewer/);
  projection.contact.email = "a?cc=other@example.com"; // possible legacy projection; never allow it to add a mailto query
  const legacyLink = new URL(contactLink(await (await post(await session(), "https://more.example", email)).text()));
  assert.match(legacyLink.href, /^mailto:a%3Fcc%3Dother@example\.com\?subject=/);
  assert.equal(legacyLink.searchParams.has("cc"), false);
});

test("privacy-browser contact POST accepts only proven same-origin navigation", async () => {
  const { env } = await setup();
  const path = `/${slug}/portfolio/full-length/request`;
  const body = new URLSearchParams({ previewId: cardId, name: "Viewer", contactMethod: "telegram", message: "Please send the full clip and payment option." });
  const browserMetadata = { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  const post = (headers, cookie) => fetchPage(env, path, cookie, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body,
  });
  assert.equal((await post({ origin: "null", ...browserMetadata }, await session())).status, 200);
  assert.equal((await post(browserMetadata, await session())).status, 200);
  assert.equal((await post({ origin: "null" }, await session())).status, 404);
  assert.equal((await post({}, await session())).status, 404);
  assert.equal((await post({ origin: "null", ...browserMetadata, "sec-fetch-site": "cross-site" }, await session())).status, 404);
  assert.equal((await post({ origin: "https://other.example", ...browserMetadata }, await session())).status, 404);
  assert.equal((await post({ origin: "null", ...browserMetadata }, null)).status, 404);
});

test("preview-only clips have no false full-length request or private asset identifier", async () => {
  const { projection, env } = await setup();
  projection.cards[0].hasFullLength = false;
  assert.equal(validLivePortfolio(projection, slug, profileVersion), true);
  const html = await (await fetchPage(env, `/${slug}`, await session())).text();
  assert.match(html, /A short preview/);
  assert.doesNotMatch(html, /Message creator for full length|<label>Genre|private-source-asset/);
  const body = new URLSearchParams({ previewId: cardId, name: "Viewer", contactMethod: "email", message: "Please send the full clip." });
  assert.equal((await fetchPage(env, `/${slug}/portfolio/full-length/request`, await session(),
    { method: "POST", headers: { origin: "https://more.example", "content-type": "application/x-www-form-urlencoded" }, body })).status, 400);
  projection.cards[0].hasFullLength = true;
  const linkedHtml = await (await fetchPage(env, `/${slug}`, await session())).text();
  assert.match(linkedHtml, /Message creator for full length/);
  assert.match(linkedHtml, /Preview: A short preview/);
  assert.doesNotMatch(linkedHtml, /Preview reference: preview-card-1|Renamed full video\.mp4/);
});

test("a mismatched private reference is ignored without exposing another release's name", async () => {
  const { env, privateReferences } = await setup();
  privateReferences.portfolioVersionId = "other-release";
  const body = new URLSearchParams({ previewId: cardId, name: "Viewer", contactMethod: "email", message: "Please send the full clip." });
  const response = await fetchPage(env, `/${slug}/portfolio/full-length/request`, await session(),
    { method: "POST", headers: { origin: "https://more.example", "content-type": "application/x-www-form-urlencoded" }, body });
  assert.equal(response.status, 200);
  assert.doesNotMatch(contactLink(await response.text()), /Renamed full video\.mp4|Creator file:/);
});

test("a private-reference lookup outage does not block the visitor's contact choice", async () => {
  const { env } = await setup();
  const read = env.ADULT_PROFILES.get;
  env.ADULT_PROFILES.get = async (key) => {
    if (key.startsWith("adult-portfolio-contact:")) throw new Error("synthetic KV outage");
    return read(key);
  };
  const body = new URLSearchParams({ previewId: cardId, name: "Viewer", contactMethod: "telegram", message: "Please send the full clip." });
  const response = await fetchPage(env, `/${slug}/portfolio/full-length/request`, await session(),
    { method: "POST", headers: { origin: "https://more.example", "content-type": "application/x-www-form-urlencoded" }, body });
  assert.equal(response.status, 200);
  assert.doesNotMatch(contactLink(await response.text()), /Creator file:/);
});

test("prepared contact page escapes visitor text before offering an external app link", async () => {
  const { env } = await setup();
  const body = new URLSearchParams({ previewId: cardId, name: "Viewer", contactMethod: "telegram",
    message: "Please send <img src=x onerror=alert(1)> this clip." });
  const response = await fetchPage(env, `/${slug}/portfolio/full-length/request`, await session(),
    { method: "POST", headers: { origin: "https://more.example", "content-type": "application/x-www-form-urlencoded" }, body });
  const markup = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.match(markup, /&lt;img src=x/);
  assert.match(new URL(contactLink(markup)).searchParams.get("text"), /<img src=x onerror=alert\(1\)>/);
});
