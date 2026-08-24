import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Stage 3B keeps manual analytics reads separate from messages and outbound operations", async () => {
  const [actions, scheduler, operations] = await Promise.all([
    readFile(new URL("../src/app/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/operations/page.tsx", import.meta.url), "utf8"),
  ]);
  const refresh = actions.slice(actions.indexOf("export async function refreshInstagramDataAction"), actions.indexOf("export async function refreshInstagramMessagesAction"));
  assert.match(refresh, /instagram\.sync\.execute/);
  assert.match(refresh, /https:\/\/instagram-scheduler\/sync\/analytics/);
  assert.doesNotMatch(refresh, /revalidatePath\("\/messages"/);
  assert.match(scheduler, /"POST \/sync\/analytics": "instagram\.sync\.execute"/);
  assert.match(scheduler, /async function currentInstagramAnalyticsConnection/);
  assert.match(scheduler, /syncInstagramAnalytics[\s\S]*currentInstagramAnalyticsConnection/);
  assert.match(scheduler, /collectInstagramAnalytics\(env, creator\.creator_id, "cron"\)/);
  assert.match(scheduler, /instagram_analytics_collection_runs_one_active|collection_in_progress/);
  assert.match(operations, /does not read messages, modify the account or publish/);
});
