import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Instagram message refresh validates an explicit account and keeps selected-account readiness", async () => {
  const [actions, messages] = await Promise.all([
    readFile(new URL("../src/app/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/messages/page.tsx", import.meta.url), "utf8"),
  ]);
  const refresh = actions.slice(actions.indexOf("export async function refreshInstagramMessagesAction"), actions.indexOf("export async function markInstagramThreadReadAction"));
  assert.match(refresh, /requestedAccountId = String\(formData\.get\("accountId"\)/);
  assert.match(refresh, /operational_accounts WHERE id=\? AND creator_id=@creator AND platform='instagram' AND is_active=1/);
  assert.match(refresh, /thread\.account_id !== requestedAccountId/);
  assert.match(refresh, /body: JSON\.stringify\(\{ creatorId: identity\.creator\.creator_id, accountId \}\)/);
  assert.match(messages, /getUnifiedMessages\(context\.creator\.creator_id, platform, query\.thread, query\.accountId\)/);
  assert.match(messages, /platform === "instagram" \? selectedInstagram/);
  assert.match(messages, /name="accountId"/);
});
