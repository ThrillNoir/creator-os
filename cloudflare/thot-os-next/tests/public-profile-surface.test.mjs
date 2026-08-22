import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => readFile(path.join(root, file), "utf8");

test("release configuration remains source-only and UI labels distinguish private approval from publication", async () => {
  const [publicPage, adultPage, migration, contactLocal, adultLocal] = await Promise.all([
    source("src/app/public-profile/page.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("../thot-os-app/migrations/0040_creator_profile_interactions.sql"),
    source("../thot-os-public-contact/wrangler.local.example.jsonc"),
    source("../thot-os-adult-gateway/wrangler.local.example.jsonc"),
  ]);
  assert.match(publicPage, /Approved, private/);
  assert.match(adultPage, /Approved, private/);
  assert.match(migration, /creator_adult_profile_publications/);
  assert.match(migration, /creator_adult_profile_published_version/);
  assert.doesNotMatch(contactLocal, /"routes"\s*:/);
  assert.doesNotMatch(adultLocal, /"routes"\s*:/);
});

test("redirect-handler links are ordinary anchors, preventing Next RSC navigation attempts", async () => {
  const [safePreview, adultPreview] = await Promise.all([
    source("src/app/public-profile/preview/page.tsx"),
    source("src/app/public-profile/preview/adult/[versionId]/page.tsx"),
  ]);
  assert.match(safePreview, /<a className="public-preview-link" href=\{`\/public-profile\/preview\/go\//);
  assert.match(adultPreview, /<a className="public-preview-link" href=\{`\/public-profile\/preview\/adult\//);
  assert.doesNotMatch(safePreview, /<Link className="public-preview-link"/);
  assert.doesNotMatch(adultPreview, /<Link className="public-preview-link"/);
});

test("profile approval is one click while image mutations remain same-origin", async () => {
  const [actions, publicPage, adultPage, uploadRoute, imageRoute] = await Promise.all([
    source("src/app/actions.ts"),
    source("src/app/public-profile/page.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("src/app/api/profile-image/route.ts"),
    source("src/app/api/profile-image/[attachmentId]/route.ts"),
  ]);
  assert.doesNotMatch(actions, /formData\.get\("approvalConfirmed"\)/);
  assert.doesNotMatch(publicPage, /name="approvalConfirmed"/);
  assert.doesNotMatch(adultPage, /name="approvalConfirmed"/);
  assert.match(uploadRoute, /isSameOriginRequest\(request\)/);
  assert.match(imageRoute, /isSameOriginRequest\(request\)/);
});
