import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { fanslyDeliveryWarning } from "../src/lib/fansly-delivery.ts";

test("Fansly labels stale claims and uncertain receipts without claiming delivery or retrying", () => {
  const draft = { status: "claimed", receipt: "{}", stale_claim: 0 };
  assert.equal(fanslyDeliveryWarning(draft), null);
  assert.match(fanslyDeliveryWarning({ ...draft, stale_claim: 1 }), /Delivery uncertain.*will not resend/);
  assert.match(fanslyDeliveryWarning({ ...draft, status: "failed", receipt: '{"outcome":"uncertain"}' }), /verify the Fansly conversation before retry/);
  assert.match(fanslyDeliveryWarning({ ...draft, status: "failed", receipt: '{"reconciliationRequired":true}' }), /Delivery uncertain/);
  for (const status of ["approved", "sent", "cancelled"]) {
    assert.equal(fanslyDeliveryWarning({ ...draft, status, stale_claim: 1 }), null);
  }
  for (const receipt of ["{broken", "null", "{}"]) {
    assert.equal(fanslyDeliveryWarning({ ...draft, status: "failed", receipt }), null);
  }
});

test("the inbox surfaces only the current creator's exhausted or legacy Fansly syncs", async () => {
  const source = await readFile(new URL("../src/lib/messages.ts", import.meta.url), "utf8");
  const sql = source.match(/DB\.prepare\(`(SELECT COUNT\(\*\) AS count FROM premium_thread_sync_state s[\s\S]*?)`\)/)?.[1];
  assert.ok(sql);
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE premium_thread_sync_state(thread_id TEXT,creator_id TEXT,status TEXT,attempts INTEGER,claim_token TEXT,last_requested_at TEXT);
      CREATE TABLE message_threads(id TEXT,creator_id TEXT,connection_id TEXT);
      CREATE TABLE messaging_connections(id TEXT,creator_id TEXT,platform TEXT);
      INSERT INTO messaging_connections VALUES ('a','creator-a','fansly'),('b','creator-b','fansly');
      INSERT INTO message_threads VALUES ('legacy','creator-a','a'),('owned','creator-a','a'),('exhausted','creator-a','a'),('other','creator-b','b');
      INSERT INTO premium_thread_sync_state VALUES
        ('legacy','creator-a','claimed',1,NULL,datetime('now','-3 minutes')),
        ('owned','creator-a','claimed',1,'token',datetime('now','-3 minutes')),
        ('exhausted','creator-a','failed',3,'token',datetime('now','-3 minutes')),
        ('other','creator-b','claimed',1,NULL,datetime('now','-3 minutes'));`);
    assert.equal(db.prepare(sql).get("creator-a").count, 2);
    assert.equal(db.prepare(sql).get("creator-b").count, 1);
    assert.equal(db.prepare(sql).get("unknown").count, 0);
  } finally { db.close(); }
  const page = await readFile(new URL("../src/app/messages/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const warning = fanslyDeliveryWarning\(send\)/);
  assert.match(page, /fanslyCollectionNeedsReview > 0/);
  assert.doesNotMatch(page, /paired browser is delivering this message/);
});
