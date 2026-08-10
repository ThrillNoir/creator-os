import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("OpenNext worker keeps the existing private D1 and R2 bindings", async () => {
  const config = await source("wrangler.jsonc");
  assert.match(config, /"name": "thot-os-staging"/);
  assert.match(config, /174532e8-5ada-4e30-abba-1276b3540b3f/);
  assert.match(config, /thot-os-previews-staging/);
  assert.match(config, /ACCESS_ALLOWED_EMAIL/);
});

test("cloud library writes are creator scoped and audited", async () => {
  const actions = await source("src/app/actions.ts");
  assert.match(actions, /creator_id='adelaide'/);
  assert.match(actions, /asset_classification_events/);
  assert.match(actions, /NSFW assets can only be marked for X, Reddit, subscription or PPV/);
  assert.match(actions, /slice\(0, 50\)/);
  assert.match(actions, /asset_paid_consent_attestations/);
  assert.match(actions, /peopleMode/);
});

test("private previews require a matching Adelaide D1 asset", async () => {
  const route = await source("src/app/api/preview/[objectId]/route.ts");
  assert.match(route, /requireAccessIdentity/);
  assert.match(route, /creator_id='adelaide' AND preview_r2_key=\?/);
  assert.match(route, /private, max-age=86400/);
});

test("library supports list view and copy-then-apply batch attributes", async () => {
  const [page,card] = await Promise.all([source("src/app/library/page.tsx"),source("src/components/asset-card.tsx")]);
  assert.match(page, /filters\.view === "list"/);
  assert.match(card, /Copy attributes/);
  assert.match(page, /getAssetByObjectId/);
});

test("workspace navigation shows working modules without a disabled-module wall", async () => {
  const shell = await source("src/components/app-shell.tsx");
  assert.match(shell, /WORKSPACE/);
  assert.match(shell, /Migration progress/);
  assert.doesNotMatch(shell, /MIGRATING NEXT/);
  assert.doesNotMatch(shell, /const upcoming/);
});

test("asset classification progressively reveals valid destinations and enforces paid consent", async () => {
  const [fields, actions] = await Promise.all([source("src/components/attribute-fields.tsx"), source("src/app/actions.ts")]);
  assert.match(fields, /Destinations appear after safety is set/);
  assert.match(fields, /nsfwDestinations/);
  assert.match(fields, /isMulti && multiFields/);
  assert.match(actions, /Paid multi-creator content requires/);
});

test("health and library APIs preserve authenticated staging contracts", async () => {
  const [health, library] = await Promise.all([source("src/app/health/route.ts"), source("src/app/api/library/route.ts")]);
  assert.match(health, /nextjs-opennext/);
  assert.match(health, /requireAccessIdentity/);
  assert.match(library, /creatorId !== "adelaide"/);
  assert.match(library, /requireAccessIdentity/);
});

test("all social platform workspaces are consolidated under Operations", async () => {
  const [shell, operations, legacyReddit] = await Promise.all([source("src/components/app-shell.tsx"), source("src/app/operations/page.tsx"), source("src/app/reddit/page.tsx")]);
  assert.match(shell, /Operations/);
  assert.match(operations, /operationPlatforms/);
  assert.match(operations, /RedditWorkspace/);
  assert.match(legacyReddit, /redirect\("\/operations\?platform=reddit"\)/);
  assert.doesNotMatch(shell, /\["[^\"]+", "Reddit", "\/reddit"\]/);
});

test("Operations data and Reddit scheduling stay creator scoped and audited", async () => {
  const [operations, page, actions, migration, communityEvents] = await Promise.all([source("src/lib/operations.ts"), source("src/app/operations/page.tsx"), source("src/app/actions.ts"), source("../thot-os-app/migrations/0003_operations_foundation.sql"), source("../thot-os-app/migrations/0017_reddit_community_events.sql")]);
  assert.match(operations, /creator_id='adelaide'/);
  assert.match(actions, /createRedditPostAction/);
  assert.match(actions, /saveRedditCommunityAction/);
  assert.match(actions, /ON CONFLICT\(creator_id,name\) DO UPDATE/);
  assert.match(actions, /community’s current rules before saving/);
  assert.match(actions, /social_post_events/);
  assert.match(actions, /d\.destination='reddit'/);
  assert.match(page, /Add a community/);
  assert.match(page, /Save community/);
  assert.match(page, /rulesChecked/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operational_accounts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS social_posts/);
  assert.match(communityEvents, /CREATE TABLE IF NOT EXISTS reddit_community_events/);
});

