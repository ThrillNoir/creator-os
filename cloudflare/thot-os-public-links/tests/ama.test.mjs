import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

const profile = {
  schemaVersion: 1,
  publishedVersionId: "profile-version-1",
  creator: { slug: "adelaide", displayName: "Adelaide", headline: "Creator", bio: "Public profile" },
  links: [{ id: "ama", label: "Questions & answers", destinationUrl: "https://www.thathuboverthere.com/adelaide/ama", destinationHost: "www.thathuboverthere.com" }],
};

const ama = {
  schemaVersion: 1,
  creatorSlug: "adelaide",
  publishedProfileVersionId: "profile-version-1",
  cards: [{ id: "first", question: "What is <script>bad()</script>?", answer: "A public <answer> & reply.", publishedAt: "2026-10-19T00:00:00.000Z", safety: "sfw" }],
};

function environment(profileValue = profile, amaValue = ama) {
  const reads = [];
  return {
    reads,
    env: {
      LIVE_PUBLIC_CREATOR_SLUGS: "adelaide",
      PUBLIC_LINKS: { get: async (key) => {
        reads.push(key);
        return key === "public-profile:adelaide" ? profileValue : key === "public-ama:adelaide" ? amaValue : null;
      } },
      LINK_EVENTS: { writeDataPoint() {} },
    },
  };
}

const url = "https://www.thathuboverthere.com/adelaide/ama";

test("public AMA page renders only the approved creator projection", async () => {
  const { env, reads } = environment();
  const response = await worker.fetch(new Request(url), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  const body = await response.text();
  assert.match(body, /Questions &amp; answers/);
  assert.match(body, /id="q-first"/);
  assert.match(body, /class="collection"/);
  assert.match(body, /scroll-snap-type:x mandatory/);
  assert.match(body, /aria-label="Link to question 1"/);
  assert.match(body, /<h2>What is/);
  assert.match(body, /ANSWERS/);
  assert.match(body, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(body, /A public &lt;answer&gt; &amp; reply/);
  assert.doesNotMatch(body, /<script>|<answer>|publishedProfileVersionId|destinationUrl/);
  assert.deepEqual(reads, ["public-profile:adelaide", "public-ama:adelaide"]);

  const head = await worker.fetch(new Request(url, { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await worker.fetch(new Request(url, { method: "POST" }), env)).status, 405);
});

test("profile may link to AMA through its existing approved-link redirect", async () => {
  const { env } = environment();
  const profileResponse = await worker.fetch(new Request("https://www.thathuboverthere.com/adelaide"), env);
  assert.equal(profileResponse.status, 200);
  assert.match(await profileResponse.text(), /href="\/go\/adelaide\/ama"/);
  const redirect = await worker.fetch(new Request("https://www.thathuboverthere.com/go/adelaide/ama"), env);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), url);
});

test("AMA route fails closed when its profile or projection is absent or mismatched", async () => {
  for (const [profileValue, amaValue] of [
    [null, ama], [profile, null],
    [profile, { ...ama, creatorSlug: "another" }],
    [profile, { ...ama, publishedProfileVersionId: "stale-version" }],
    [profile, { ...ama, privateNotes: "never public" }],
    [profile, { ...ama, cards: [{ ...ama.cards[0], safety: "nsfw" }] }],
    [profile, { ...ama, cards: [{ ...ama.cards[0], answer: "  " }] }],
    [profile, { ...ama, cards: [{ ...ama.cards[0], publishedAt: "2026-99-99T99:99:99.000Z" }] }],
    [profile, { ...ama, cards: [ama.cards[0], ama.cards[0]] }],
    [profile, { ...ama, cards: Array.from({ length: 51 }, (_, index) => ({ ...ama.cards[0], id: `card-${index}` })) }],
    [profile, { ...ama, cards: [{ ...ama.cards[0], privateMediaKey: "hidden" }] }],
  ]) {
    const response = await worker.fetch(new Request(url), environment(profileValue, amaValue).env);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/another/ama"), environment().env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/adelaide/ama/private"), environment().env)).status, 404);
});

test("public site never serves the private dashboard prefix", async () => {
  const { env, reads } = environment();
  for (const path of ["/dashboard", "/dashboard/ama", "/dashboard/ama/question-one", "/dashboard/ama/styles.css"]) {
    assert.equal((await worker.fetch(new Request(`https://www.thathuboverthere.com${path}`), env)).status, 404);
  }
  assert.deepEqual(reads, []);
});
