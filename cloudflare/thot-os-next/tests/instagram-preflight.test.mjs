import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";

const source = await readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8");
const preflight = stripTypeScriptTypes(source.slice(source.indexOf("async function prepareInstagramReplyTarget("), source.indexOf("async function validateInstagramReplyTarget(")));
const restriction = stripTypeScriptTypes(source.slice(source.indexOf("function isInstagramAccountRestriction("), source.indexOf("function r2ObjectPath(")));

function fixture({ providerError, recipientId = "recipient", status = "connected", write = 1 } = {}) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE messaging_connections (id TEXT,creator_id TEXT,status TEXT,write_enabled INTEGER,outbound_validated INTEGER,last_error TEXT,updated_at TEXT);
    CREATE TABLE message_threads (id TEXT,creator_id TEXT,connection_id TEXT,participant_external_id TEXT,updated_at TEXT);
    CREATE TABLE messaging_audit_events (id TEXT,creator_id TEXT,connection_id TEXT,thread_id TEXT,event_type TEXT,actor TEXT,actor_role TEXT,detail TEXT);`);
  db.prepare("INSERT INTO messaging_connections VALUES ('connection','creator',?,?,0,NULL,NULL)").run(status, write);
  db.prepare("INSERT INTO messaging_connections VALUES ('other','creator','connected',1,0,NULL,NULL)").run();
  db.prepare("INSERT INTO message_threads VALUES ('thread','creator','connection','recipient',NULL)").run();
  const DB = { prepare(sql) { return { bind(...args) { return { async run() { return { meta: db.prepare(sql).run(...args) }; } }; } }; }, async batch(statements) { return Promise.all(statements.map(item => item.run())); } };
  let checks = 0;
  const resolve = async () => {
    if (providerError) throw new Error(providerError);
    return { connection: { messaging_connection_id: "connection", connected_account_id: "provider", external_account_id: "self" }, recipient: { id: recipientId }, messageCount: 1 };
  };
  const prepare = new Function("resolveInstagramRecipient", "ensureInstagramMessageSubscriptions", `${restriction}\n${preflight}\nreturn prepareInstagramReplyTarget;`)(resolve, async () => { checks++; });
  return { db, checks: () => checks, run: () => prepare({ DB }, "creator", { id: "thread", connection_id: "connection", account_id: "account", external_thread_id: "external", participant_external_id: "recipient" }) };
}

test("automatic preflight verifies recipient/subscriptions without granting write permission", async () => {
  const f = fixture({ write: 0 });
  try {
    assert.equal((await f.run()).recipient.id, "recipient");
    assert.equal(f.checks(), 1);
    assert.deepEqual(f.db.prepare("SELECT write_enabled,outbound_validated,status FROM messaging_connections WHERE id='connection'").get(), { write_enabled: 0, outbound_validated: 1, status: "connected" });
    assert.equal(f.db.prepare("SELECT outbound_validated FROM messaging_connections WHERE id='other'").get().outbound_validated, 0);
  } finally { f.db.close(); }
});

test("preflight restriction is persisted only for the selected account, with no send", async () => {
  for (const providerError of ["OAuthException code: 368", "OAuthException subcode=1404169"]) {
    const f = fixture({ providerError });
    try {
      await assert.rejects(f.run(), /restricted/);
      assert.equal(f.checks(), 0);
      assert.deepEqual(f.db.prepare("SELECT write_enabled,outbound_validated,status FROM messaging_connections WHERE id='connection'").get(), { write_enabled: 0, outbound_validated: 0, status: "restricted" });
      assert.equal(f.db.prepare("SELECT status FROM messaging_connections WHERE id='other'").get().status, "connected");
    } finally { f.db.close(); }
  }
});

test("recipient mismatch and changed connection fail closed before readiness can be recorded", async () => {
  for (const options of [{ recipientId: "wrong" }, { status: "restricted" }]) {
    const f = fixture(options);
    try {
      await assert.rejects(f.run(), /No message was sent/);
      const current = f.db.prepare("SELECT status,outbound_validated FROM messaging_connections WHERE id='connection'").get();
      assert.equal(current.status, options.status || "connected");
      assert.equal(current.outbound_validated, 0);
    } finally { f.db.close(); }
  }
});

test("provider send follows preflight and atomic authority/window recheck, not a manual validation flag", () => {
  const send = source.slice(source.indexOf("async function sendInstagramReply("), source.indexOf("async function markFailed("));
  assert.ok(send.indexOf("await prepareInstagramReplyTarget") < send.indexOf("SET status='sending'"));
  assert.ok(send.indexOf("SET status='sending'") < send.indexOf("sendAttempted = true"));
  assert.match(send, /c\.status='connected' AND c\.write_enabled=1 AND c\.mode IN \('assist','operate'\) AND c\.emergency_paused=0/);
  assert.match(send, /COALESCE\(m\.sent_at,m\.created_at\)=\? AND \?>=unixepoch\('now'\)-86400/);
  assert.match(send, /\.bind\(draft\.id, input\.creatorId, draft\.last_inbound_at, Math\.floor\(lastInboundAt \/ 1000\)\)/);
  assert.doesNotMatch(send, /!draft\.outbound_validated/);
});

test("atomic send claim rejects a concurrent pause, restriction, observe mode or closed window", () => {
  const sql = source.match(/const claim = await env\.DB\.prepare\(`(UPDATE instagram_reply_drafts SET status='sending'[\s\S]*?)`\)/)?.[1];
  assert.ok(sql);
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE instagram_reply_drafts (id TEXT,creator_id TEXT,connection_id TEXT,thread_id TEXT,status TEXT,requested_by TEXT,approved_by TEXT,approved_at TEXT,error TEXT,updated_at TEXT);
      CREATE TABLE messaging_connections (id TEXT,creator_id TEXT,status TEXT,write_enabled INTEGER,mode TEXT,emergency_paused INTEGER);
      CREATE TABLE messages (thread_id TEXT,creator_id TEXT,direction TEXT,sent_at TEXT,created_at TEXT);
      INSERT INTO instagram_reply_drafts VALUES ('draft','creator','connection','thread','draft','human',NULL,NULL,NULL,NULL);
      INSERT INTO messaging_connections VALUES ('connection','creator','connected',1,'assist',0);
      INSERT INTO messages VALUES ('thread','creator','inbound',datetime('now'),datetime('now'));`);
    const timestampParser = stripTypeScriptTypes(source.slice(source.indexOf("function d1TimestampMs("), source.indexOf("function isDefinitiveInstagramRejection(")));
    const parse = new Function(`${timestampParser}; return d1TimestampMs;`)();
    const claim = (timestamp = db.prepare("SELECT COALESCE(sent_at,created_at) AS stamp FROM messages").get().stamp) => db.prepare(sql).run("draft", "creator", timestamp, Math.floor(parse(timestamp) / 1000));
    for (const change of ["emergency_paused=1", "status='restricted'", "write_enabled=0", "mode='observe'", "creator_id='other'"]) {
      db.exec("UPDATE messaging_connections SET emergency_paused=0,status='connected',write_enabled=1,mode='assist',creator_id='creator'");
      db.exec(`UPDATE messaging_connections SET ${change}`);
      assert.equal(claim().changes, 0, change);
    }
    db.exec("UPDATE messaging_connections SET creator_id='creator'; UPDATE messages SET sent_at=datetime('now','-25 hours')");
    assert.equal(claim().changes, 0);
    db.exec("UPDATE messages SET sent_at=datetime('now')");
    assert.equal(claim().changes, 1);
    assert.equal(claim().changes, 0, "second claim cannot send twice");
    for (const suffix of ["Z", "+0000", "+00:00", "+0800", "-0430"]) {
      const offsetMinutes = suffix === "+0800" ? 480 : suffix === "-0430" ? -270 : 0;
      const timestamp = new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0,19) + suffix;
      db.exec("UPDATE instagram_reply_drafts SET status='draft'");
      db.prepare("UPDATE messages SET sent_at=?").run(timestamp);
      assert.equal(claim().changes, 1, suffix);
    }
    const captured = db.prepare("SELECT sent_at FROM messages").get().sent_at;
    db.exec("UPDATE instagram_reply_drafts SET status='draft'; UPDATE messages SET sent_at=datetime('now','-25 hours')");
    assert.equal(claim(captured).changes, 0, "changed inbound timestamp cannot reuse an old parsed epoch");
  } finally { db.close(); }
});
