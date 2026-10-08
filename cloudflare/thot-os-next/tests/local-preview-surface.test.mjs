import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { localAdultPreviewAvailable } from "../src/lib/local-preview-runtime.ts";
import { localPreviewRedirect } from "../src/lib/local-preview-redirect.ts";
import { localPreviewAdultVersion, previewAdultVersion, profilePreviewActions } from "../src/lib/public-profile-preview-actions.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => readFile(path.join(root, file), "utf8");

test("the adult local-preview action is unavailable outside configured local Node development", () => {
  const signingSecret = "a".repeat(32);
  assert.equal(localAdultPreviewAvailable({ nodeEnv: "development", userAgent: "Node.js/22", signingSecret }), true);
  assert.equal(localAdultPreviewAvailable({ nodeEnv: "development", userAgent: "Node.js/22" }), false);
  assert.equal(localAdultPreviewAvailable({ nodeEnv: "development", userAgent: "Cloudflare-Workers", signingSecret }), false);
  assert.equal(localAdultPreviewAvailable({ nodeEnv: "production", userAgent: "Cloudflare-Workers", signingSecret }), false);
});

test("preview actions are fail-closed, omit contact values, and keep adult profiles creator-scoped", () => {
  const config = { enabled: true, label: "Event enquiry", rules: "Please provide event details.", wear: [], extras: [] };
  assert.deepEqual(profilePreviewActions({ bookingConfig: config, hasBookingPhone: true, hasBookingEmail: true, hasAdultProfile: true, displayName: "Alex" }), [
    { kind: "booking", label: "Preview only — Event enquiry" },
    { kind: "more", label: "Preview only — More from Alex" },
  ]);
  assert.deepEqual(profilePreviewActions({ bookingConfig: config, hasBookingPhone: true, hasBookingEmail: false, hasAdultProfile: false, displayName: "Alex" }), []);
  assert.deepEqual(profilePreviewActions({ bookingConfig: config, hasBookingPhone: false, hasBookingEmail: true, hasAdultProfile: false, displayName: "Alex" }), []);
  assert.deepEqual(profilePreviewActions({ bookingConfig: { ...config, enabled: false }, hasBookingPhone: true, hasBookingEmail: true, hasAdultProfile: false, displayName: "Alex" }), []);
  assert.deepEqual(profilePreviewActions({ bookingConfig: "{", hasBookingPhone: true, hasBookingEmail: true, hasAdultProfile: false, displayName: "Alex" }), []);

  const versions = [
    { id: "approved", creatorId: "creator", status: "approved" },
    { id: "foreign-draft", creatorId: "other", status: "draft" },
    { id: "published", creatorId: "creator", status: "published" },
    { id: "draft", creatorId: "creator", status: "draft" },
    { id: "rejected", creatorId: "creator", status: "rejected" },
  ];
  assert.equal(previewAdultVersion(versions, "creator")?.id, "draft");
  assert.equal(localPreviewAdultVersion(versions, "creator")?.id, "draft");
  assert.equal(previewAdultVersion([{ id: "published", creatorId: "creator", status: "published" }, { id: "rejected", creatorId: "creator", status: "rejected" }], "creator")?.id, "published");
  assert.equal(previewAdultVersion([{ id: "rejected", creatorId: "creator", status: "rejected" }], "creator"), null);
  assert.equal(previewAdultVersion(versions, "missing"), null);
});

test("the More href remains limited to the existing local signed age route", async () => {
  const preview = await source("src/app/public-profile/preview/page.tsx");
  assert.match(preview, /action\.kind === "more" && localAdultPreview && localAdultVersion/);
  assert.match(preview, /href=\{`\/public-profile\/preview\/age\/\$\{localAdultVersion\.id\}`\}/);
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
