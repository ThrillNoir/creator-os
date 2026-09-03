import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Instagram message sync has account-scoped lease, durable failure state and bounded polling", async () => {
  const [scheduler, migration] = await Promise.all([
    readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../thot-os-app/migrations/0059_instagram_message_sync_reliability.sql", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /last_messages_attempt_at/);
  assert.match(migration, /last_messages_error/);
  assert.match(migration, /messages_sync_lease_id/);
  assert.match(migration, /messages_sync_lease_at/);
  assert.match(migration, /last_sync_error/);
  assert.match(scheduler, /INSERT OR IGNORE INTO instagram_account_sync_state \(creator_id,account_id\)/);
  assert.match(scheduler, /messages_sync_lease_id=\?,messages_sync_lease_at=CURRENT_TIMESTAMP/);
  assert.match(scheduler, /MESSAGE_SYNC_LEASE_SECONDS = 15 \* 60/);
  assert.match(scheduler, /SET messages_sync_lease_id=NULL,messages_sync_lease_at=NULL/);
  assert.match(scheduler, /last_messages_error/);
  assert.match(scheduler, /last_messages_sync_at=CURRENT_TIMESTAMP,last_messages_error=excluded\.last_messages_error/);
  assert.match(scheduler, /last_synced_at=CURRENT_TIMESTAMP,last_sync_error=\?/);
  assert.match(scheduler, /mc\.last_sync_error,mc\.read_enabled,mc\.last_synced_at/);
  assert.doesNotMatch(scheduler, /SET status='connected',read_enabled=1,last_synced_at/);
  assert.match(scheduler, /row\?\.read_enabled === 1/);
  assert.match(scheduler, /assertInstagramMessageReadEnabled\(env, connection\.messaging_connection_id, creatorId\)/);
  assert.match(scheduler, /status: \"read_disabled\"/);
  assert.match(scheduler, /status: \"busy\"/);
  assert.match(scheduler, /status: attachmentFailures \? \"partial\" : \"completed\"/);
  assert.match(scheduler, /status: \"failed\", diagnostics/);
  assert.match(scheduler, /limit: 25/);
  assert.match(scheduler, /messages\.limit\(100\)/);
  assert.match(scheduler, /mc\.read_enabled=1 AND mc\.status='connected'/);
  assert.match(scheduler, /ORDER BY COALESCE\(state\.last_messages_attempt_at/);
  assert.match(scheduler, /syncNextMessageAccount/);
  assert.match(scheduler, /remainingMessageSyncTimeout\(leaseDeadlineAt\)/);
  assert.match(scheduler, /sha256\(`\$\{creatorId\}:\$\{connection\.messaging_connection_id\}:\$\{conversation\.id\}`\)/);
  assert.match(scheduler, /sha256\(`\$\{creatorId\}:\$\{input\.messageId\}:\$\{input\.externalMessageId\}:\$\{input\.sourceKey\}`\)/);
  assert.match(scheduler, /fetchMetaMedia\(input\.sourceUrl, timeoutMs\)/);
});

test("Instagram aggregate sync cannot overwrite message-only error state", async () => {
  const scheduler = await readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8");
  const aggregate = scheduler.slice(scheduler.indexOf("async function syncInstagram("), scheduler.indexOf("async function validateInstagramReplyTarget"));
  assert.match(aggregate, /const analyticsError = result\.errors\.find\(\(error\) => error\.startsWith\("Analytics:"\)\)/);
  assert.doesNotMatch(aggregate, /recordInstagramSyncError\(env, creatorId, scopedAccountId, error\)/);
});
