import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Instagram media reply contract is creator-scoped and attachment-idempotent", async () => {
  const [migration, actions, scheduler, route, messages] = await Promise.all([
    source("../thot-os-app/migrations/0060_instagram_reply_media.sql"),
    source("src/app/actions.ts"),
    source("../instagram-scheduler/src/index.ts"),
    source("src/app/api/message-attachment/[attachmentId]/route.ts"),
    source("src/lib/messages.ts"),
  ]);

  // These are source-contract checks. They prove the guarded SQL/branch exists,
  // not that a provider accepted a live send.
  for (const column of ["asset_id", "asset_sha256", "asset_bytes", "asset_mime_type", "asset_r2_version", "asset_r2_etag"]) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column}\\b`));
    assert.match(actions, new RegExp(column === "asset_id" ? "asset_id" : column));
    assert.match(scheduler, new RegExp(column));
  }
  assert.match(migration, /COALESCE\(asset_id,''\)/);
  assert.match(actions, /COALESCE\(asset_id,''\)=COALESCE\(\?, ''\)/);
  assert.match(actions, /request ID is already used for a different Instagram reply/);
  assert.match(actions, /d\.destination='instagram'/);
  assert.match(actions, /c\.safety='sfw'/);
  assert.match(actions, /asset_media_authorities/);
  assert.match(actions, /assetId/);
  assert.match(actions, /cannot silently split text and media/);
  assert.match(actions, /\["assist", "operate"\]/);
  assert.match(actions, /image\/jpeg.*image\/png.*video\/mp4/s);
  assert.match(actions, /25 \* 1024 \* 1024/);

  assert.match(scheduler, /asset_sha256.*asset_bytes.*asset_mime_type.*asset_r2_version.*asset_r2_etag/);
  for (const field of ["o.sha256", "o.byte_count", "o.verified_mime_type", "o.r2_version", "o.r2_etag"]) assert.match(scheduler, new RegExp(field.replace(".", "\\.")));
  assert.match(scheduler, /immutableR2IdentityMatches\(source, object\)/);
  assert.match(scheduler, /recipient: \{ id: recipient\.id \}/);
  assert.match(scheduler, /message: \{ attachment: \{ type: media\.type, payload: \{ url: media\.url \} \} \}/);
  assert.match(scheduler, /const media = await approvedInstagramReplyMedia\(env, draft\);\n    sendAttempted = true;/);
  assert.match(scheduler, /COMPOSIO_V31}\/tools\/execute\/proxy/);
  assert.match(scheduler, /code \$\{String\(providerError\.code\)\}/);
  assert.match(scheduler, /subcode \$\{String\(providerError\.error_subcode\)\}/);
  assert.match(scheduler, /INSERT OR IGNORE INTO message_attachments/);

  assert.match(route, /asset_id/);
  assert.match(route, /LIBRARY_MEDIA/);
  assert.match(route, /immutableR2IdentityMatches/);
  for (const snapshot of ["asset_sha256", "asset_bytes", "asset_mime_type", "asset_r2_version", "asset_r2_etag"]) assert.match(route, new RegExp(`attachment\\.${snapshot}`));
  assert.match(route, /cache-control": "private, no-store"/);
  assert.match(messages, /asset_id/);
});

test("unsupported provider media stays visibly out of scope", async () => {
  const [telegram, migration, fansly] = await Promise.all([
    source("../telegram-bridge/src/index.ts"),
    source("../thot-os-app/migrations/0044_creator_r2_library.sql"),
    source("src/app/actions.ts"),
  ]);
  assert.doesNotMatch(telegram, /TELEGRAM_SEND_(?:PHOTO|VIDEO)/);
  assert.match(migration, /telegram_media_handoffs/);
  assert.match(fansly, /sendFanslyReplyAction/);
  assert.match(fansly, /Telegram photo\/video replies are not available yet/);
  assert.match(fansly, /Fansly photo\/video replies are not available yet/);
  assert.doesNotMatch(fansly, /FANSLY_SEND_(?:IMAGE|VIDEO)/);
});

test("0060 enforces one active draft per exact body-and-asset intent", async () => {
  const migration = await source("../thot-os-app/migrations/0060_instagram_reply_media.sql");
  const db = new Database(":memory:");
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE creators(id TEXT PRIMARY KEY);
      CREATE TABLE assets(id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES creators(id), media_r2_key TEXT, bytes INTEGER, source_available INTEGER);
      CREATE TABLE instagram_reply_drafts(id TEXT PRIMARY KEY, creator_id TEXT, thread_id TEXT, body TEXT, status TEXT, created_at TEXT,
        FOREIGN KEY(creator_id) REFERENCES creators(id));
      CREATE TABLE message_attachments(id TEXT PRIMARY KEY, creator_id TEXT, message_id TEXT, source_key TEXT, kind TEXT, mime_type TEXT, status TEXT, error TEXT, created_at TEXT,
        FOREIGN KEY(creator_id) REFERENCES creators(id));`);
    db.exec(migration);
    db.prepare("INSERT INTO creators(id) VALUES ('creator-a')").run();
    db.prepare("INSERT INTO assets(id,creator_id,bytes,source_available) VALUES ('asset-1','creator-a',100,1),('asset-2','creator-a',100,1)").run();
    const insert = db.prepare("INSERT INTO instagram_reply_drafts(id,creator_id,thread_id,body,status,created_at,asset_id,asset_sha256,asset_bytes,asset_mime_type,asset_r2_version,asset_r2_etag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const snapshot = ["a".repeat(64), 100, "image/jpeg", "v1", "etag-1"];
    insert.run("draft-1", "creator-a", "thread-1", "", "draft", "2026-09-03", "asset-1", ...snapshot);
    assert.throws(() => insert.run("draft-duplicate", "creator-a", "thread-1", "", "sending", "2026-09-03", "asset-1", ...snapshot), /UNIQUE constraint failed/);
    insert.run("draft-other-asset", "creator-a", "thread-1", "", "draft", "2026-09-03", "asset-2", ...snapshot);
    insert.run("draft-text", "creator-a", "thread-1", "hello", "draft", "2026-09-03", null, null, null, null, null, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM instagram_reply_drafts WHERE status IN ('draft','approved','sending')").get().count, 3);
    db.prepare("UPDATE instagram_reply_drafts SET status='failed' WHERE id='draft-1'").run();
    insert.run("draft-retry", "creator-a", "thread-1", "", "draft", "2026-09-03", "asset-1", ...snapshot);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM instagram_reply_drafts WHERE asset_id='asset-1'").get().count, 2);
  } finally {
    db.close();
  }
});
