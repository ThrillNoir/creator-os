import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/handler.ts";
import { clampPreviewText, defaultPreviewMetadata, renderHead, validatePreviewMetadata } from "../../shared/public-preview.ts";

const creator = { slug: "adelaide", displayName: 'Adelaide <"&>', headline: "Creator", bio: "A safe public bio about this creator." };
const metadata = defaultPreviewMetadata(creator);

test("social head emits self-canonical metadata and escapes untrusted text and JSON-LD", () => {
  const head = renderHead({ title: metadata.title, description: metadata.description, path: "/adelaide", card: { path: metadata.image, alt: metadata.alt }, ogType: "profile", jsonLd: { name: '</script><script>alert(1)</script>' } });
  assert.match(head, /<link rel="canonical" href="https:\/\/www\.thathuboverthere\.com\/adelaide">/);
  assert.match(head, /<meta property="og:url" content="https:\/\/www\.thathuboverthere\.com\/adelaide">/);
  assert.match(head, /<meta property="og:image" content="https:\/\/www\.thathuboverthere\.com\/preview\/adelaide\.png">/);
  assert.match(head, /<meta property="og:image:width" content="1200">/);
  assert.match(head, /<meta property="og:image:height" content="630">/);
  assert.match(head, /Adelaide &lt;&quot;&amp;&gt;/);
  assert.doesNotMatch(head, /<script>alert/);
  assert.match(head, /\\u003c\/script\\u003e/);
  assert.throws(() => renderHead({ title: "x", description: "y", path: "//attacker.example", card: { path: "/preview/site.png", alt: "x" } }));
});

test("preview metadata clamps on word boundaries and validates the creator-bound image path", () => {
  assert.equal(clampPreviewText("one two three four", 14), "one two three…");
  assert.deepEqual(validatePreviewMetadata(metadata, "adelaide"), []);
  assert.ok(validatePreviewMetadata({ ...metadata, image: "/preview/other.png" }, "adelaide").length);
  assert.ok(validatePreviewMetadata({ ...metadata, title: "x".repeat(63) }, "adelaide").length);
  assert.ok(validatePreviewMetadata({ ...metadata, alt: "" }, "adelaide").length);
});

test("legacy published page remains 200 with complete metadata; missing creator is HTML 404", async () => {
  const snapshot = { schemaVersion: 1, publishedVersionId: "version-1", creator, links: [] };
  const env = { PUBLIC_LINKS: { get: async (key) => key === "public-profile:adelaide" ? snapshot : null }, LINK_EVENTS: { writeDataPoint() {} }, LIVE_PUBLIC_CREATOR_SLUGS: "adelaide,missing-creator" };
  const page = await worker.fetch(new Request("https://www.thathuboverthere.com/adelaide"), env);
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /property="og:title"/);
  assert.match(body, /type="application\/ld\+json"/);
  assert.equal((await worker.fetch(new Request("https://www.thathuboverthere.com/missing-creator"), env)).status, 404);
  const missing = await worker.fetch(new Request("https://www.thathuboverthere.com/missing-creator"), env);
  assert.match(missing.headers.get("content-type"), /text\/html/);
  assert.match(await missing.text(), /<html lang="en">/);
});
