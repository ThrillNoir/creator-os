import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFanslyReceiptStatements, buildFanslySyncCompletionStatement } from "../../vault-bridge/src/index.ts";
import { buildNativeImageTerminalStatements } from "../src/lib/native-image-lifecycle.ts";

test("the paired extension returns the owner token for both browser receipts", async () => {
  const extension = await readFile(new URL("../../../public/local-bridge-extension/background.js", import.meta.url), "utf8");
  const vaultUi = await readFile(new URL("../../../public/local-bridge-extension/fansly-vault.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../../../public/local-bridge-extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "1.1.0");
  assert.match(extension, /x-thot-os-message-client":"explicit-v5"/);
  assert.match(extension, /jobId:job\.id,claimToken:job\.claimToken/);
  assert.match(extension, /threadId:pending\.id,claimToken:pending\.claimToken/);
  assert.match(extension, /bridgeRequest\(config,"\/status"/);
  assert.match(extension, /markBridgeUpdateRequired/);
  assert.match(extension, /creatorOsBridgeNotice/);
  assert.match(vaultUi, /legacyReconciliationCount/);
  assert.match(vaultUi, /Update the THOT OS bridge extension/);
});

test("receipt settlement remains one guarded atomic batch", async () => {
  const bridge = await readFile(new URL("../../vault-bridge/src/index.ts", import.meta.url), "utf8");
  assert.match(bridge, /const results = await env\.DB\.batch\(statements\)/);
  assert.match(bridge, /if \(!results\[0\]\?\.meta\?\.changes\) return json\(request, \{ ok: true, ignored: true \}\)/);
  assert.doesNotMatch(bridge, /const updated = await statements\[0\]\.run\(\)/);
  assert.match(bridge, /function boundedReceipt/);
  assert.match(bridge, /messageClientUpdateRequired/);
  assert.match(bridge, /legacyReconciliationCount/);
  const fanslyReceiptPath = bridge.slice(bridge.indexOf("async function fanslyOutbox"));
  assert.doesNotMatch(fanslyReceiptPath, /JSON\.stringify\(input\.receipt \?\? \{\}\)\.slice/);
});

test("production receipt SQL is idempotent, owner-bound, and atomic", async () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE premium_message_drafts (id TEXT PRIMARY KEY,creator_id TEXT,status TEXT,claim_token TEXT,completed_at TEXT,error TEXT,receipt TEXT,updated_at TEXT);
      CREATE TABLE messaging_audit_events (id TEXT PRIMARY KEY,creator_id TEXT,connection_id TEXT,thread_id TEXT,event_type TEXT,actor TEXT,actor_role TEXT,detail TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY,creator_id TEXT,thread_id TEXT,external_message_id TEXT,direction TEXT,sender_type TEXT,body TEXT,sent_at TEXT,delivery_status TEXT);
      CREATE TABLE message_threads (id TEXT PRIMARY KEY,creator_id TEXT,last_message_at TEXT,updated_at TEXT);
      CREATE TABLE thread_updates (id INTEGER);
      CREATE TRIGGER thread_touch AFTER UPDATE ON message_threads BEGIN INSERT INTO thread_updates VALUES (1); END;`);
    const job = { id: "draft-atomic", thread_id: "thread-1", connection_id: "connection-1", body: "hello" };
    db.prepare("INSERT INTO premium_message_drafts (id,creator_id,status,claim_token,receipt) VALUES (?,?,?,?,?)").run(job.id, "creator-1", "claimed", "owner-1", "{}");
    db.prepare("INSERT INTO message_threads (id,creator_id) VALUES (?,?)").run(job.thread_id, "creator-1");
    const runBatch = (statements) => db.transaction(() => statements.map(({ sql, params }) => db.prepare(sql).run(...params)))();
    const settlement = buildFanslyReceiptStatements(job, "creator-1", "owner-1", true, null, JSON.stringify({ sent: true }));
    assert.equal(runBatch(settlement)[0].changes, 1);
    assert.equal(runBatch(settlement)[0].changes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messaging_audit_events").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM thread_updates").get().count, 1);

    db.prepare("INSERT INTO premium_message_drafts (id,creator_id,status,claim_token,receipt) VALUES (?,?,?,?,?)").run("draft-wrong", "creator-1", "claimed", "owner-2", "{}");
    const wrongOwner = buildFanslyReceiptStatements({ ...job, id: "draft-wrong" }, "creator-1", "other-owner", true, null, JSON.stringify({ sent: true }));
    assert.equal(runBatch(wrongOwner)[0].changes, 0);
    assert.equal(db.prepare("SELECT status FROM premium_message_drafts WHERE id='draft-wrong'").get().status, "claimed");

    db.prepare("INSERT INTO premium_message_drafts (id,creator_id,status,claim_token,receipt) VALUES (?,?,?,?,?)").run("draft-late", "creator-1", "failed", "owner-3", '{"outcome":"uncertain"}');
    const late = buildFanslyReceiptStatements({ ...job, id: "draft-late" }, "creator-1", "owner-3", true, null, JSON.stringify({ sent: true }));
    assert.equal(runBatch(late)[0].changes, 1);
    assert.equal(db.prepare("SELECT status FROM premium_message_drafts WHERE id='draft-late'").get().status, "sent");

    db.prepare("INSERT INTO premium_message_drafts (id,creator_id,status,claim_token,receipt) VALUES (?,?,?,?,?)").run("draft-rollback", "creator-1", "claimed", "owner-4", "{}");
    const rollback = buildFanslyReceiptStatements({ ...job, id: "draft-rollback" }, "creator-1", "owner-4", true, null, JSON.stringify({ sent: true }));
    rollback.push({ sql: "INSERT INTO missing_batch_table VALUES (1)", params: [] });
    assert.throws(() => runBatch(rollback));
    assert.equal(db.prepare("SELECT status FROM premium_message_drafts WHERE id='draft-rollback'").get().status, "claimed");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE id='fansly-out-draft-rollback'").get().count, 0);
  } finally {
    db.close();
  }
});

test("0058 keeps stale browser owners from changing a newer Fansly claim", async () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE premium_thread_sync_state (
      thread_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_requested_at TEXT, updated_at TEXT
    );
    CREATE TABLE premium_message_drafts (
      id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, status TEXT NOT NULL,
      claimed_at TEXT, completed_at TEXT, error TEXT, receipt TEXT NOT NULL DEFAULT '{}', updated_at TEXT
    );`);
    db.exec(await readFile(new URL("../../thot-os-app/migrations/0058_fansly_claim_recovery.sql", import.meta.url), "utf8"));

    db.prepare(`INSERT INTO premium_thread_sync_state
      (thread_id,creator_id,status,attempts,last_requested_at,claim_token)
      VALUES ('thread-1','creator-1','claimed',1,datetime('now','-3 minutes'),'old')`).run();
    const reclaimed = db.prepare(`UPDATE premium_thread_sync_state
      SET status='claimed',attempts=attempts+1,last_requested_at=CURRENT_TIMESTAMP,claim_token=?
      WHERE thread_id=? AND creator_id=? AND attempts<3 AND status='claimed'
        AND last_requested_at<datetime('now','-2 minutes')`).run("new", "thread-1", "creator-1");
    assert.equal(reclaimed.changes, 1);
    const staleFailure = db.prepare(`UPDATE premium_thread_sync_state SET status='failed'
      WHERE thread_id=? AND creator_id=? AND claim_token=? AND status='claimed'`).run("thread-1", "creator-1", "old");
    assert.equal(staleFailure.changes, 0);
    assert.equal(db.prepare("SELECT status,claim_token FROM premium_thread_sync_state WHERE thread_id='thread-1'").get().status, "claimed");
    db.prepare(`INSERT INTO premium_thread_sync_state
      (thread_id,creator_id,status,attempts,last_requested_at) VALUES ('legacy-thread','creator-1','claimed',3,datetime('now','-3 minutes'))`).run();
    db.prepare(`UPDATE premium_thread_sync_state SET status='failed'
      WHERE status='claimed' AND claim_token IS NOT NULL AND last_requested_at<datetime('now','-2 minutes')`).run();
    assert.equal(db.prepare("SELECT status FROM premium_thread_sync_state WHERE thread_id='legacy-thread'").get().status, "claimed");

    db.prepare(`INSERT INTO premium_message_drafts
      (id,creator_id,status,claimed_at,claim_token,receipt) VALUES ('draft-1','creator-1','claimed',datetime('now','-3 minutes'),'send-owner','{}')`).run();
    db.prepare(`INSERT INTO premium_message_drafts
      (id,creator_id,status,claimed_at,receipt) VALUES ('legacy-draft','creator-1','claimed',datetime('now','-3 minutes'),'{}')`).run();
    db.prepare(`UPDATE premium_message_drafts SET status='failed',completed_at=CURRENT_TIMESTAMP,
      error='Fansly send outcome uncertain; verify the live conversation before any retry.',
      receipt='{"outcome":"uncertain"}' WHERE creator_id=? AND status='claimed' AND claim_token IS NOT NULL AND claimed_at<datetime('now','-2 minutes')`).run("creator-1");
    const lateReceipt = db.prepare(`UPDATE premium_message_drafts SET status='sent',receipt='{"sent":true}'
      WHERE id=? AND creator_id=? AND claim_token=? AND status='failed'
        AND json_valid(receipt) AND json_extract(receipt,'$.outcome')='uncertain'`).run("draft-1", "creator-1", "send-owner");
    assert.equal(db.prepare("SELECT id FROM premium_message_drafts WHERE status='approved'").get(), undefined);
    assert.equal(db.prepare("SELECT status FROM premium_message_drafts WHERE id='legacy-draft'").get().status, "claimed");
    assert.equal(lateReceipt.changes, 1);
    const wrongOwner = db.prepare(`UPDATE premium_message_drafts SET status='sent'
      WHERE id=? AND creator_id=? AND claim_token=? AND status='failed'`).run("draft-1", "creator-1", "different-owner");
    assert.equal(wrongOwner.changes, 0);
  } finally {
    db.close();
  }
});

test("inbound completion update is owner-bound at write time", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE premium_thread_sync_state (
      thread_id TEXT PRIMARY KEY, creator_id TEXT, status TEXT, claim_token TEXT,
      attempts INTEGER, last_requested_at TEXT, last_completed_at TEXT, last_error TEXT, updated_at TEXT
    );`);
    db.prepare("INSERT INTO premium_thread_sync_state VALUES ('thread-1','creator-1','claimed','old-owner',1,NULL,NULL,NULL,NULL)").run();
    const oldCompletion = buildFanslySyncCompletionStatement({ threadId: "thread-1", creatorId: "creator-1", claimToken: "old-owner", observedOpen: true });
    db.prepare("UPDATE premium_thread_sync_state SET claim_token='new-owner',last_requested_at=CURRENT_TIMESTAMP WHERE thread_id='thread-1'").run();
    assert.equal(db.prepare(oldCompletion.sql).run(...oldCompletion.params).changes, 0);
    assert.equal(db.prepare("SELECT status,claim_token FROM premium_thread_sync_state").get().status, "claimed");
    assert.equal(db.prepare("SELECT claim_token FROM premium_thread_sync_state").get().claim_token, "new-owner");
    const newCompletion = buildFanslySyncCompletionStatement({ threadId: "thread-1", creatorId: "creator-1", claimToken: "new-owner", observedOpen: true });
    assert.equal(db.prepare(newCompletion.sql).run(...newCompletion.params).changes, 1);

    db.prepare("UPDATE premium_thread_sync_state SET status='complete',last_completed_at=datetime('now','-20 minutes')").run();
    const oldPendingReset = buildFanslySyncCompletionStatement({ threadId: "thread-1", creatorId: "creator-1", claimToken: "old-owner", observedOpen: false });
    db.prepare("UPDATE premium_thread_sync_state SET claim_token='new-owner',status='complete'").run();
    assert.equal(db.prepare(oldPendingReset.sql).run(...oldPendingReset.params).changes, 0);
    assert.equal(db.prepare("SELECT status FROM premium_thread_sync_state").get().status, "complete");
  } finally {
    db.close();
  }
});

test("native image terminal SQL archives failed uploads but protects verified previews", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE asset_ingest_sessions (id TEXT PRIMARY KEY,creator_id TEXT,status TEXT,finalization_state TEXT,failure_code TEXT,multipart_upload_id TEXT,updated_at TEXT);
      CREATE TABLE asset_ingest_parts (session_id TEXT,creator_id TEXT,status TEXT,failure_code TEXT,updated_at TEXT);
      CREATE TABLE asset_storage_objects (id TEXT PRIMARY KEY,creator_id TEXT,ingest_status TEXT,failure_code TEXT,updated_at TEXT);
      CREATE TABLE asset_media_authorities (asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,preview_failure_code TEXT,updated_at TEXT);
      CREATE TABLE assets (id TEXT PRIMARY KEY,creator_id TEXT,source_available INTEGER,indexed_at TEXT);`);
    const run = (statements) => db.transaction(() => statements.map(({ sql, params }) => db.prepare(sql).run(...params)))();
    const session = { id: "session-1", asset_id: "asset-1", storage_object_id: "object-1" };
    db.prepare("INSERT INTO asset_ingest_sessions VALUES (?,?,?,?,?,?,?)").run(session.id, "creator-1", "uploading", "incomplete", null, "upload-1", null);
    db.prepare("INSERT INTO asset_ingest_parts VALUES (?,?,?,?,?)").run(session.id, "creator-1", "uploaded", null, null);
    db.prepare("INSERT INTO asset_storage_objects VALUES (?,?,?,?,?)").run("object-1", "creator-1", "pending", null, null);
    db.prepare("INSERT INTO asset_media_authorities VALUES (?,?,?,?,?,?)").run("asset-1", "creator-1", "r2_native", "ingesting", null, null);
    db.prepare("INSERT INTO assets VALUES (?,?,?,?)").run("asset-1", "creator-1", 1, null);
    run(buildNativeImageTerminalStatements(session, "creator-1", "expired", "session_expired"));
    assert.equal(db.prepare("SELECT status,finalization_state FROM asset_ingest_sessions").get().status, "expired");
    assert.equal(db.prepare("SELECT status FROM asset_ingest_parts").get().status, "failed");
    assert.equal(db.prepare("SELECT ingest_status FROM asset_storage_objects").get().ingest_status, "failed");
    assert.equal(db.prepare("SELECT state FROM asset_media_authorities").get().state, "archived");
    assert.equal(db.prepare("SELECT source_available FROM assets").get().source_available, 0);

    db.prepare("UPDATE asset_ingest_sessions SET status='uploading',finalization_state='incomplete',failure_code=NULL,multipart_upload_id='upload-2'").run();
    db.prepare("UPDATE asset_ingest_parts SET status='uploaded',failure_code=NULL").run();
    db.prepare("UPDATE asset_storage_objects SET ingest_status='pending',failure_code=NULL").run();
    db.prepare("UPDATE asset_media_authorities SET state='ingesting',preview_failure_code=NULL").run();
    db.prepare("UPDATE assets SET source_available=1").run();
    run(buildNativeImageTerminalStatements(session, "creator-1", "quarantined", "malware_detected"));
    assert.equal(db.prepare("SELECT status,finalization_state FROM asset_ingest_sessions").get().status, "failed");
    assert.equal(db.prepare("SELECT status FROM asset_ingest_parts").get().status, "failed");
    assert.equal(db.prepare("SELECT ingest_status FROM asset_storage_objects").get().ingest_status, "failed");
    assert.equal(db.prepare("SELECT state FROM asset_media_authorities").get().state, "archived");
    assert.equal(db.prepare("SELECT source_available FROM assets").get().source_available, 0);

    db.prepare("UPDATE asset_ingest_sessions SET status='finalized',finalization_state='verified',failure_code=NULL").run();
    db.prepare("UPDATE asset_storage_objects SET ingest_status='verified',failure_code=NULL").run();
    db.prepare("UPDATE asset_media_authorities SET state='preview_ready',preview_failure_code=NULL").run();
    db.prepare("UPDATE assets SET source_available=1").run();
    run(buildNativeImageTerminalStatements(session, "creator-1", "quarantined", "late_failure"));
    assert.equal(db.prepare("SELECT finalization_state FROM asset_ingest_sessions").get().finalization_state, "verified");
    assert.equal(db.prepare("SELECT state FROM asset_media_authorities").get().state, "preview_ready");
    assert.equal(db.prepare("SELECT source_available FROM assets").get().source_available, 1);
  } finally {
    db.close();
  }
});
