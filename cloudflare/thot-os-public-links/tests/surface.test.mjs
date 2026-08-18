import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

function environment(snapshot) {
  const events = [];
  return {
    env: {
      PUBLIC_LINKS: { get: async () => snapshot },
      LINK_EVENTS: { writeDataPoint: (event) => events.push(event) },
      ASSETS: { fetch: async () => new Response("asset") },
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
