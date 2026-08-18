import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Instagram provider operations use the recorded creator connection scope", async () => {
  const scheduler = await readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8");
  assert.match(scheduler, /SELECT pc\.connected_account_id,pc\.composio_user_id/);
  assert.match(scheduler, /function storedInstagramComposioUserId/);
  assert.match(scheduler, /syncInstagramAnalytics[\s\S]*storedInstagramComposioUserId\(connection\)/);
  assert.match(scheduler, /const instagramUserId = storedInstagramComposioUserId\(connection\);/);
  assert.match(scheduler, /INSTAGRAM_GET_USER_INSIGHTS", connection\.connected_account_id, instagramUserId/);
  assert.match(scheduler, /INSTAGRAM_GET_IG_USER_MEDIA", connection\.connected_account_id, instagramUserId/);
  assert.match(scheduler, /INSTAGRAM_CREATE_MEDIA_CONTAINER", connection\.connected_account_id, instagramUserId/);
});
