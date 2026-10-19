import assert from "node:assert/strict";
import test from "node:test";
import defaultWorker, { createAdultGateway } from "../src/index.ts";
import { fullLengthMessage, validPortfolio } from "../src/portfolio.ts";
import { PortfolioFixture } from "./portfolio-fixture.mjs";

const profile = {
  schemaVersion: 1,
  publishedVersionId: "local-adelaide-v1",
  creator: { slug: "adelaide", displayName: "Adelaide", bio: "Fixture profile", safeProfileUrl: "https://www.thathuboverthere.com/adelaide" },
  links: [], media: [],
};

const env = {
  ADULT_PROFILES: { get: async () => profile },
  ADULT_EVENTS: { writeDataPoint: () => {} },
  AGE_SESSION_SECRET: "fixture-secret",
};

function base64url(value) { return Buffer.from(value).toString("base64url"); }

async function sessionCookie(slug = "adelaide", versionId = "local-adelaide-v1") {
  const payload = base64url(JSON.stringify({ slug, versionId, expiresAt: Math.floor(Date.now() / 1000) + 600 }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AGE_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `__Host-thot-age=${payload}.${signature}`;
}

async function view(worker, path = "/adelaide", cookie) {
  return worker.fetch(new Request(`https://adult.example${path}`, { headers: cookie ? { cookie } : {} }), env);
}

test("portfolio stays absent from the default gateway and behind its age session", async () => {
  const fixture = new PortfolioFixture();
  fixture.update("adelaide", "studio-portrait", { selected: true, section: "Photos", genre: "Portraits", order: 1 });
  fixture.publish("adelaide", "studio-portrait");
  const worker = createAdultGateway(async (slug, version) => fixture.projection(slug, version));
  assert.equal((await view(worker)).status, 404);
  const cookie = await sessionCookie();
  assert.doesNotMatch(await (await view(defaultWorker, "/adelaide", cookie)).text(), /Want a sneak peek/);
  const response = await view(worker, "/adelaide", cookie);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Want a sneak peek\?/);
  assert.match(body, /<details>/);
  assert.match(body, /Studio portrait/);
  assert.match(response.headers.get("content-security-policy"), /media-src 'self'/);
  assert.equal((await view(worker, "/portfolio-fixture/adelaide/studio-portrait.svg", cookie)).status, 404);
  assert.equal((await view(worker, "/adelaide", await sessionCookie("other"))).status, 404);
});

test("selection, ordering, publication and withdrawal are creator-scoped", () => {
  const fixture = new PortfolioFixture();
  assert.equal(fixture.publish("adelaide", "after-hours"), false);
  assert.equal(fixture.update("other", "after-hours", { selected: true, section: "Clips", genre: "Performance", order: 1 }), false);
  assert.equal(fixture.update("adelaide", "after-hours", { selected: true, section: "Clips", genre: "Performance", order: 2 }), true);
  assert.equal(fixture.update("adelaide", "quiet-morning", { selected: true, section: "Photos", genre: "Everyday", order: 1 }), true);
  assert.equal(fixture.publish("adelaide", "after-hours"), true);
  assert.equal(fixture.publish("adelaide", "quiet-morning"), true);
  assert.deepEqual(fixture.projection("adelaide", "local-adelaide-v1").cards.map((card) => card.id), ["quiet-morning", "after-hours"]);
  assert.equal(fixture.projection("other", "local-adelaide-v1"), null);
  assert.equal(fixture.projection("adelaide", "wrong-version"), null);
  assert.equal(fixture.withdraw("other", "after-hours"), false);
  assert.equal(fixture.withdraw("adelaide", "after-hours"), true);
  assert.deepEqual(fixture.projection("adelaide", "local-adelaide-v1").cards.map((card) => card.id), ["quiet-morning"]);
});

test("only an exact approved local preview path can enter the protected projection", async () => {
  const fixture = new PortfolioFixture();
  fixture.update("adelaide", "after-hours", { selected: true, section: "Clips", genre: "Performance", order: 1 });
  fixture.publish("adelaide", "after-hours");
  const projection = fixture.projection("adelaide", "local-adelaide-v1");
  assert.equal(validPortfolio(projection, "adelaide", "local-adelaide-v1"), true);
  for (const badPath of ["https://private.example/source.mp4", "/media/adelaide/original.mp4", "/portfolio-fixture/other/after-hours.mp4", "/portfolio-fixture/adelaide/after-hours.mp4?key=private"]) {
    const tampered = structuredClone(projection);
    tampered.cards[0].previewPath = badPath;
    assert.equal(validPortfolio(tampered, "adelaide", "local-adelaide-v1"), false);
  }
  const worker = createAdultGateway(async () => ({ ...projection, cards: [{ ...projection.cards[0], previewPath: "https://private.example/source.mp4" }] }));
  const body = await (await view(worker, "/adelaide", await sessionCookie())).text();
  assert.doesNotMatch(body, /Want a sneak peek|private\.example/);
});

test("filters, native video controls, request acknowledgement and reduced motion render", async () => {
  const fixture = new PortfolioFixture();
  for (const [id, section, genre, order] of [["studio-portrait", "Photos", "Portraits", 1], ["after-hours", "Clips", "Performance", 2]]) {
    fixture.update("adelaide", id, { selected: true, section, genre, order });
    fixture.publish("adelaide", id);
  }
  const worker = createAdultGateway(async (slug, version) => fixture.projection(slug, version));
  const cookie = await sessionCookie();
  const all = await (await view(worker, "/adelaide", cookie)).text();
  assert.match(all, /<video controls preload="none" playsinline/);
  assert.doesNotMatch(all, /autoplay|original\.mp4|Download full video/);
  assert.match(all, /prefers-reduced-motion:reduce/);
  assert.match(all, /name="acknowledge" value="yes" required/);
  const filtered = await (await view(worker, "/adelaide?section=Clips&genre=Portraits", cookie)).text();
  assert.match(filtered, /<details open>/);
  assert.match(filtered, /No previews match these filters/);
  assert.doesNotMatch(filtered, /<video controls/);
  assert.equal(fixture.submitRequest("adelaide", { requestType: "clip", message: "Please make a short clip", email: "", acknowledge: "no" }), false);
  assert.equal(fixture.submitRequest("other", { requestType: "clip", message: "Please make a short clip", email: "", acknowledge: "yes" }), false);
  assert.equal(fixture.submitRequest("adelaide", { requestType: "clip", message: "Please make a short clip", email: "", acknowledge: "yes" }), true);
});

test("a published clip offers a prepared direct-contact message without exposing the private asset", async () => {
  const fixture = new PortfolioFixture();
  for (const [id, section, genre, order] of [["studio-portrait", "Photos", "Portraits", 1], ["after-hours", "Clips", "Performance", 2]]) {
    fixture.update("adelaide", id, { selected: true, section, genre, order });
    fixture.publish("adelaide", id);
  }
  const worker = createAdultGateway(async (slug, version) => fixture.projection(slug, version));
  assert.equal((await view(worker, "/adelaide")).status, 404);
  const body = await (await view(worker, "/adelaide?section=Clips", await sessionCookie())).text();
  assert.match(body, /Message creator for full length/);
  assert.match(body, /name="name" type="text" required/);
  assert.match(body, /value="telegram">Telegram/);
  assert.match(body, /value="email">Email/);
  assert.doesNotMatch(body, /name="contact"/);
  assert.match(body, /<textarea name="message" required minlength="10" maxlength="800"/);
  assert.doesNotMatch(body, /<textarea name="message" readonly/);
  assert.match(body, /Hello Adelaide,/);
  assert.match(body, /Asset ID: after-hours/);
  assert.match(body, /Full-length clip: After hours/);
  assert.doesNotMatch(body, /fixture-full-after-hours|private.*\.mp4|Download full video/);
  const photo = await (await view(worker, "/adelaide?section=Photos", await sessionCookie())).text();
  assert.doesNotMatch(photo, /Message creator for full length/);
});

test("direct contact resolves the published preview without saving an inbox request", () => {
  const fixture = new PortfolioFixture("adelaide", "local-adelaide-v1", { telegram: "fixturecreator", email: "creator@example.invalid" });
  const message = fullLengthMessage("Adelaide Suede", "after-hours", "After hours");
  const request = { previewId: "after-hours", name: "Alex", contactMethod: "telegram", message };
  assert.equal(fixture.prepareFullLengthContact("adelaide", request), null);
  fixture.update("adelaide", "after-hours", { selected: true, section: "Clips", genre: "Performance", order: 1 });
  fixture.publish("adelaide", "after-hours");
  assert.equal(fixture.prepareFullLengthContact("other", request), null);
  assert.equal(fixture.prepareFullLengthContact("adelaide", { ...request, previewId: "studio-portrait" }), null);
  assert.equal(fixture.prepareFullLengthContact("adelaide", { ...request, previewId: "fixture-full-after-hours" }), null);
  assert.equal(fixture.prepareFullLengthContact("adelaide", { ...request, contactMethod: "sms" }), null);
  assert.equal(fixture.prepareFullLengthContact("adelaide", { ...request, name: "<script>" }), null);
  assert.equal(fixture.prepareFullLengthContact("adelaide", { ...request, message: "short" }), null);
  const telegram = fixture.prepareFullLengthContact("adelaide", request);
  assert.equal(telegram.fullAssetId, "fixture-full-after-hours");
  assert.match(telegram.message, /From: Alex\nReference: after-hours — After hours$/);
  assert.equal(new URL(telegram.href).pathname, "/fixturecreator");
  assert.equal(new URL(telegram.href).searchParams.get("text"), telegram.message);
  const email = fixture.prepareFullLengthContact("adelaide", { ...request, contactMethod: "email", message: "I would like this clip, please." });
  assert.equal(email.fullAssetId, "fixture-full-after-hours");
  assert.equal(new URL(email.href).pathname, "creator@example.invalid");
  assert.equal(new URL(email.href).searchParams.get("body"), email.message);
  assert.equal(fixture.requests.length, 0);
  const unconfigured = new PortfolioFixture();
  unconfigured.update("adelaide", "after-hours", { selected: true, section: "Clips", genre: "Performance", order: 1 });
  unconfigured.publish("adelaide", "after-hours");
  assert.equal(unconfigured.prepareFullLengthContact("adelaide", request).href, null);
  const unsafeDestination = new PortfolioFixture("adelaide", "local-adelaide-v1", { email: "creator@example.invalid?cc=other@example.invalid" });
  unsafeDestination.update("adelaide", "after-hours", { selected: true, section: "Clips", genre: "Performance", order: 1 });
  unsafeDestination.publish("adelaide", "after-hours");
  assert.equal(unsafeDestination.prepareFullLengthContact("adelaide", { ...request, contactMethod: "email" }).href, null);
  fixture.withdraw("adelaide", "after-hours");
  assert.equal(fixture.prepareFullLengthContact("adelaide", request), null);
});