test("Reddit delivery uses a private cron worker with claims and receipts", async () => {
  const [config, actions, operations, scheduler, bridge, migration, controlsMigration, nativeMigration, manifest, background] = await Promise.all([
    source("wrangler.jsonc"),
    source("src/app/actions.ts"),
    source("src/app/operations/page.tsx"),
    source("../reddit-scheduler/src/index.ts"),
    source("../vault-bridge/src/index.ts"),
    source("../thot-os-app/migrations/0004_reddit_scheduler.sql"),
    source("../thot-os-app/migrations/0005_reddit_queue_controls.sql"),
    source("../thot-os-app/migrations/0008_reddit_native_bridge.sql"),
    source("../../public/local-bridge-extension/manifest.json"),
    source("../../public/local-bridge-extension/background.js"),
  ]);
  assert.match(config, /REDDIT_SCHEDULER/);
  assert.match(actions, /startRedditReconnectAction/);
  assert.match(actions, /cancelRedditPostAction/);
  assert.match(actions, /reviewFailedRedditPostAction/);
  assert.match(operations, /value="publish_now">Post now/);
  assert.match(operations, /Open Reddit receipt/);
  assert.match(scheduler, /status='publishing'/);
  assert.match(scheduler, /unixepoch\(p\.scheduled_at\)<=unixepoch\(CURRENT_TIMESTAMP\)/);
  assert.match(scheduler, /posts\/reddit\/publish/);
  assert.match(scheduler, /native_delivery_queued/);
  assert.doesNotMatch(scheduler, /REDDIT_CREATE_REDDIT_POST/);
  assert.doesNotMatch(scheduler, /DROPBOX_GET_TEMPORARY_LINK/);
  assert.match(scheduler, /Outcome uncertain; verify Reddit before retrying/);
  assert.match(bridge, /DROPBOX_GET_TEMPORARY_LINK/);
  assert.match(bridge, /native_publish_completed/);
  assert.match(bridge, /REDDIT_POST_REDDIT_COMMENT/);
  assert.match(bridge, /The signed-in Reddit browser does not match Adelaide/);
  assert.match(nativeMigration, /CREATE TABLE reddit_bridge_tokens/);
  assert.match(manifest, /0\.7\.4/);
  assert.match(background, /creator_os_reddit_pair/);
  assert.match(background, /prepareAndSubmitRedditPost/);
  assert.match(migration, /CREATE TABLE scheduler_runs/);
  assert.match(migration, /CREATE TABLE provider_connections/);
  assert.match(controlsMigration, /failure_reviewed_at/);
});

