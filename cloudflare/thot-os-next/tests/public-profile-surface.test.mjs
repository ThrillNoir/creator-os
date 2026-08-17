import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (file) => readFile(path.join(root, file), "utf8");

test("public profile authoring has separate draft, approval, publish and withdrawal controls", async () => {
  const [page, actions, navigation, migration] = await Promise.all([
    source("src/app/public-profile/page.tsx"),
    source("src/app/actions.ts"),
    source("src/components/app-shell.tsx"),
    source("../thot-os-app/migrations/0036_public_profile_authoring_guards.sql"),
  ]);
  assert.match(page, /savePublicProfileDraftAction/);
  assert.match(page, /approvePublicProfileVersionAction/);
  assert.match(page, /publishPublicProfileAction/);
  assert.match(page, /withdrawPublicProfileAction/);
  assert.match(page, /Private preview or source media can be selected/i);
  assert.match(actions, /requireCreatorContext\("mutate"\)/);
  assert.match(actions, /requireCreatorContext\("approve"\)/);
  assert.match(actions, /public\.profile\.publish/);
  assert.match(actions, /public\.profile\.withdraw/);
  assert.match(actions, /PUBLIC_LINKS_CONTROL/);
  assert.match(navigation, /Public profile/);
  assert.match(migration, /creator_public_profile_slug_immutable_after_publication/);
  assert.match(migration, /creator_public_profile_single_draft/);
});
