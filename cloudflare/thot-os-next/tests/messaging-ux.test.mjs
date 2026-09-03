import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("attention totals include sync errors without flagging healthy read-only accounts or obsolete Instagram validation", async () => {
  const messages = await source("src/lib/messages.ts");
  const predicate = messages.match(/attention: connections\.filter\(\(connection\) =>([\s\S]*?)\)\.length/)[1];
  const needsAttention = new Function("connection", `return Boolean(${predicate});`);
  const healthy = { platform: "instagram", status: "connected", mode: "observe", write_enabled: 0, last_error: null, last_sync_error: null };
  assert.equal(needsAttention(healthy), false);
  assert.equal(needsAttention({ ...healthy, last_sync_error: "Sync completed with attachment errors." }), true);
  assert.equal(needsAttention({ ...healthy, last_error: "Provider restriction" }), true);
  assert.equal(needsAttention({ ...healthy, last_error: "Validate a conversation before the first Instagram reply." }), false);
  assert.equal(needsAttention({ ...healthy, status: "restricted" }), true);
  assert.equal(needsAttention({ ...healthy, platform: "fansly", status: "device_bridge_ready" }), false);
});

test("messages UX keeps scope visible, settings permission-aware, and actions contextual", async () => {
  const [page, actions, css] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/app/actions.ts"),
    source("src/app/globals.css"),
  ]);
  assert.match(page, /Workspace messaging totals/);
  assert.match(page, /Viewing \{connectionLabel\(selectedInstagram\)\}/);
  assert.match(page, /canApproveMessaging/);
  assert.match(page, /MessageRefreshButton/);
  assert.match(page, /open=\{canApproveMessaging/);
  assert.match(actions, /function messagesRedirect/);
  assert.match(actions, /redirect\(messagesRedirect\(formData, "authority"\)\)/);
  assert.match(actions, /instagram_messages_partial/);
  assert.match(actions, /instagram_messages_busy/);
  assert.match(actions, /instagram_messages_read_disabled/);
  assert.match(actions, /instagram_messages_failed/);
  assert.match(page, /Instagram inbox partially refreshed/);
  assert.match(page, /last_sync_error/);
  assert.match(page, /name="thread" value=\{data\.selectedThread\?\.id \?\? ""\}/);
  assert.match(css, /\.message-workspace \{ display: grid; grid-template-columns: minmax\(220px/);
  assert.match(css, /\.thread-list-actions \{ display: flex; flex-wrap: wrap/);
});

test("quick reply state is controlled and keyed by thread at the page boundary", async () => {
  const [page, reply, actions, picker] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/components/message-quick-reply.tsx"),
    source("src/app/actions.ts"),
    source("src/components/message-attachment-picker.tsx"),
  ]);
  assert.match(page, /key=\{`instagram:\$\{thread\.id\}`\}/);
  assert.match(page, /key=\{`telegram:\$\{thread\.id\}`\}/);
  assert.match(page, /key=\{`fansly:\$\{thread\.id\}`\}/);
  assert.match(reply, /useRef\(""\)/);
  assert.match(reply, /useRef<string \| null>\(null\)/);
  assert.match(reply, /retryRequestRef = useRef\(false\)/);
  assert.match(reply, /value=\{body\}/);
  assert.match(reply, /intentKeyRef\.current === intentKey \? requestIdRef\.current : crypto\.randomUUID\(\)/);
  assert.match(reply, /required=\{!assetId\}/);
  assert.match(reply, /assetId && body\.trim\(\)/);
  assert.match(reply, /disabled=\{sending\}/);
  assert.match(reply, /String\(formData\.get\("assetId"\) \?\? ""\)/);
  assert.match(reply, /event\.preventDefault\(\)/);
  assert.match(reply, /formData\.set\("inline", "1"\)/);
  assert.match(reply, /setBody\(""\)/);
  assert.match(reply, /router\.refresh\(\)/);
  assert.match(reply, /role="alert"/);
  assert.match(actions, /inlineMessageRequest/);
  assert.match(actions, /satisfies InlineMessageResult/);
  assert.match(actions, /saved: "fansly_reply_queued"/);
  assert.match(picker, /name="assetId"/);
  assert.match(picker, /Remove attachment/);
  assert.match(picker, /media-only reply/);
  assert.match(page, /getInstagramReplyAssets/);
  assert.match(page, /asset_people/);
  assert.match(page, /verified_mime_type IN/);
});

test("messaging review keeps audit collapsed and avoids unimplemented automatic-send language", async () => {
  const page = await source("src/app/messages/page.tsx");
  assert.doesNotMatch(page, /attentionEvent/);
  assert.doesNotMatch(page, /Automatic sending/);
  assert.match(page, /Operate — validated connection/);
  assert.match(page, /<details className="panel message-audit">/);
});

test("Instagram account switching is immediate and the stored inbox refreshes while visible", async () => {
  const [page, selector, refresh] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/components/message-account-selector.tsx"),
    source("src/components/message-auto-refresh.tsx"),
  ]);
  assert.match(page, /MessageAccountSelector/);
  assert.match(page, /MessageAutoRefresh/);
  assert.match(page, /instagramConversationCount = instagramConnections\.reduce/);
  assert.match(page, /item === "instagram" \? `\$\{instagramConnections\.length\} account/);
  assert.match(selector, /method="get" action="\/messages"/);
  assert.match(selector, /name="thread" value=""/);
  assert.match(selector, /<noscript>/);
  assert.match(selector, /router\.push/);
  assert.match(selector, /accountId: event\.currentTarget\.value/);
  assert.match(refresh, /intervalMs = 30_000/);
  assert.match(refresh, /document\.visibilityState === "visible"/);
  assert.match(refresh, /router\.refresh\(\)/);
});
