import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = await readFile(new URL("../../thot-os-app/migrations/0059_instagram_message_sync_reliability.sql", import.meta.url), "utf8");
const threadKey = (creatorId, connectionId, externalId) => `instagram-${createHash("sha256").update(`${creatorId}:${connectionId}:${externalId}`).digest("hex").slice(0, 40)}`;
const attachmentKey = (creatorId, messageId, externalMessageId, sourceKey) => `instagram-attachment-${createHash("sha256").update(`${creatorId}:${messageId}:${externalMessageId}:${sourceKey}`).digest("hex").slice(0, 40)}`;

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE creators(id TEXT PRIMARY KEY);
    CREATE TABLE operational_accounts(id TEXT PRIMARY KEY,creator_id TEXT,platform TEXT);
    CREATE TABLE messaging_connections(id TEXT PRIMARY KEY,creator_id TEXT,account_id TEXT,platform TEXT,read_enabled INTEGER,status TEXT,last_synced_at TEXT,last_error TEXT);
    CREATE TABLE instagram_account_sync_state(creator_id TEXT,account_id TEXT,last_messages_sync_at TEXT,last_analytics_sync_at TEXT,last_error TEXT,updated_at TEXT,PRIMARY KEY(creator_id,account_id));
    CREATE TABLE message_threads(id TEXT PRIMARY KEY,creator_id TEXT,connection_id TEXT,external_thread_id TEXT,unread_count INTEGER DEFAULT 0,UNIQUE(connection_id,external_thread_id));
    CREATE TABLE messages(id TEXT PRIMARY KEY,creator_id TEXT,thread_id TEXT,external_message_id TEXT,direction TEXT,UNIQUE(thread_id,external_message_id));
    CREATE TABLE message_attachments(id TEXT PRIMARY KEY,creator_id TEXT,message_id TEXT,source_key TEXT,kind TEXT,status TEXT,UNIQUE(creator_id,message_id,source_key));`);
  db.exec(migration);
  return db;
}

test("message sync migration supports account leases, cooldown fairness and read filtering", () => {
  const db = database();
  db.exec(`INSERT INTO creators VALUES ('c');
    INSERT INTO operational_accounts VALUES ('a','c','instagram'),('b','c','instagram');
    INSERT INTO messaging_connections(id,creator_id,account_id,platform,read_enabled,status) VALUES ('ca','c','a','instagram',1,'connected'),('cb','c','b','instagram',0,'connected');
    INSERT INTO instagram_account_sync_state(creator_id,account_id) VALUES ('c','a'),('c','b');`);
  const claim = db.prepare(`UPDATE instagram_account_sync_state SET messages_sync_lease_id=?,messages_sync_lease_at=CURRENT_TIMESTAMP,last_messages_attempt_at=CURRENT_TIMESTAMP WHERE creator_id=? AND account_id=? AND (messages_sync_lease_id IS NULL OR unixepoch(messages_sync_lease_at)<=unixepoch(CURRENT_TIMESTAMP)-900)`);
  assert.equal(claim.run("first", "c", "a").changes, 1);
  assert.equal(claim.run("second", "c", "a").changes, 0);
  db.prepare("UPDATE instagram_account_sync_state SET messages_sync_lease_id=NULL,messages_sync_lease_at=NULL WHERE creator_id=? AND account_id=? AND messages_sync_lease_id=?").run("c", "a", "first");
  const due = db.prepare(`SELECT pc.account_id FROM messaging_connections pc JOIN instagram_account_sync_state state ON state.account_id=pc.account_id AND state.creator_id=pc.creator_id WHERE pc.creator_id=? AND pc.platform='instagram' AND pc.read_enabled=1 ORDER BY COALESCE(state.last_messages_attempt_at,'1970-01-01'),pc.account_id LIMIT 1`).get("c");
  assert.equal(due.account_id, "a");
});

test("same external conversation IDs preserve old thread IDs and scope new IDs", () => {
  const db = database();
  db.exec("INSERT INTO creators VALUES ('c'); INSERT INTO messaging_connections(id,creator_id,account_id,platform,read_enabled,status,last_synced_at,last_error,last_sync_error) VALUES ('ca','c','a','instagram',1,'connected',NULL,NULL,NULL),('cb','c','b','instagram',1,'connected',NULL,NULL,NULL);");
  const oldId = "instagram-legacy-thread";
  db.prepare("INSERT INTO message_threads(id,creator_id,connection_id,external_thread_id) VALUES (?,?,?,?)").run(oldId, "c", "ca", "same-external-id");
  const existing = db.prepare("SELECT id FROM message_threads WHERE creator_id=? AND connection_id=? AND external_thread_id=?").get("c", "ca", "same-external-id");
  assert.equal(existing.id, oldId);
  const newId = threadKey("c", "cb", "same-external-id");
  db.prepare("INSERT INTO message_threads(id,creator_id,connection_id,external_thread_id) VALUES (?,?,?,?)").run(newId, "c", "cb", "same-external-id");
  assert.notEqual(newId, oldId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM message_threads").get().count, 2);
});

test("same external message IDs preserve old attachment IDs and scope new account rows", () => {
  const db = database();
  db.exec("INSERT INTO creators VALUES ('c'); INSERT INTO message_attachments VALUES ('legacy-attachment','c','message-a','attachment:0','image','ready');");
  const existing = db.prepare("SELECT id FROM message_attachments WHERE creator_id=? AND message_id=? AND source_key=?").get("c", "message-a", "attachment:0");
  assert.equal(existing.id, "legacy-attachment");
  const newId = attachmentKey("c", "message-b", "same-external-message", "attachment:0");
  db.prepare("INSERT INTO message_attachments(id,creator_id,message_id,source_key,kind,status) VALUES(?,?,?,?,?,?)").run(newId, "c", "message-b", "attachment:0", "image", "ready");
  assert.notEqual(newId, existing.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM message_attachments").get().count, 2);
});

test("duplicate message retry increments unread only once", () => {
  const db = database();
  db.exec("INSERT INTO creators VALUES ('c'); INSERT INTO message_threads VALUES ('t','c','ca','x',0);");
  const insert = db.prepare("INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?)");
  const unread = db.prepare("UPDATE message_threads SET unread_count=unread_count+1 WHERE id=? AND creator_id=? AND changes()=1");
  for (let attempt = 0; attempt < 2; attempt++) {
    db.exec("BEGIN");
    insert.run(`m-${attempt}`, "c", "t", "provider-message", "inbound");
    unread.run("t", "c");
    db.exec("COMMIT");
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 1);
  assert.equal(db.prepare("SELECT unread_count FROM message_threads WHERE id='t'").get().unread_count, 1);
});
