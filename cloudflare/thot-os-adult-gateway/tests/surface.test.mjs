import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

const profile = {
  schemaVersion: 1,
  publishedVersionId: "adult-v1",
  creator: { slug: "adelaide", displayName: "Adelaide", bio: "A protected profile", safeProfileUrl: "https://thathuboverthere.com/adelaide" },
  links: [{ id: "fans", label: "Creator page", destinationUrl: "https://example.com/creator", destinationHost: "example.com" }],
  media: [{ id: "cover", objectKey: "adult/adelaide/cover.jpg", altText: "Approved creator portrait" }],
};

function environment(snapshot = profile) {
  const events = [];
  return {
    env: {
      ADULT_PROFILES: { get: async () => snapshot },
      ADULT_MEDIA: { get: async () => ({ body: new Blob(["image"]), httpMetadata: { contentType: "image/jpeg" } }) },
      ADULT_EVENTS: { writeDataPoint: (event) => events.push(event) },
      TURNSTILE_SECRET: "test-secret",
      TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_EXPECTED_HOSTNAME: "adult.example",
      AGE_SESSION_SECRET: "session-secret",
    },
    events,
  };
}

function cookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

test("the gate is the only response available before confirmation", async () => {
  const { env } = environment();
  const gate = await worker.fetch(new Request("https://adult.example/age/adelaide"), env);
  const direct = await worker.fetch(new Request("https://adult.example/adelaide"), env);
  const media = await worker.fetch(new Request("https://adult.example/media/adelaide/cover"), env);
  assert.equal(gate.status, 200);
  const body = await gate.text();
  assert.match(body, /Are you 18 or older\?/);
  assert.match(body, /thathuboverthere\.com\/adelaide/);
  assert.doesNotMatch(body, /A protected profile/);
  assert.doesNotMatch(body, /example\.com\/creator/);
  assert.doesNotMatch(body, /adult\/adelaide\/cover\.jpg/);
  assert.doesNotMatch(body, /publishedVersionId|destinationUrl|objectKey/);
  assert.equal(direct.status, 404);
  assert.equal(media.status, 404);
  assert.equal(direct.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});

test("a successful Turnstile confirmation sets a short-lived protected session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "adult.example", action: "adult_access" });
  try {
    const { env, events } = environment();
    const form = new FormData(); form.set("cf-turnstile-response", "valid-token");
    const confirmed = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", { method: "POST", headers: { origin: "https://adult.example" }, body: form }), env);
    assert.equal(confirmed.status, 303);
    assert.equal(confirmed.headers.get("location"), "/adelaide");
    assert.match(cookie(confirmed), /^__Host-thot-age=/);
    const session = await worker.fetch(new Request("https://adult.example/adelaide", { headers: { cookie: cookie(confirmed) } }), env);
    assert.equal(session.status, 200);
    assert.match(await session.text(), /A protected profile/);
    assert.equal(events.at(-1).blobs[0], "adult_profile_view");
  } finally { globalThis.fetch = originalFetch; }
});

test("protected redirects remain closed without a session and never accept a caller destination", async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request("https://adult.example/r/adelaide/fans?next=https://attacker.example"), env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("location"), null);
});

test("protected redirects use only the stored credential-free HTTPS destination", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "adult.example", action: "adult_access" });
  try {
    const { env } = environment();
    const form = new FormData(); form.set("cf-turnstile-response", "valid-token");
    const confirmed = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", { method: "POST", headers: { origin: "https://adult.example" }, body: form }), env);
    const response = await worker.fetch(new Request("https://adult.example/r/adelaide/fans?next=https://attacker.example", { headers: { cookie: cookie(confirmed) } }), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://example.com/creator");
    const tampered = structuredClone(profile);
    tampered.links[0].destinationUrl = "https://user:password@example.com/creator";
    const denied = await worker.fetch(new Request("https://adult.example/r/adelaide/fans", { headers: { cookie: cookie(confirmed) } }), environment(tampered).env);
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get("location"), null);
  } finally { globalThis.fetch = originalFetch; }
});
