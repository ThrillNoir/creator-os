import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { postingStatus, supportsOperations, platformLabel } from "../src/lib/account-presentation.ts";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("recorded accounts, unsupported integrations and posting permission remain distinct", () => {
  const account = { platform: "instagram", connection_status: "connected", publishing_authority: "confirmed" };
  assert.equal(postingStatus(account), "Ready for reviewed posts");
  assert.equal(postingStatus({ ...account, publishing_authority: "blocked" }), "Posting blocked");
  assert.equal(postingStatus({ ...account, connection_status: "not_connected" }), "Connection required");
  for (const platform of ["x", "onlyfans"]) {
    assert.equal(supportsOperations(platform), false);
    assert.equal(postingStatus({ ...account, platform }), "Manual only · integration unavailable");
  }
  assert.equal(platformLabel("instagram"), "Instagram");
});

test("video review resolves an asset UUID without a photo preview and stays creator scoped", async () => {
  const library = await source("lib/library.ts");
  const fn = library.slice(library.indexOf("export async function getAssetByObjectId"), library.indexOf("export function objectIdFor"));
  const sql = fn.match(/DB\.prepare\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(sql);
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE assets (id TEXT, creator_id TEXT, basename TEXT, extension TEXT, bytes INTEGER, modified_at TEXT, creator_notes TEXT, preview_r2_key TEXT, source_available INTEGER);
      CREATE TABLE asset_classifications (asset_id TEXT, safety TEXT, is_teaser INTEGER, is_multi INTEGER, notes TEXT);
      CREATE TABLE asset_destinations (asset_id TEXT, destination TEXT);
      CREATE TABLE asset_media_authorities (asset_id TEXT, creator_id TEXT, authority_kind TEXT, state TEXT);
      CREATE TABLE asset_video_playback_states (asset_id TEXT, creator_id TEXT, state TEXT, source_codec TEXT, playback_provider TEXT, failure_code TEXT);`);
    const id = "11111111-1111-4111-8111-111111111111";
    db.prepare("INSERT INTO assets VALUES (?, 'creator-a', 'sample.mp4', 'mp4', 100, '', '', NULL, 1)").run(id);
    db.prepare("INSERT INTO asset_media_authorities VALUES (?, 'creator-a', 'r2_native', 'canonical_verified')").run(id);
    db.prepare("INSERT INTO asset_video_playback_states VALUES (?, 'creator-a', 'processing_queued', 'h265', 'stream', 'stream_submission_uncertain')").run(id);
    const find = (creator, identifier) => { const prefix = `creators/${creator}/assets/${identifier}/previews/`; return db.prepare(sql).get(creator, identifier, prefix.length, prefix); };
    assert.equal(find("creator-a", id).video_state, "processing_queued");
    assert.equal(find("creator-b", id), undefined);
    db.prepare("UPDATE assets SET source_available=0").run();
    assert.equal(find("creator-a", id), undefined);
    const photo = "a".repeat(64);
    db.prepare("UPDATE assets SET source_available=1,preview_r2_key=?").run(`creators/creator-a/assets/${photo}/previews/${"b".repeat(64)}.jpg`);
    assert.equal(find("creator-a", photo).id, id);
    assert.equal(find("creator-b", photo), undefined);
    db.prepare("DELETE FROM asset_media_authorities").run();
    assert.equal(find("creator-a", id), undefined);
  } finally { db.close(); }
  const page = await source("app/library/[objectId]/page.tsx");
  assert.match(page, /video controls preload="metadata"/);
  assert.match(page, /saveAssetAttributesAction/);
  assert.doesNotMatch(page, /canPrepare=|method: "POST"/);
  const css = await source("app/globals.css");
  assert.match(css, /\.video-card \.copy-attributes \{[^}]*max-height: none[^}]*opacity: 1/);
});

test("inbox history and thread list are bounded separately from the composer", async () => {
  const [page, css, scroller] = await Promise.all([source("app/messages/page.tsx"), source("app/globals.css"), source("components/message-history.tsx")]);
  assert.match(page, /<MessageHistory key=\{data\.selectedThread\?\.id/);
  assert.match(page, /<\/MessageHistory><div className="conversation-composer">/);
  assert.match(page, /className="thread-list-scroll" role="region" aria-label="Conversations" tabIndex=\{0\}/);
  assert.match(css, /\.message-history-viewport \{[^}]*overflow-y: auto/);
  assert.match(css, /\.thread-list, \.conversation \{[^}]*height: clamp/);
  assert.match(css, /\.conversation-composer \{[^}]*flex: 0 0 auto/);
  assert.match(scroller, /following\.current && !window\.getSelection/);
  assert.match(scroller, /observer\.disconnect/);
});

test("save feedback closes only saved chapters and preserves validation errors", async () => {
  const [section, creator, capture, interview] = await Promise.all([source("components/onboarding-section.tsx"), source("components/creator-onboarding.tsx"), source("app/onboarding/secure-login-capture.tsx"), source("components/guided-onboarding-interview.tsx")]);
  assert.match(section, /if \(!saveCount \|\| !saved/);
  assert.match(section, /await action\(form\);[\s\S]*dispatchEvent/);
  assert.match(section, /event\.preventDefault\(\)/); // Failed saves must not trigger React's form reset.
  assert.match(section, /catch \(caught\)[\s\S]*setError/);
  assert.match(section, /hashchange/);
  assert.match(creator, /accounts\.every\(\(account\) => account\.connection_method !== "password" \|\| Boolean\(account\.has_credential\)\)/);
  assert.ok(capture.indexOf('dispatchEvent(new Event("onboarding:saved"') > capture.indexOf('await request({ action: "create"'));
  assert.match(interview, /if \(state.ok && state.message\)/);
});

test("draft navigation confirmation and media Enter share existing send path", async () => {
  const [composer, selector, accounts, onboarding, access] = await Promise.all([source("components/message-quick-reply.tsx"), source("components/message-account-selector.tsx"), source("app/accounts/page.tsx"), source("app/onboarding/page.tsx"), source("app/access/access-controls.tsx")]);
  assert.match(composer, /Discard this unsent reply/);
  assert.match(composer, /addEventListener\("beforeunload"/);
  assert.match(selector, /if \(!confirmMessageNavigation\(\)\)/);
  assert.match(composer, /!sending && \(body.trim\(\) \|\| assetId\)/);
  assert.match(composer, /nativeEvent\.isComposing/);
  assert.match(accounts, /mc\.creator_id=oa\.creator_id AND mc\.account_id=oa\.id/);
  assert.match(accounts, /instagramSendingBlocker/);
  assert.match(accounts, /<details className="panel account-lifecycle"/);
  assert.doesNotMatch(onboarding, /Retire an operational account|retireOperationalAccountAction/);
  assert.match(access, /<details className="credential-more"><summary>More<\/summary>/);
});
