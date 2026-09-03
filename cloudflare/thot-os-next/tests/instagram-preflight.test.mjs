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
  assert.match(send, /unixepoch\(COALESCE\(m\.sent_at,m\.created_at\)\)>=unixepoch\('now'\)-86400/);
  assert.doesNotMatch(send, /!draft\.outbound_validated/);
});
