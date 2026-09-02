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
  assert.match(config, /"images":\s*\{\s*"binding":\s*"IMAGES"/);
  assert.match(config, /ACCESS_ALLOWED_EMAIL/);
});

test("cloud library writes are creator scoped and audited", async () => {
  const actions = await source("src/app/actions.ts");
  assert.match(actions, /requireCreatorContext\("mutate"\)/);
  assert.match(actions, /creatorPrepare\(DB, creatorId/);
  assert.doesNotMatch(actions, /creator_id=['"]adelaide['"]/i);
  assert.match(actions, /asset_classification_events/);
  assert.match(actions, /NSFW assets can only be marked for X, Reddit, subscription or PPV/);
  assert.match(actions, /slice\(0, 50\)/);
  assert.match(actions, /asset_paid_consent_attestations/);
  assert.match(actions, /peopleMode/);
});

test("private previews require a matching authorised creator D1 asset", async () => {
  const route = await source("src/app/api/preview/[objectId]/route.ts");
  assert.match(route, /requireCreatorContext/);
  assert.match(route, /ma\.authority_kind='r2_native'/);
  assert.match(route, /a\.creator_id=\?/);
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
  assert.doesNotMatch(shell, /Migration progress/);
  assert.doesNotMatch(shell, /MIGRATING NEXT/);
  assert.doesNotMatch(shell, /const upcoming/);
  assert.match(shell, /Money & health/);
});

test("money and health keeps finance creator scoped, auditable, and currencies separate", async () => {
  const [page, actions, finance, migration] = await Promise.all([
    source("src/app/money/page.tsx"),
    source("src/app/money-actions.ts"),
    source("src/lib/finance.ts"),
    source("../thot-os-app/migrations/0024_finance_foundation.sql"),
  ]);
  assert.match(page, /Currencies stay separate/);
  assert.match(page, /THOT OS will not estimate missing revenue/);
  assert.match(actions, /requireCreatorContext\("mutate"\)/);
  assert.match(actions, /requireCreatorContext\("manage_identity"\)/);
  assert.match(actions, /finance_csv_imported/);
  assert.match(actions, /ON CONFLICT\(creator_id,platform,period_date,currency\)/);
  assert.match(finance, /creator_id=@creator/);
  assert.match(finance, /external_post_id IS NOT NULL AND external_url IS NOT NULL/);
  assert.match(migration, /net_revenue_minor INTEGER NOT NULL/);
  assert.match(migration, /UNIQUE\(creator_id, platform, content_hash\)/);
});

test("connection setup is creator scoped and keeps native sign-in separate", async () => {
  const [shell, page, actions, pairing, library] = await Promise.all([
    source("src/components/app-shell.tsx"), source("src/app/accounts/page.tsx"), source("src/app/actions.ts"),
    source("src/lib/fansly-pairing.ts"), source("src/app/library/page.tsx"),
  ]);
  assert.match(shell, /Accounts & connections/);
  assert.match(page, /Official Instagram connection/);
  assert.match(page, /Profiles received during onboarding/);
  assert.match(page, /Configure \$\{account\.platform\} API/);
  assert.match(page, /No THOT OS connector available yet/);
  assert.match(page, /Pair bridge and open vault/);
  assert.doesNotMatch(page, /name="password"/);
  assert.match(actions, /addFanslyAccountAction/);
  assert.match(actions, /requireCreatorContext\("manage_identity"\)/);
  assert.match(pairing, /Confirm the signed-in Fansly identity before pairing the bridge/);
  assert.match(library, /R2 library/);
  assert.doesNotMatch([page, actions, library].join("\n"), /dropbox/i);
});

test("R2 previews are queued, idempotent, private, and report live progress", async () => {
  const [bridge, config, finalize, progress, statusRoute] = await Promise.all([
    source("../vault-bridge/src/index.ts"), source("../vault-bridge/wrangler.jsonc"),
    source("src/app/api/source-media/intents/[sessionId]/finalize/route.ts"),
    source("src/components/preview-progress.tsx"), source("src/app/api/library/preview-status/route.ts"),
  ]);
  assert.match(config, /thot-os-preview-staging/);
  assert.match(config, /thot-os-preview-dlq-staging/);
  assert.match(config, /"binding": "IMAGES"/);
  assert.match(finalize, /queue\?\.send/);
  assert.match(bridge, /async queue\(batch: MessageBatch<PreviewQueueMessage>/);
  assert.match(bridge, /env\.IMAGES\.input/);
  assert.match(bridge, /env\.PREVIEWS\.put/);
  assert.match(progress, /preview-status/);
  assert.match(statusRoute, /getPreviewProgress/);
  assert.doesNotMatch(bridge, /dropbox/i);
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
  assert.match(health, /requireCreatorContext/);
  assert.match(health, /const deployment = getDeploymentMetadata\(\)/);
  assert.match(health, /SELECT name FROM d1_migrations/);
  assert.match(health, /bindings: \{ d1:/);
  assert.match(library, /getCreatorContext\(creatorId\)/);
  assert.match(library, /status: 404/);
});

test("protected health metadata records a safe deployment identity", async () => {
  const { getDeploymentMetadata } = await import("../src/lib/deployment-metadata.ts");
  assert.deepEqual(getDeploymentMetadata({ component: "web", environment: "staging", gitSha: "abc123", gitBranch: "main", buildTime: "2026-08-15T00:00:00.000Z" }), {
    component: "web",
    environment: "staging",
    gitSha: "abc123",
    gitBranch: "main",
    buildTime: "2026-08-15T00:00:00.000Z",
  });
});

test("all social platform workspaces are consolidated under Operations", async () => {
  const [shell, operations, legacyReddit] = await Promise.all([source("src/components/app-shell.tsx"), source("src/app/operations/page.tsx"), source("src/app/reddit/page.tsx")]);
  assert.match(shell, /Operations/);
  assert.match(operations, /operationPlatforms/);
  assert.match(operations, /RedditWorkspace/);
  assert.match(operations, /select name="accountId"/);
  assert.doesNotMatch(operations, /onChange=/);
  assert.match(legacyReddit, /redirect\("\/operations\?platform=reddit"\)/);
  assert.doesNotMatch(shell, /\["[^\"]+", "Reddit", "\/reddit"\]/);
});

test("Operations data and Reddit scheduling stay creator scoped and audited", async () => {
  const [operations, page, actions, migration, communityEvents] = await Promise.all([source("src/lib/operations.ts"), source("src/app/operations/page.tsx"), source("src/app/actions.ts"), source("../thot-os-app/migrations/0003_operations_foundation.sql"), source("../thot-os-app/migrations/0017_reddit_community_events.sql")]);
  assert.match(operations, /creator_id=\?/);
  assert.match(operations, /operational_accounts WHERE creator_id=\? AND platform=\? AND is_active=1/);
  assert.match(page, /account\.platform === "instagram" \|\| account\.platform === "reddit" \|\| account\.platform === "fansly"/);
  assert.doesNotMatch(operations, /creator_id=['"]adelaide['"]/i);
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

test("Reddit delivery uses verified R2 media and the approved API", async () => {
  const [config, scheduler] = await Promise.all([source("wrangler.jsonc"), source("../reddit-scheduler/src/index.ts")]);
  assert.match(config, /REDDIT_SCHEDULER/);
  assert.match(scheduler, /authority_kind='r2_native'/);
  assert.match(scheduler, /o\.object_key=a\.media_r2_key/);
  assert.match(scheduler, /api\/media\/asset\.json/);
  assert.match(scheduler, /api\/submit/);
  assert.match(scheduler, /findPublishedImage/);
  assert.match(scheduler, /Outcome uncertain; verify Reddit before retrying/);
  assert.doesNotMatch(scheduler, /dropbox/i);
});

test("Instagram Operations retains OAuth and publishes only verified private R2 authority", async () => {
  const [config, actions, scheduler] = await Promise.all([
    source("wrangler.jsonc"), source("src/app/actions.ts"), source("../instagram-scheduler/src/index.ts"),
  ]);
  assert.match(config, /INSTAGRAM_SCHEDULER/);
  assert.match(actions, /startInstagramReconnectAction/);
  assert.match(actions, /Instagram publishing requires an asset classified SFW/);
  assert.match(scheduler, /authority_kind='r2_native'/);
  assert.match(scheduler, /INSTAGRAM_CREATE_MEDIA_CONTAINER/);
  assert.match(scheduler, /INSTAGRAM_LIST_ALL_CONVERSATIONS/);
  assert.doesNotMatch(scheduler, /dropbox/i);
});

test("Vault Operations exposes the signed R2-backed Fansly queue", async () => {
  const [actions, bridge, manifest, background] = await Promise.all([
    source("src/app/actions.ts"), source("../vault-bridge/src/index.ts"),
    source("../../public/local-bridge-extension/manifest.json"), source("../../public/local-bridge-extension/background.js"),
  ]);
  assert.match(actions, /createFanslyVaultJobsAction/);
  assert.match(bridge, /explicit-v4/);
  assert.match(bridge, /o\.object_key=a\.media_r2_key/);
  assert.match(bridge, /status='claimed'/);
  assert.match(bridge, /bridge_credentials/);
  assert.match(manifest, /"version": "1\.0\.0"/);
  assert.match(background, /creator_os_bridge_pair/);
  assert.doesNotMatch([bridge, manifest, background].join("\n"), /dropbox|localhost|reddit|onlyfans/i);
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
  assert.match(messages, /creator_id=\?/);
  assert.doesNotMatch(messages, /creator_id=['"]adelaide['"]/i);
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

test("Telegram pairing provisions only its creator-scoped service capabilities", async () => {
  const actions = await source("src/app/actions.ts");
  assert.match(actions, /const telegramServiceCapabilities = \["telegram\.status\.read", "telegram\.connection\.manage", "telegram\.messages\.sync", "telegram\.messages\.write"\]/);
  assert.match(actions, /INSERT OR IGNORE INTO service_principal_creator_grants/);
  assert.match(actions, /p\.principal_name='thot-os-web-telegram'/);
  assert.match(actions, /telegram_service_grants_provisioned/);
  assert.doesNotMatch(actions, /ensureTelegramServiceGrants[\s\S]{0,2000}(?:instagram|reddit|public\.profile)/);
});

test("Unified Messages accepts both D1 and ISO UTC timestamps", async () => {
  const page = await source("src/app/messages/page.tsx");
  assert.match(page, /\(\?:Z\|\[\+\-\]\\d\{2\}:\?\\d\{2\}\)\$/);
  assert.match(page, /Number\.isNaN\(date\.getTime\(\)\)/);
});

test("Telegram and Fansly operate inside the unified thread with explicit device receipts", async () => {
  const [actions, telegram, vault, extension, manifest] = await Promise.all([
    source("src/app/actions.ts"), source("../telegram-bridge/src/index.ts"), source("../vault-bridge/src/index.ts"),
    source("../../public/local-bridge-extension/background.js"), source("../../public/local-bridge-extension/manifest.json"),
  ]);
  assert.match(actions, /sendFanslyReplyAction/);
  assert.match(telegram, /telegram_reply_collected/);
  assert.match(vault, /ingestFanslyMessages/);
  assert.match(vault, /fanslyOutbox/);
  assert.match(vault, /device_submitted/);
  assert.match(extension, /messageBridgeRequest/);
  assert.match(extension, /textarea\.message-input/);
  assert.match(extension, /processFanslyMessageOutbox/);
  assert.match(extension, /syncFanslyFeed/);
  assert.match(manifest, /"version": "1\.0\.0"/);
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
  assert.match(attachmentRoute, /requireCreatorContext/);
  assert.match(attachmentRoute, /a\.creator_id=\?/);
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

test("multi-creator identity, permissions and Chrome-profile pairing are D1-backed", async () => {
  const [migration, identity, authorization, access, shell, creators, bridge, extension] = await Promise.all([
    source("../thot-os-app/migrations/0018_creator_identity_profiles.sql"),
    source("src/lib/identity.ts"),
    source("src/lib/authorization.ts"),
    source("src/lib/access.ts"),
    source("src/components/app-shell.tsx"),
    source("src/app/creators/page.tsx"),
    source("../vault-bridge/src/index.ts"),
    source("../../public/local-bridge-extension/background.js"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS creator_memberships/);
  assert.match(migration, /agency_admin.*operator.*creator.*viewer/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_browser_profiles/);
  assert.match(migration, /UNIQUE \(profile_id, platform\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bridge_credentials/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS service_credentials/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS identity_audit_events/);
  assert.match(identity, /requireCreatorContext/);
  assert.match(authorization, /manage_identity/);
  assert.match(authorization, /selectCreatorPortalMembership/);
  assert.match(authorization, /memberships\.length !== 1/);
  assert.doesNotMatch(access, /claims\.email\?\.toLowerCase\(\) !== env\.ACCESS_ALLOWED_EMAIL/);
  assert.match(shell, /switchCreatorAction/);
  assert.match(creators, /platform handle is descriptive only/);
  assert.match(creators, /assignBrowserProfileAction/);
  assert.match(bridge, /bridge_credentials/);
  assert.match(bridge, /installation_id/);
  assert.match(extension, /creatorOsInstallationId/);
});

test("all live runtime creator scopes are derived rather than hard-coded", async () => {
  const paths = [
    "src/app/actions.ts",
    "src/lib/library.ts",
    "src/lib/messages.ts",
    "src/lib/operations.ts",
    "../vault-bridge/src/index.ts",
    "../reddit-scheduler/src/index.ts",
    "../instagram-scheduler/src/index.ts",
    "../telegram-bridge/src/index.ts",
  ];
  const runtime = (await Promise.all(paths.map(source))).join("\n");
  assert.doesNotMatch(runtime, /creator_id\s*=\s*['"]adelaide['"]/i);
  assert.doesNotMatch(runtime, /CREATOR_ID\s*=\s*['"]adelaide['"]/i);
  assert.match(runtime, /service:(?:reddit|instagram|telegram|vault-bridge|dropbox)/);
});
