import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker from "../src/index.ts";
import { isPublicCreatorSlug } from "../../shared/public-profile-slug.ts";

test("reserved creator slugs cannot render or redirect even with a stored snapshot", async () => {
  for (const slug of ["accounts", "api", "go", "health", "messages", "operations", "vault"]) {
    assert.equal(isPublicCreatorSlug(slug), false);
    const { env, events } = environment({ ...snapshot, creator: { ...snapshot.creator, slug } });
    for (const pathname of [`/${slug}`, `/${slug}/more`, `/go/${slug}/official`]) {
      assert.equal((await worker.fetch(new Request(`https://links.example${pathname}`), env)).status, 404);
    }
    assert.equal(events.length, 0);
  }
  assert.equal(isPublicCreatorSlug("thrill-noir"), true);
  assert.equal(isPublicCreatorSlug("legacy--name"), true);
  for (const slug of ["", "Bad", "-name", "a".repeat(81), "a/b"]) assert.equal(isPublicCreatorSlug(slug), false);
});

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
const stagingVars = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")).vars;

test("live profile hosts allow only configured creators and redirect apex and legacy URLs", async () => {
  const live = environment(snapshot, { LIVE_PUBLIC_CREATOR_SLUGS: "adelaide" }).env;
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/adelaide"), live)).status, 200);
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/go/fixture/official"), live)).status, 404);
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/adelaide"), environment(snapshot).env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/healthz"), live)).status, 200);
  assert.equal(await (await worker.fetch(new Request("https://www.thathuboverthere.com/robots.txt"), live)).text(), "asset");
  for (const host of ["thathuboverthere.com", "public-profile-staging.thathuboverthere.com"]) {
    const response = await worker.fetch(new Request(`http://${host}:8787/adelaide?from=old`), live);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://www.thathuboverthere.com/adelaide?from=old");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const media = await worker.fetch(new Request("https://thathuboverthere.com/media/adelaide/version/avatar"), live);
  assert.equal(media.status, 302);
  assert.equal(media.headers.get("location"), "https://www.thathuboverthere.com/media/adelaide/version/avatar");
});

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

test("safe public snapshots reject arbitrary image material", async () => {
  for (const mutation of [
    (value) => { value.creator.avatarUrl = "https://images.example/adelaide.webp"; },
    (value) => { value.images = [{ id: "attachment-1", objectKey: "profile-private/adelaide/public_sfw/upload/display.webp" }]; },
    (value) => { value.adultMedia = [{ id: "adult-attachment-1", objectKey: "profile-private/adelaide/adult_profile/upload/display.webp" }]; },
    (value) => { value.creator.attachmentId = "private-attachment-1"; },
  ]) {
    const invalid = structuredClone(snapshot);
    mutation(invalid);
    const response = await worker.fetch(new Request("https://links.example/adelaide"), environment(invalid).env);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("v4 public image projections contain only an environment-controlled delivery URL", async () => {
  const v4 = structuredClone(snapshot);
  v4.schemaVersion = 4;
  v4.actions = [];
  v4.appearance = { themeKey: "thot-noir", buttonStyle: "solid-rounded", backgroundMode: "gradient", backgroundColor: "#0d0c10", primaryColor: "#7655f6", textColor: "#f8f6fa", cardColor: "#211a29", radiusScale: "comfortable" };
  v4.media = [{ id: "avatar-1", href: "https://media.example/media/adelaide/profile-version-1/avatar-1", altText: "Creator portrait", contentType: "image/webp", imageRole: "avatar", checksum: "a".repeat(64) }];
  const response = await worker.fetch(new Request("https://links.example/adelaide"), environment(v4, { PUBLIC_MEDIA_BASE_URL: "https://media.example" }).env);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /https:\/\/media\.example\/media\/adelaide\/profile-version-1\/avatar-1/);
  assert.doesNotMatch(body, /profile-private\//);

  for (const mutation of [
    (value) => { value.media[0].href = "https://attacker.example/media/adelaide/profile-version-1/avatar-1"; },
    (value) => { value.media[0].href = "https://media.example/media/adelaide/profile-version-1/avatar-1?objectKey=profile-private"; },
    (value) => { value.media[0].href = "https://media.example/media/adelaide/another-version/avatar-1"; },
    (value) => { value.media[0].href = "https://media.example/media/adelaide/profile-version-1/avatar-1"; value.media[0].imageRole = "adult"; },
  ]) {
    const invalid = structuredClone(v4);
    mutation(invalid);
    assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(invalid, { PUBLIC_MEDIA_BASE_URL: "https://media.example" }).env)).status, 404);
  }
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v4).env)).status, 404);
});

