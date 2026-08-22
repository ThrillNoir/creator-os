import assert from "node:assert/strict";
import test from "node:test";
import { parseProfileLinkRows } from "../src/lib/profile-link-input.ts";

test("saving a public profile omits fully blank optional link rows", () => {
  const links = parseProfileLinkRows({
    labels: ["IG", "", ""],
    destinations: ["https://instagram.com/example", "", ""],
    stableIds: ["stable-ig", "", ""],
    maximum: 8,
  });
  assert.deepEqual(links.map(({ label, stableId, destinationHost, sortOrder }) => ({ label, stableId, destinationHost, sortOrder })), [{ label: "IG", stableId: "stable-ig", destinationHost: "instagram.com", sortOrder: 0 }]);
});

test("partly completed, credentialed, and non-HTTPS public links fail with actionable errors", () => {
  assert.throws(() => parseProfileLinkRows({ labels: ["IG"], destinations: [""], stableIds: ["stable-ig"], maximum: 8 }), /Complete both a link label/);
  assert.throws(() => parseProfileLinkRows({ labels: ["IG"], destinations: ["https://user:password@example.com"], stableIds: ["stable-ig"], maximum: 8 }), /credential-free HTTPS/);
  assert.throws(() => parseProfileLinkRows({ labels: ["IG"], destinations: ["http://example.com"], stableIds: ["stable-ig"], maximum: 8 }), /credential-free HTTPS/);
});

test("existing stable link identities stay with their approved destinations in a new draft", () => {
  const links = parseProfileLinkRows({ labels: ["Instagram"], destinations: ["https://instagram.com/example"], stableIds: ["stable-ig"], maximum: 8 });
  assert.equal(links[0].stableId, "stable-ig");
  assert.equal(links[0].destinationUrl, "https://instagram.com/example");
});
