import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Instagram restriction stays account-scoped and never becomes a sent receipt", async () => {
  const scheduler = await readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8");
  assert.match(scheduler, /code\\s\*\[:=\]\?\\s\*368/);
  assert.match(scheduler, /subcode\\s\*\[:=\]\?\\s\*1404169/);
  assert.match(scheduler, /status=CASE WHEN \? THEN 'restricted'/);
  assert.match(scheduler, /write_enabled=0,outbound_validated=0/);
  assert.match(scheduler, /Do not retry until independently authorised/);
  assert.match(scheduler, /thread\.connection_status === "restricted"/);
  assert.match(scheduler, /UPDATE instagram_reply_drafts SET status=\?,error=\?/);
  assert.match(scheduler, /sent: false/);
  assert.doesNotMatch(scheduler, /status='sent'.*OAuthException/);
});