test("Instagram Operations uses verified OAuth, explicit approval, and a private scheduler", async () => {
  const [config, actions, operations, callback, scheduler, migration, completionMigration] = await Promise.all([
    source("wrangler.jsonc"),
    source("src/app/actions.ts"),
    source("src/app/operations/page.tsx"),
    source("src/app/api/operations/instagram/callback/route.ts"),
    source("../instagram-scheduler/src/index.ts"),
    source("../thot-os-app/migrations/0006_instagram_operations.sql"),
    source("../thot-os-app/migrations/0011_instagram_completion.sql"),
  ]);
  assert.match(config, /INSTAGRAM_SCHEDULER/);
  assert.match(actions, /createInstagramPostAction/);
  assert.match(actions, /startInstagramReconnectAction/);
  assert.match(actions, /Instagram publishing requires an asset classified SFW/);
  assert.match(actions, /INSERT OR IGNORE INTO social_posts/);
  assert.match(actions, /refreshInstagramDataAction/);
  assert.match(operations, /InstagramWorkspace/);
  assert.match(operations, /Instagram performance/);
  assert.match(callback, /requireAccessIdentity/);
  assert.match(scheduler, /INSTAGRAM_GET_USER_INFO/);
  assert.match(scheduler, /INSTAGRAM_CREATE_MEDIA_CONTAINER/);
  assert.match(scheduler, /INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH/);
  assert.match(scheduler, /INSTAGRAM_GET_IG_MEDIA/);
  assert.match(scheduler, /INSTAGRAM_LIST_ALL_CONVERSATIONS/);
  assert.match(scheduler, /INSTAGRAM_GET_USER_INSIGHTS/);
  assert.match(scheduler, /outbound_validated=0/);
  assert.match(scheduler, /status='publishing'/);
  assert.match(scheduler, /unixepoch\(p\.scheduled_at\)<=unixepoch\(CURRENT_TIMESTAMP\)/);
  assert.match(scheduler, /Outcome uncertain; verify Instagram before retrying/);
  assert.match(migration, /provider_container_id/);
  assert.match(completionMigration, /CREATE TABLE IF NOT EXISTS instagram_sync_state/);
  assert.match(completionMigration, /CREATE TABLE IF NOT EXISTS instagram_analytics_snapshots/);
});

test("Vault Operations exposes the signed Fansly queue and protects device claims", async () => {
  const [actions, operations, page, bridge, migration, manifest, background] = await Promise.all([
    source("src/app/actions.ts"),
    source("src/lib/operations.ts"),
    source("src/app/operations/page.tsx"),
    source("../vault-bridge/src/index.ts"),
    source("../thot-os-app/migrations/0007_vault_bridge.sql"),
    source("../../public/local-bridge-extension/manifest.json"),
    source("../../public/local-bridge-extension/background.js"),
  ]);
  assert.match(page, /Send approved content to the vault/);
  assert.match(page, /Open & pair Fansly vault/);
  assert.match(page, /action="\/api\/fansly\/pair" method="post" target="_blank"/);
  assert.match(page, /name="destination" value="vault"/);
  assert.match(actions, /createFanslyVaultJobsAction/);
  assert.match(actions, /verifyFanslyVaultJobAction/);
  assert.match(operations, /getVaultOperations/);
  assert.match(bridge, /explicit-v4/);
  assert.match(bridge, /DROPBOX_GET_TEMPORARY_LINK/);
  assert.match(bridge, /status='claimed'/);
  assert.match(migration, /CREATE TABLE vault_bridge_tokens/);
  assert.match(manifest, /0\.7\.4/);
  assert.match(background, /creator-os-cloud-pair-token/);
});

test("Unified Messages is creator scoped, auditable and fail-closed for outbound delivery", async () => {
  const [page, messages, actions, shell, config, migration, connectorMigration, bridge] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/lib/messages.ts"),
    source("src/app/actions.ts"),
    source("src/components/app-shell.tsx"),
    source("wrangler.jsonc"),
    source("../thot-os-app/migrations/0009_unified_messages.sql"),
    source("../thot-os-app/migrations/0010_telegram_connector.sql"),
    source("../telegram-bridge/src/index.ts"),
  ]);
  assert.match(shell, /"Messages", "\/messages"/);
  assert.match(page, /Enter-to-send messaging/);
  assert.match(page, /Telegram receipts/);
  assert.match(messages, /creator_id='adelaide'/);
  assert.match(actions, /Controlled outbound validation is required/);
  assert.match(actions, /messaging_audit_events/);
  assert.match(migration, /CREATE TABLE messaging_connections/);
  assert.match(migration, /CREATE TABLE message_threads/);
  assert.match(migration, /CREATE TABLE telegram_send_log/);
  assert.match(migration, /"liveMessagesSent":false/);
  assert.match(config, /TELEGRAM_BRIDGE/);
  assert.match(page, /Validate bot & pairing/);
  assert.match(actions, /sendTelegramCreatorMessageAction/);
  assert.match(connectorMigration, /CREATE TABLE telegram_connector_state/);
  assert.match(bridge, /TELEGRAM_GET_UPDATES/);
  assert.match(bridge, /TELEGRAM_SEND_MESSAGE/);
  assert.match(bridge, /message_not_sendable/);
  assert.match(bridge, /telegram_reply_collected/);
});

