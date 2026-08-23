import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => readFile(path.join(root, file), "utf8");

test("release configuration remains source-only and profile editors expose a simple save-publish flow", async () => {
  const [publicPage, adultPage, migration, contactLocal, adultLocal] = await Promise.all([
    source("src/app/public-profile/page.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("../thot-os-app/migrations/0040_creator_profile_interactions.sql"),
    source("../thot-os-public-contact/wrangler.local.example.jsonc"),
    source("../thot-os-adult-gateway/wrangler.local.example.jsonc"),
  ]);
  for (const page of [publicPage, adultPage]) {
    assert.match(page, />Save<\/button>/);
    assert.match(page, />Publish<\/button>/);
    assert.match(page, />Unpublish<\/button>/);
    assert.doesNotMatch(page, /approvalNote|publishConfirmed|withdrawConfirmed|SEPARATE APPROVAL|PUBLICATION GATE/);
  }
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

test("publish is one explicit admin action while protected release and image mutations fail closed", async () => {
  const [actions, publicPage, adultPage, wrangler, uploadRoute, imageRoute] = await Promise.all([
    source("src/app/actions.ts"),
    source("src/app/public-profile/page.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("wrangler.jsonc"),
    source("src/app/api/profile-image/route.ts"),
    source("src/app/api/profile-image/[attachmentId]/route.ts"),
  ]);
  assert.doesNotMatch(actions, /formData\.get\("(?:approval|publish|withdraw)Confirmed"\)/);
  assert.doesNotMatch(publicPage, /name="(?:approval|publish|withdraw)Confirmed"/);
  assert.doesNotMatch(adultPage, /name="(?:approval|publish|withdraw)Confirmed"/);
  assert.match(actions, /v\.status IN \('draft','approved'\)/);
  assert.match(actions, /approvalSource: "publish_button"/);
  assert.match(actions, /identity\.creator\.role === "creator"/);
  assert.match(actions, /String\(env\.ADULT_PROFILE_PUBLISHING_ENABLED\) !== "1"/);
  assert.match(adultPage, /String\(env\.ADULT_PROFILE_PUBLISHING_ENABLED\) === "1"/);
  assert.match(wrangler, /"ADULT_PROFILE_PUBLISHING_ENABLED": "0"/);
  assert.match(uploadRoute, /isSameOriginRequest\(request\)/);
  assert.match(imageRoute, /isSameOriginRequest\(request\)/);
});

test("image uploads process before attachment and compensate failed persistence", async () => {
  const uploadRoute = await source("src/app/api/profile-image/route.ts");
  const processed = uploadRoute.indexOf("SET status='processed'");
  const attached = uploadRoute.indexOf("INSERT INTO creator_profile_image_attachments");
  assert.ok(processed >= 0 && processed < attached);
  assert.match(uploadRoute, /MEDIA\.delete\(storedKeys\)/);
  assert.match(uploadRoute, /SET status='rejected'/);
});

test("creator authoring is draft-only and private image reads use the preview derivative", async () => {
  const [authorization, publicPage, adultPage, imageRoute, appearanceEditor] = await Promise.all([
    source("src/lib/authorization.ts"),
    source("src/app/public-profile/page.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("src/app/api/profile-image/[attachmentId]/route.ts"),
    source("src/components/profile-appearance-editor.tsx"),
  ]);
  assert.match(authorization, /creator: new Set\(\["view", "mutate"\]\)/);
  assert.doesNotMatch(authorization, /creator: new Set\(\[[^\]]*"approve"/);
  for (const page of [publicPage, adultPage]) {
    assert.match(page, /const canEdit = roleCan\(context\.creator\.role, "mutate"\)/);
    assert.match(page, /const canApprove = roleCan\(context\.creator\.role, "approve"\) && context\.creator\.role !== "creator"/);
    assert.match(page, /Save changes here\. An agency administrator can publish them\./);
    assert.match(page, /imageUploadsEnabled=\{profileImageProcessorAvailable\(env\)\}/);
  }
  assert.match(imageRoute, /preview\.upload_id=display\.upload_id/);
  assert.match(imageRoute, /preview\.derivative_kind='preview'/);
  assert.match(imageRoute, /"cache-control": "private, no-store"/);
  assert.match(appearanceEditor, /disabled=\{isDisabled\}>Remove<\/button>/);
  assert.match(appearanceEditor, /Save a draft before changing its images\./);
});
