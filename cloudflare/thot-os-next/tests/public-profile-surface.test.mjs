import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import test from "node:test";
import { isPublicCreatorSlug } from "../../shared/public-profile-slug.ts";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => readFile(path.join(root, file), "utf8");

test("release configuration remains source-only and profile editors expose a simple save-publish flow", async () => {
  const [publicEditor, adultEditor, adultPage, migration, contactLocal, adultLocal] = await Promise.all([
    source("src/components/public-profile-editor.tsx"),
    source("src/components/adult-profile-editor.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("../thot-os-app/migrations/0040_creator_profile_interactions.sql"),
    source("../thot-os-public-contact/wrangler.local.example.jsonc"),
    source("../thot-os-adult-gateway/wrangler.local.example.jsonc"),
  ]);
  assert.match(publicEditor, /"Save"/);
  assert.match(publicEditor, />Publish<\/button>/);
  assert.doesNotMatch(publicEditor, /approvalNote|publishConfirmed|withdrawConfirmed|SEPARATE APPROVAL|PUBLICATION GATE/);
  for (const page of [adultEditor]) {
    assert.match(page, /"Save"/);
    assert.match(page, />Publish<\/button>/);
    assert.doesNotMatch(page, /approvalNote|publishConfirmed|withdrawConfirmed|SEPARATE APPROVAL|PUBLICATION GATE/);
  }
  assert.match(adultPage, />Unpublish<\/button>/);
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
  assert.match(safePreview, /<a className=\{linkClass\} href=\{`\/public-profile\/preview\/go\//);
  assert.match(adultPreview, /<a className="public-preview-link" href=\{`\/public-profile\/preview\/adult\//);
  assert.doesNotMatch(safePreview, /<Link className="public-preview-link"/);
  assert.doesNotMatch(adultPreview, /<Link className="public-preview-link"/);
});

test("publish is one explicit creator-scoped action while protected release and image mutations fail closed", async () => {
  const [actions, publicPage, publicEditor, adultPage, wrangler, uploadRoute, imageRoute] = await Promise.all([
    source("src/app/actions.ts"),
    source("src/app/public-profile/page.tsx"),
    source("src/components/public-profile-editor.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("wrangler.jsonc"),
    source("src/app/api/profile-image/route.ts"),
    source("src/app/api/profile-image/[attachmentId]/route.ts"),
  ]);
  assert.doesNotMatch(actions, /formData\.get\("(?:approval|publish|withdraw)Confirmed"\)/);
  assert.doesNotMatch(publicPage, /name="(?:approval|publish|withdraw)Confirmed"/);
  assert.doesNotMatch(publicEditor, /name="(?:approval|publish|withdraw)Confirmed"/);
  assert.doesNotMatch(adultPage, /name="(?:approval|publish|withdraw)Confirmed"/);
  assert.match(actions, /v\.status IN \('draft','approved'\)/);
  assert.match(actions, /approvalSource: "publish_button"/);
  assert.match(actions, /publishPublicProfileAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.match(actions, /publishAdultProfileAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.match(actions, /approvePublicProfileVersionAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.match(actions, /approveAdultProfileVersionAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.doesNotMatch(actions, /separate operator or agency administrator must approve/i);
  assert.match(actions, /String\(env\.ADULT_PROFILE_PUBLISHING_ENABLED\) !== "1"/);
  assert.match(adultPage, /String\(env\.ADULT_PROFILE_PUBLISHING_ENABLED\) === "1"/);
  assert.match(wrangler, /"ADULT_PROFILE_PUBLISHING_ENABLED": "1"/);
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

test("creator profile publishing remains tenant-scoped and private image reads use the preview derivative", async () => {
  const [authorization, actions, publicPage, publicEditor, adultPage, adultEditor, imageRoute, appearanceEditor, safePreview] = await Promise.all([
    source("src/lib/authorization.ts"),
    source("src/app/actions.ts"),
    source("src/app/public-profile/page.tsx"),
    source("src/components/public-profile-editor.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("src/components/adult-profile-editor.tsx"),
    source("src/app/api/profile-image/[attachmentId]/route.ts"),
    source("src/components/profile-appearance-editor.tsx"),
    source("src/app/public-profile/preview/page.tsx"),
  ]);
  assert.match(authorization, /creator: new Set\(\["view", "mutate"\]\)/);
  assert.doesNotMatch(authorization, /creator: new Set\(\[[^\]]*"approve"/);
  for (const page of [publicPage, adultPage]) {
    assert.match(page, /const canEdit = roleCan\(context\.creator\.role, "mutate"\)/);
    assert.match(page, /const canPublish = canEdit/);
    assert.match(page, /imageUploadsEnabled=\{profileImageProcessorAvailable\(env\)\}/);
  }
  for (const editor of [publicEditor, adultEditor]) assert.match(editor, /props\.canPublish/);
  assert.match(actions, /publishPublicProfileAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.match(actions, /publishAdultProfileAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.match(actions, /approvePublicProfileVersionAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.match(actions, /approveAdultProfileVersionAction\(formData: FormData\)[\s\S]*?requireCreatorContext\("mutate"\)/);
  assert.match(actions, /identityAuditStatement\(DB, humanAuditActor\(identity\), "public_profile_version_approved"/);
  assert.match(actions, /identityAuditStatement\(DB, humanAuditActor\(identity\), "adult_profile_version_approved"/);
  assert.match(imageRoute, /preview\.upload_id=display\.upload_id/);
  assert.match(imageRoute, /preview\.derivative_kind='preview'/);
  assert.match(imageRoute, /"cache-control": "private, no-store"/);
  assert.match(appearanceEditor, /disabled=\{isDisabled\}>Remove<\/button>/);
  assert.match(appearanceEditor, /Save a draft before changing its images\./);
  assert.ok(appearanceEditor.indexOf('name="appearanceThemeKey"') < appearanceEditor.indexOf('activePanel === "design"'));
  assert.match(safePreview, /creator_public_profile_details/);
  assert.match(safePreview, /appearanceCss\(appearance\)/);
  assert.match(safePreview, /previewButtonClass\(appearance\.buttonStyle\)/);
});

test("published profiles expose only environment-controlled public entry links for copying", async () => {
  const [publicPage, adultPage, copyLink, urls, wrangler] = await Promise.all([
    source("src/app/public-profile/page.tsx"),
    source("src/app/adult-profile/page.tsx"),
    source("src/components/copy-profile-link.tsx"),
    source("src/lib/profile-public-url.ts"),
    source("wrangler.jsonc"),
  ]);
  assert.match(publicPage, /safePublicProfileUrl\(env\.SAFE_PUBLIC_PROFILE_BASE_URL, defaultSlug\)/);
  assert.match(adultPage, /adultAgeGateUrl\(env\.ADULT_GATEWAY_BASE_URL, creator\?\.slug/);
  assert.match(copyLink, /navigator\.clipboard\.writeText\(url\)/);
  assert.doesNotMatch(copyLink, /destination|query|redirect/i);
  assert.match(urls, /url\.protocol !== "https:"/);
  assert.match(urls, /isPublicCreatorSlug/);
  assert.match(wrangler, /"SAFE_PUBLIC_PROFILE_BASE_URL": "https:\/\/public-profile-staging\.thathuboverthere\.com"/);
  assert.match(wrangler, /"ADULT_GATEWAY_BASE_URL": "https:\/\/more-staging\.thathuboverthere\.com"/);
});

test("public-profile save validation returns structured field errors without leaking values", async () => {
  const [actions, editor, adultEditor] = await Promise.all([
    source("src/app/actions.ts"),
    source("src/components/public-profile-editor.tsx"),
    source("src/components/adult-profile-editor.tsx"),
  ]);
  assert.match(actions, /type PublicProfileDraftState/);
  assert.match(actions, /isPublicCreatorSlug/);
  assert.match(actions, /const publicProfileSlug = \/\^\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$\//);
  assert.match(actions, /reasonCode: "profile_validation_failed"/);
  assert.match(actions, /fieldErrors\[`linkDestination\.\$\{index\}`\]/);
  assert.match(actions, /if \(Object\.keys\(fieldErrors\)\.length/);
  assert.match(actions, /await DB\.batch\(statements\)/);
  assert.match(editor, /useActionState\(savePublicProfileDraftAction/);
  assert.match(editor, /aria-invalid/);
  assert.match(editor, /Review the/);
  assert.match(editor, /slugLocked/);
  assert.doesNotMatch(editor, /new URLSearchParams|profile_validation_failed.*values/);
  assert.match(actions, /reasonCode: "adult_profile_validation_failed"/);
  assert.match(actions, /fieldErrors\[`adultLinkDestination\.\$\{index\}`\]/);
  assert.match(adultEditor, /useActionState\(saveAdultProfileDraftAction/);
  assert.match(adultEditor, /aria-invalid/);
});

test("public profile writer keeps single-hyphen input while rejecting reserved URLs", async () => {
  const actions = await source("src/app/actions.ts");
  const body = actions.slice(actions.indexOf("const publicProfileSlug ="), actions.indexOf("function submittedPublicProfileDraftValues"));
  const validate = new Function("isPublicCreatorSlug", `${stripTypeScriptTypes(body)}; return publicProfileSlugValue;`)(isPublicCreatorSlug);
  assert.equal(validate("  Thrill-Noir  "), "thrill-noir");
  assert.throws(() => validate("messages"), /reserved private URLs/);
  assert.throws(() => validate("legacy--name"), /lowercase letters, numbers and single hyphens/);
  assert.throws(() => validate("-creator"), /lowercase letters, numbers and single hyphens/);
});
