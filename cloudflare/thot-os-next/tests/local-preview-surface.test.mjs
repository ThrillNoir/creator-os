import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { localAdultPreviewAvailable } from "../src/lib/local-preview-runtime.ts";
import { localPreviewRedirect } from "../src/lib/local-preview-redirect.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => readFile(path.join(root, file), "utf8");

test("the adult local-preview action is unavailable outside local Node development", () => {
  assert.equal(localAdultPreviewAvailable({ nodeEnv: "development", userAgent: "Node.js/22" }), true);
  assert.equal(localAdultPreviewAvailable({ nodeEnv: "development", userAgent: "Cloudflare-Workers" }), false);
  assert.equal(localAdultPreviewAvailable({ nodeEnv: "production", userAgent: "Cloudflare-Workers" }), false);
});

test("safe preview only renders More when the local age route is available", async () => {
  const [preview, localAdultPreview] = await Promise.all([
    source("src/app/public-profile/preview/page.tsx"),
    source("src/lib/local-adult-preview.ts"),
  ]);
  assert.match(preview, /const localAdultPreview = localAdultPreviewAvailable\(\)/);
  assert.match(preview, /\{localAdultPreview && adultVersion && <nav className="public-preview-actions"/);
  assert.match(localAdultPreview, /return localAdultPreviewAvailable\(\);/);
});

test("preview redirects are stored-destination-only and non-cacheable", async () => {
  const [safeRedirect, adultRedirect] = await Promise.all([
    source("src/app/public-profile/preview/go/[versionId]/[linkId]/route.ts"),
    source("src/app/public-profile/preview/adult/[versionId]/go/[linkId]/route.ts"),
  ]);
  for (const route of [safeRedirect, adultRedirect]) {
    assert.match(route, /destination\.hostname\.toLowerCase\(\) !== link\.destination_host\.toLowerCase\(\)/);
    assert.match(route, /return localPreviewRedirect\(destination\);/);
    assert.doesNotMatch(route, /searchParams|URLSearchParams|request\.url/);
  }
  const response = localPreviewRedirect(new URL("https://example.test/path"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://example.test/path");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
