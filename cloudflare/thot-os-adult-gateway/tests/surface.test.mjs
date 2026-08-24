import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

const profile = {
  schemaVersion: 1,
  publishedVersionId: "adult-v1",
  creator: { slug: "adelaide", displayName: "Adelaide", bio: "A protected profile", safeProfileUrl: "https://thathuboverthere.com/adelaide" },
  links: [{ id: "fans", label: "Creator page", destinationUrl: "https://example.com/creator", destinationHost: "example.com" }],
  media: [],
};

const protectedImageProfile = {
  schemaVersion: 4,
  publishedVersionId: "adult-v3",
  creator: { slug: "adelaide", displayName: "Adelaide", bio: "A protected profile", safeProfileUrl: "https://thathuboverthere.com/adelaide" },
  links: [{ id: "fans", label: "Creator page", destinationUrl: "https://example.com/creator", destinationHost: "example.com" }],
  media: [{
    id: "5cbf9896-a553-4b3c-8706-3f7c16c4d021",
    mediaKey: "adult-media/adelaide/adult-v3/5cbf9896-a553-4b3c-8706-3f7c16c4d021.webp",
    checksum: "a".repeat(64),
    altText: "",
    contentType: "image/webp",
    imageRole: "avatar",
  }],
  appearance: { themeKey: "thot-noir", buttonStyle: "solid-rounded", backgroundMode: "gradient", backgroundColor: "#100c16", primaryColor: "#c5a4ff", textColor: "#fbf8fe", cardColor: "#261d30", radiusScale: "comfortable" },
};

