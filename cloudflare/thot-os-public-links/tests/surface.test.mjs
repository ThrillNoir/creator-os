import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

function environment(snapshot, configured = {}) {
  const events = [];
  return {
    env: {
      PUBLIC_LINKS: { get: async () => snapshot },
      LINK_EVENTS: { writeDataPoint: (event) => events.push(event) },
      ASSETS: { fetch: async () => new Response("asset") },
      ...configured,
    },
    events,
  };
}

const snapshot = {
  schemaVersion: 1,
  publishedVersionId: "profile-version-1",
  creator: { slug: "adelaide", displayName: "Adelaide <safe>", headline: "Creator", bio: "A public profile" },
  links: [{ id: "official", label: "Official <site>", destinationUrl: "https://example.com/path?source=profile", destinationHost: "example.com" }],
};

test("public profiles render an approved KV projection without exposing source markup", async () => {
  const { env, events } = environment(snapshot);
  const response = await worker.fetch(new Request("https://links.example/adelaide"), env);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Adelaide &lt;safe&gt;/);
  assert.match(body, /Official &lt;site&gt;/);
  assert.doesNotMatch(body, /destinationUrl|publishedVersionId/);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].indexes, ["adelaide"]);
  assert.deepEqual(events[0].blobs, ["profile_view"]);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
});

test("redirects can only use a destination present in the approved snapshot", async () => {
  const { env, events } = environment(snapshot);
  const response = await worker.fetch(new Request("https://links.example/go/adelaide/official?next=https://attacker.example"), env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.com/path?source=profile");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].indexes, ["adelaide"]);
  assert.deepEqual(events[0].blobs, ["link_click", "official", "example.com"]);
});

test("invalid snapshots and unapproved paths fail closed", async () => {
  const invalid = structuredClone(snapshot);
  invalid.links[0].destinationHost = "attacker.example";
  const { env, events } = environment(invalid);
  const profile = await worker.fetch(new Request("https://links.example/adelaide"), env);
  const redirect = await worker.fetch(new Request("https://links.example/go/adelaide/official"), env);
  assert.equal(profile.status, 404);
  assert.equal(redirect.status, 404);
  assert.equal(events.length, 0);
});

test("v2 interaction actions require the exact configured HTTPS protected-service origin", async () => {
  const v2 = structuredClone(snapshot);
  v2.schemaVersion = 2;
  v2.actions = [{ id: "more", label: "More from Adelaide", href: "https://adult.example/age/adelaide" }];
  const { env } = environment(v2, { ADULT_GATEWAY_BASE_URL: "https://adult.example" });
  const response = await worker.fetch(new Request("https://links.example/adelaide"), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /More from Adelaide/);
  assert.doesNotMatch(body, /destinationUrl|publishedVersionId/);
  v2.actions[0].href = "javascript:alert(1)";
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2, { ADULT_GATEWAY_BASE_URL: "https://adult.example" }).env)).status, 404);
  v2.actions[0].href = "https://unconfigured.example/age/adelaide";
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2, { ADULT_GATEWAY_BASE_URL: "https://adult.example" }).env)).status, 404);
  v2.actions[0].href = "https://adult.example/age/adelaide";
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2).env)).status, 404);
});

test("stored redirect destinations reject credentials, hostname mismatch, and caller-controlled data", async () => {
  for (const destinationUrl of [
    "https://user:password@example.com/creator",
    "https:///missing-host",
    "javascript:alert(1)",
    "data:text/html,hello",
  ]) {
    const invalid = structuredClone(snapshot);
    invalid.links[0].destinationUrl = destinationUrl;
    const response = await worker.fetch(new Request("https://links.example/go/adelaide/official?destination=https://attacker.example#fragment"), environment(invalid).env);
    assert.equal(response.status, 404, destinationUrl);
    assert.equal(response.headers.get("location"), null, destinationUrl);
  }
});

test("private THOT OS dashboard paths never resolve on the public link hub", async () => {
  const { env, events } = environment(snapshot);
  for (const path of ["/accounts", "/creators", "/growth", "/health", "/launch-readiness", "/library", "/messages", "/migration", "/money", "/operations", "/public-profile", "/reddit", "/staging-qa", "/admin", "/api", "/login"]) {
    const response = await worker.fetch(new Request(`https://thathuboverthere.com${path}`), env);
    assert.equal(response.status, 404, path);
  }
  assert.equal(events.length, 0);
});