test("Unified Messages accepts both D1 and ISO UTC timestamps", async () => {
  const page = await source("src/app/messages/page.tsx");
  assert.match(page, /\(\?:Z\|\[\+\-\]\\d\{2\}:\?\\d\{2\}\)\$/);
  assert.match(page, /Number\.isNaN\(date\.getTime\(\)\)/);
});

test("Telegram and Fansly operate inside the unified thread with explicit device receipts", async () => {
  const [page, quickReply, messages, actions, telegram, vault, migration, extension, manifest] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/components/message-quick-reply.tsx"),
    source("src/lib/messages.ts"),
    source("src/app/actions.ts"),
    source("../telegram-bridge/src/index.ts"),
    source("../vault-bridge/src/index.ts"),
    source("../thot-os-app/migrations/0016_telegram_fansly_messages.sql"),
    source("../../public/local-bridge-extension/background.js"),
    source("../../public/local-bridge-extension/manifest.json"),
  ]);
  assert.match(page, /TelegramComposer/);
  assert.match(page, /FanslyComposer/);
  assert.match(page, /Open & pair/);
  assert.match(page, /MessageQuickReply platform="telegram"/);
  assert.match(page, /MessageQuickReply platform="fansly"/);
  assert.match(page, /No Fansly action is required/);
  assert.match(quickReply, /Enter to send/);
  assert.match(quickReply, /Shift\+Enter/);
  assert.match(quickReply, /requestSubmit/);
  assert.match(messages, /premium_message_drafts/);
  assert.match(actions, /refreshTelegramMessagesAction/);
  assert.match(actions, /openFanslyMessagesAction/);
  assert.match(actions, /sendFanslyReplyAction/);
  assert.match(actions, /directComposer: true/);
  assert.match(telegram, /Telegram reply_collected|telegram_reply_collected/);
  assert.match(telegram, /attachmentLabel/);
  assert.match(vault, /ingestFanslyMessages/);
  assert.match(vault, /fanslyOutbox/);
  assert.match(vault, /nextFanslyOutbox/);
  assert.match(vault, /messages\/outbox\/next/);
  assert.match(vault, /device_submitted/);
  assert.match(migration, /CREATE TABLE premium_message_drafts/);
  assert.match(migration, /CREATE TABLE premium_thread_sync_state/);
  assert.match(extension, /messageBridgeRequest/);
  assert.match(extension, /messageBridgeRequest\(config,"\/ingest"/);
  assert.match(extension, /Fansly surface readiness/);
  assert.match(extension, /textarea\.message-input/);
  assert.match(manifest, /"version": "0\.7\.4"/);
  assert.match(extension, /app-button\.send-button\.can-send/);
  assert.match(extension, /fanslyMessageGroup/);
  assert.match(extension, /pageHidden/);
  assert.match(extension, /sendControlDeadline/);
  assert.match(extension, /outgoingBubbleAdded/);
  assert.match(extension, /processFanslyMessageOutbox/);
  assert.match(extension, /syncFanslyFeed/);
  assert.match(extension, /creatorOsFanslyListSyncedAt/);
  assert.match(extension, /rotationInterval=platform==="fansly"\?25000:55000/);
  assert.match(extension, /thot-os-fansly-outbox/);
  assert.match(vault, /last_seen_at<datetime\('now','-5 minutes'\)/);
  assert.match(vault, /importedMessages > 0 \|\| changedThreads > 0/);
});

