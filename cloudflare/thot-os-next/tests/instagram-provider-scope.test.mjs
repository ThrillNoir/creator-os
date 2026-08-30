import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Instagram delivery uses a creator-scoped, verified R2 object without retaining a URL", async () => {
  const scheduler = await readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8");
  assert.match(scheduler, /SELECT pc\.connected_account_id,pc\.composio_user_id/);
  assert.match(scheduler, /function storedInstagramComposioUserId/);
  assert.match(scheduler, /syncInstagramAnalytics[\s\S]*storedInstagramComposioUserId\(connection\)/);
  assert.match(scheduler, /INSTAGRAM_GET_USER_INSIGHTS", connection\.connected_account_id, instagramUserId/);
  assert.match(scheduler, /authority_kind='r2_native'/);
  assert.match(scheduler, /immutableR2IdentityMatches/);
  assert.match(scheduler, /INSTAGRAM_CREATE_MEDIA_CONTAINER/);
  assert.match(scheduler, /INSTAGRAM_CREATE_POST/);
  assert.match(scheduler, /currentInstagramPublishConnection\(env, post\)/);
  assert.match(scheduler, /WHERE oa\.creator_id=\? AND oa\.id=\? AND oa\.platform='instagram' AND oa\.connection_status='connected'/);
  assert.match(scheduler, /verified_mime_type\.toLowerCase\(\) !== format\[0\]/);
  assert.match(scheduler, /INSTAGRAM_GET_POST_STATUS[\s\S]*\{ creation_id: containerId \}/);
  assert.match(scheduler, /attempt < 60/);
  assert.match(scheduler, /publishStarted \|\| error instanceof OutcomeUncertainError/);
  assert.doesNotMatch(scheduler, /ig_container_id/);
  assert.doesNotMatch(scheduler, /instagram_r2_provider_handoff_not_implemented/);
  assert.doesNotMatch(scheduler, /dropbox/i);
});