test("v2 interaction actions use the exact configured safe friendly entrance", async () => {
  const v2 = structuredClone(snapshot);
  v2.schemaVersion = 2;
  v2.actions = [{ id: "more", label: "More from Adelaide", href: "https://links.example/adelaide/more" }];
  const { env } = environment(v2, {
    SAFE_PUBLIC_PROFILE_BASE_URL: "https://links.example",
    ADULT_GATEWAY_BASE_URL: "https://adult.example",
  });
  const response = await worker.fetch(new Request("https://links.example/adelaide"), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /More from Adelaide/);
  assert.match(body, /https:\/\/links\.example\/adelaide\/more/);
  assert.doesNotMatch(body, /destinationUrl|publishedVersionId/);
  v2.actions[0].href = "javascript:alert(1)";
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2, { SAFE_PUBLIC_PROFILE_BASE_URL: "https://links.example", ADULT_GATEWAY_BASE_URL: "https://adult.example" }).env)).status, 404);
  v2.actions[0].href = "https://unconfigured.example/adelaide/more";
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2, { SAFE_PUBLIC_PROFILE_BASE_URL: "https://links.example", ADULT_GATEWAY_BASE_URL: "https://adult.example" }).env)).status, 404);
  v2.actions[0].href = "https://links.example/adelaide/more";
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2).env)).status, 404);
});

test("booking actions render only for the configured booking origin", async () => {
  const v2 = structuredClone(snapshot);
  v2.schemaVersion = 2;
  v2.actions = [{ id: "book", label: "Book Adelaide", href: "https://booking.thathuboverthere.com/book/adelaide" }];
  const response = await worker.fetch(new Request("https://links.example/adelaide"), environment(v2, stagingVars).env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /https:\/\/booking\.thathuboverthere\.com\/book\/adelaide/);
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2, { ...stagingVars, BOOKING_ACTION_BASE_URL: undefined }).env)).status, 404);
  v2.actions[0].href = "https://booking.example/book/adelaide";
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide"), environment(v2, stagingVars).env)).status, 404);
});

test("friendly adult entrances use the approved snapshot and an environment-owned gateway destination", async () => {
  const v2 = structuredClone(snapshot);
  v2.schemaVersion = 2;
  v2.actions = [{ id: "more", label: "More from Adelaide", href: "https://links.example/adelaide/more" }];
  const configured = {
    SAFE_PUBLIC_PROFILE_BASE_URL: "https://links.example",
    ADULT_GATEWAY_BASE_URL: "https://adult.example",
  };
  const allowed = await worker.fetch(new Request("https://links.example/adelaide/more?next=https://attacker.example&returnTo=https://elsewhere.example"), environment(v2, configured).env);
  assert.equal(allowed.status, 302);
  assert.equal(allowed.headers.get("location"), "https://adult.example/age/adelaide");
  assert.equal(allowed.headers.get("cache-control"), "no-store");

  const missingAction = structuredClone(v2);
  missingAction.actions = [];
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide/more"), environment(missingAction, configured).env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://links.example/adelaide/more"), environment(v2, { SAFE_PUBLIC_PROFILE_BASE_URL: "https://links.example" }).env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://links.example/not-a-slug/more"), environment(v2, configured).env)).status, 404);
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