test("Instagram replies use one-step Enter sending with subscriptions, validation and receipts", async () => {
  const [page, messages, actions, scheduler, migration, windowMigration, subscriptionMigration] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/lib/messages.ts"),
    source("src/app/actions.ts"),
    source("../instagram-scheduler/src/index.ts"),
    source("../thot-os-app/migrations/0012_instagram_replies.sql"),
    source("../thot-os-app/migrations/0013_instagram_reply_window.sql"),
    source("../thot-os-app/migrations/0014_instagram_message_subscription.sql"),
  ]);
  assert.doesNotMatch(page, /Save reply draft/);
  assert.doesNotMatch(page, /Confirm send to/);
  assert.match(page, /MessageQuickReply platform="instagram"/);
  assert.match(page, /Validate reply target/);
  assert.match(actions, /sendInstagramQuickReplyAction/);
  assert.match(actions, /instagram_quick_send_requested/);
  assert.match(actions, /enterToSend: true/);
  assert.match(messages, /instagram_reply_drafts/);
  assert.match(scheduler, /INSTAGRAM_LIST_ALL_MESSAGES/);
  assert.match(scheduler, /INSTAGRAM_SEND_TEXT_MESSAGE/);
  assert.match(scheduler, /Outcome uncertain; check Instagram before sending again/);
  assert.match(scheduler, /Instagram's active reply window is closed/);
  assert.match(scheduler, /isDefinitiveInstagramRejection/);
  assert.match(scheduler, /ensureInstagramMessageSubscriptions/);
  assert.match(scheduler, /subscribed_apps/);
  assert.match(scheduler, /graph_api_version: "v25\.0"/);
  assert.match(messages, /last_inbound_at/);
  assert.match(messages, /ORDER BY unixepoch\(replace\(substr\(COALESCE\(m\.sent_at,m\.created_at\),1,19\),'T',' '\)\),m\.id/);
  assert.match(page, /reply window closed/);
  assert.match(page, /data\.selectedThread\?\.participant_name/);
  assert.match(migration, /CREATE TABLE instagram_reply_drafts/);
  assert.match(migration, /liveMessagesSent.*false/);
  assert.match(windowMigration, /status='failed'/);
  assert.match(windowMigration, /provider_403_outside_allowed_window/);
  assert.match(subscriptionMigration, /instagram_webhook_subscription_repaired/);
  assert.match(subscriptionMigration, /liveMessageSent.*false/);
});

test("Instagram message refresh stores private media and keeps read state provider-confirmed", async () => {
  const [page, messages, actions, scheduler, schedulerConfig, attachmentRoute, migration] = await Promise.all([
    source("src/app/messages/page.tsx"),
    source("src/lib/messages.ts"),
    source("src/app/actions.ts"),
    source("../instagram-scheduler/src/index.ts"),
    source("../instagram-scheduler/wrangler.jsonc"),
    source("src/app/api/message-attachment/[attachmentId]/route.ts"),
    source("../thot-os-app/migrations/0015_message_attachments.sql"),
  ]);
  assert.match(page, /InstagramAttachmentView/);
  assert.match(page, /Refresh/);
  assert.match(page, /Mark read/);
  assert.match(page, /Instagram sends & receipts/);
  assert.match(messages, /message_attachments/);
  assert.match(actions, /refreshInstagramMessagesAction/);
  assert.match(actions, /markInstagramThreadReadAction/);
  assert.match(scheduler, /messages\.limit\(100\).*attachments,shares,story/);
  assert.match(scheduler, /INSTAGRAM_MARK_SEEN/);
  assert.match(scheduler, /MAX_MESSAGE_MEDIA_BYTES/);
  assert.match(schedulerConfig, /"binding": "PREVIEWS"/);
  assert.match(attachmentRoute, /requireAccessIdentity/);
  assert.match(attachmentRoute, /creator_id='adelaide'/);
  assert.match(attachmentRoute, /PREVIEWS\.get/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_attachments/);
  assert.match(migration, /"privateR2Media":true/);
});

test("review fixes preserve platform-specific queue IDs and messaging authority", async () => {
  const [actions, scheduler] = await Promise.all([source("src/app/actions.ts"), source("../instagram-scheduler/src/index.ts")]);
  assert.match(actions, /postId = `reddit-/);
  assert.match(actions, /Reconnect and verify Instagram before approving delivery/);
  assert.doesNotMatch(scheduler, /SET status='connected',read_enabled=1,write_enabled=0,last_synced_at/);
});
