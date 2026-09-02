import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("creator onboarding exposes the complete invitation-to-active lifecycle", async () => {
  const [identity, actions, page, creator, authorization] = await Promise.all([
    source("../src/app/identity-actions.ts"),
    source("../src/app/onboarding/actions.ts"),
    source("../src/app/onboarding/page.tsx"),
    source("../src/components/creator-onboarding.tsx"),
    source("../src/lib/authorization.ts"),
  ]);
  assert.match(identity, /status='accepted'/);
  assert.match(identity, /INSERT INTO creator_memberships[\s\S]*?'creator'/);
  assert.match(actions, /workflow_state='creator_review'/);
  assert.match(actions, /\.bind\(creatorId, section, isCreator \? "draft" : "admin_review", email, isCreator \? 1 : 0\)\.run\(\)/);
  assert.match(actions, /status = admin \? "complete" : "creator_review"/);
  assert.match(actions, /workflow_state='admin_review'/);
  assert.match(actions, /workflow_state='active'/);
  assert.match(actions, /UPDATE operational_accounts SET is_active=1[\s\S]*publishing_authority='not_configured'/);
  assert.match(page, /workflow_state/);
  assert.match(page, /Password needs to be entered again/);
  assert.match(creator, /sentForReview = \["creator_review", "admin_review"\]\.includes\(profile\?\.workflow_state/);
  assert.match(creator, /Send updated onboarding for review/);
  assert.doesNotMatch(creator, /reviewKeys\.every/);
  assert.match(authorization, /agency_admin: new Set\(\["view", "mutate", "approve", "manage_identity"\]\)/);
  assert.doesNotMatch(authorization, /operator: new Set\([^\n]*manage_identity/);
});

test("agency administrators receive a direct onboarding review queue and navigation notice", async () => {
  const [creators, identityActions, shell, navigation] = await Promise.all([
    source("../src/app/creators/page.tsx"),
    source("../src/app/identity-actions.ts"),
    source("../src/components/app-shell.tsx"),
    source("../src/components/app-navigation.tsx"),
  ]);
  assert.match(creators, /Onboarding reviews/);
  assert.match(creators, /workflow_state === "creator_review"/);
  assert.match(creators, /name="returnTo"[^>]+value="\/onboarding"/);
  assert.match(identityActions, /formData\.get\("returnTo"\) === "\/onboarding"/);
  assert.match(shell, /profile\.workflow_state IN \('creator_review','admin_review'\)/);
  assert.match(shell, /navigationNotices=\{\{ Creators: reviewCount \}\}/);
  assert.match(navigation, /notices\[label\]/);
});