function environment(snapshot = profile, { mediaContentType = "image/jpeg", mediaChecksum = "a".repeat(64), mediaMetadata } = {}) {
  const events = [];
  const requestedKeys = [];
  return {
    env: {
      ADULT_PROFILES: { get: async () => snapshot },
      ADULT_MEDIA: { get: async (key) => {
        requestedKeys.push(key);
        const media = snapshot.media[0];
        return {
          body: new Blob(["image"]),
          httpMetadata: { contentType: mediaContentType },
          customMetadata: mediaMetadata ?? { creatorId: "adelaide", creatorSlug: snapshot.creator.slug, versionId: snapshot.publishedVersionId, attachmentId: media?.id ?? "", checksum: media?.checksum ?? "", surface: "adult_profile", imageRole: media?.imageRole ?? "" },
          checksums: { sha256: Uint8Array.from(mediaChecksum.match(/../g) ?? [], (value) => Number.parseInt(value, 16)).buffer },
        };
      } },
      ADULT_EVENTS: { writeDataPoint: (event) => events.push(event) },
      TURNSTILE_SECRET: "test-secret",
      TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_EXPECTED_HOSTNAME: "adult.example",
      AGE_SESSION_SECRET: "session-secret",
    },
    events,
    requestedKeys,
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
  assert.doesNotMatch(body, /adult-media\//);
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

test("a null Origin is accepted only for a browser-proven same-origin navigation", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  globalThis.fetch = async () => Response.json({ success: true, hostname: "adult.example", action: "adult_access" });
  console.warn = (message) => warnings.push(String(message));
  try {
    const { env } = environment();
    const sameOriginForm = new FormData(); sameOriginForm.set("cf-turnstile-response", "valid-token");
    const sameOrigin = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", {
      method: "POST",
      headers: { origin: "null", "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
      body: sameOriginForm,
    }), env);
    assert.equal(sameOrigin.status, 303);

    const crossSiteForm = new FormData(); crossSiteForm.set("cf-turnstile-response", "valid-token");
    const crossSite = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", {
      method: "POST",
      headers: { origin: "null", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
      body: crossSiteForm,
    }), env);
    assert.equal(crossSite.status, 400);
    assert.deepEqual(warnings, ['{"event":"adult_age_confirmation_rejected","reason":"origin_mismatch","creatorSlug":"adelaide"}']);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("a rejected Turnstile confirmation logs only a fixed safe reason code", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  globalThis.fetch = async () => Response.json({ success: false });
  console.warn = (message) => warnings.push(String(message));
  try {
    const { env } = environment();
    const form = new FormData(); form.set("cf-turnstile-response", "visitor-token-must-not-appear-in-logs");
    const denied = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", { method: "POST", headers: { origin: "https://adult.example" }, body: form }), env);
    assert.equal(denied.status, 400);
    assert.deepEqual(warnings, ['{"event":"adult_age_confirmation_rejected","reason":"challenge_rejected","creatorSlug":"adelaide"}']);
    assert.doesNotMatch(warnings.join("\n"), /visitor-token|test-secret|protected profile|example\.com/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
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

test("processed adult image projections remain session-bound, no-store, and do not expose private object keys", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "adult.example", action: "adult_access" });
  try {
    const { env, requestedKeys } = environment(protectedImageProfile, { mediaContentType: "image/webp" });
    const imageId = protectedImageProfile.media[0].id;
    const denied = await worker.fetch(new Request(`https://adult.example/media/adelaide/${imageId}?objectKey=https://attacker.example`), env);
    assert.equal(denied.status, 404);
    assert.equal(requestedKeys.length, 0);

    const form = new FormData(); form.set("cf-turnstile-response", "valid-token");
    const confirmed = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", { method: "POST", headers: { origin: "https://adult.example" }, body: form }), env);
    const page = await worker.fetch(new Request("https://adult.example/adelaide", { headers: { cookie: cookie(confirmed) } }), env);
    const pageBody = await page.text();
    assert.match(pageBody, new RegExp(`/media/adelaide/${imageId}`));
    assert.doesNotMatch(pageBody, /adult-media\/adelaide\/adult-v3/);
    assert.doesNotMatch(pageBody, /profile-private\//);

    const allowed = await worker.fetch(new Request(`https://adult.example/media/adelaide/${imageId}?key=attacker`, { headers: { cookie: cookie(confirmed) } }), env);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("content-type"), "image/webp");
    assert.equal(allowed.headers.get("cache-control"), "no-store");
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(requestedKeys, [protectedImageProfile.media[0].mediaKey]);
  } finally { globalThis.fetch = originalFetch; }
});

test("adult v4 image snapshots fail closed on a cross-surface key, unexpected metadata, checksum, or R2 content type", async () => {
  const crossSurface = structuredClone(protectedImageProfile);
  crossSurface.media[0].mediaKey = "public-media/adelaide/adult-v3/5cbf9896-a553-4b3c-8706-3f7c16c4d021.webp";
  const invalid = await worker.fetch(new Request("https://adult.example/age/adelaide"), environment(crossSurface).env);
  assert.equal(invalid.status, 404);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "adult.example", action: "adult_access" });
  try {
    const { env } = environment(protectedImageProfile, { mediaContentType: "image/jpeg" });
    const form = new FormData(); form.set("cf-turnstile-response", "valid-token");
    const confirmed = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", { method: "POST", headers: { origin: "https://adult.example" }, body: form }), env);
    const denied = await worker.fetch(new Request(`https://adult.example/media/adelaide/${protectedImageProfile.media[0].id}`, { headers: { cookie: cookie(confirmed) } }), env);
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get("cache-control"), "no-store");
  } finally { globalThis.fetch = originalFetch; }
});

test("adult media rejects a checksum or metadata mismatch after session confirmation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "adult.example", action: "adult_access" });
  try {
    const form = new FormData(); form.set("cf-turnstile-response", "valid-token");
    const badChecksum = environment(protectedImageProfile, { mediaContentType: "image/webp", mediaChecksum: "b".repeat(64) });
    const confirmed = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", { method: "POST", headers: { origin: "https://adult.example" }, body: form }), badChecksum.env);
    assert.equal((await worker.fetch(new Request(`https://adult.example/media/adelaide/${protectedImageProfile.media[0].id}`, { headers: { cookie: cookie(confirmed) } }), badChecksum.env)).status, 404);

    const badMetadata = environment(protectedImageProfile, { mediaContentType: "image/webp", mediaMetadata: { creatorSlug: "other", versionId: "adult-v3", attachmentId: protectedImageProfile.media[0].id, checksum: "a".repeat(64), surface: "adult_profile", imageRole: "avatar" } });
    const confirmedMetadata = await worker.fetch(new Request("https://adult.example/age/adelaide/confirm", { method: "POST", headers: { origin: "https://adult.example" }, body: form }), badMetadata.env);
    assert.equal((await worker.fetch(new Request(`https://adult.example/media/adelaide/${protectedImageProfile.media[0].id}`, { headers: { cookie: cookie(confirmedMetadata) } }), badMetadata.env)).status, 404);
  } finally { globalThis.fetch = originalFetch; }
});
