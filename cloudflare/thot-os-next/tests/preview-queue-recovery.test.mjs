import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import vaultBridge from "../../vault-bridge/src/index.ts";

const sourceRevision = "native:client-upload-1";
const messageBody = { creatorId: "creator-1", assetId: "asset-1", sourceRevision };

function fixture({
  creatorId = "creator-1",
  objectRevision = sourceRevision,
  jobRevision = sourceRevision,
  jobStatus = "queued",
  attempts = 0,
  updatedAt = "CURRENT_TIMESTAMP",
  previewKey = null,
} = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assets(id TEXT,creator_id TEXT,source_available INTEGER,media_r2_key TEXT,preview_r2_key TEXT);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,preview_failure_code TEXT,updated_at TEXT);
    CREATE TABLE asset_storage_objects(id TEXT,creator_id TEXT,asset_id TEXT,ingest_status TEXT,object_key TEXT,r2_etag TEXT,sha256 TEXT,source_revision TEXT);
    CREATE TABLE asset_preview_jobs(id TEXT,creator_id TEXT,asset_id TEXT,source_revision TEXT,status TEXT,attempts INTEGER,last_error TEXT,started_at TEXT,completed_at TEXT,updated_at TEXT);
  `);
  db.prepare("INSERT INTO assets VALUES ('asset-1',?,1,'source-key',?)").run(creatorId, previewKey);
  db.prepare("INSERT INTO asset_media_authorities VALUES ('asset-1',?,'r2_native','canonical_verified',NULL,CURRENT_TIMESTAMP)").run(creatorId);
  db.prepare("INSERT INTO asset_storage_objects VALUES ('object-1',?,'asset-1','verified','source-key','r2-etag','source-hash',?)").run(creatorId, objectRevision);
  db.prepare(`INSERT INTO asset_preview_jobs VALUES ('job-1',?,'asset-1',?,?,?,NULL,NULL,NULL,${updatedAt})`)
    .run(creatorId, jobRevision, jobStatus, attempts);

  const output = new Map();
  let imageCalls = 0;
  let imageBehavior = async () => new Uint8Array([1, 2, 3]);
  const env = {
    DB: {
      prepare(sql) {
        let params = [];
        return {
          bind(...values) { params = values; return this; },
          first() { return db.prepare(sql).get(...params) ?? null; },
          run() { const result = db.prepare(sql).run(...params); return { meta: { changes: result.changes } }; },
        };
      },
      batch(statements) {
        return db.transaction(() => statements.map((statement) => statement.run()))();
      },
    },
    LIBRARY_MEDIA: { async get() { return { body: new Uint8Array([0]), etag: "r2-etag" }; } },
    IMAGES: {
      input() {
        imageCalls += 1;
        const call = imageCalls;
        const transformer = {
          transform() { return transformer; },
          output: async () => { const bytes = await imageBehavior(call); return { image: () => bytes }; },
        };
        return transformer;
      },
    },
    PREVIEWS: {
      async put(key, bytes) { output.set(key, Buffer.from(bytes)); },
    },
  };

  return {
    db,
    env,
    output,
    imageCalls: () => imageCalls,
    setImageBehavior: (behavior) => { imageBehavior = behavior; },
    job: () => db.prepare("SELECT * FROM asset_preview_jobs WHERE id='job-1'").get(),
    asset: () => db.prepare("SELECT * FROM assets WHERE id='asset-1'").get(),
    authority: () => db.prepare("SELECT * FROM asset_media_authorities WHERE asset_id='asset-1'").get(),
    close: () => db.close(),
  };
}

async function deliver(env, body = messageBody, attempts = 1, queue = "thot-os-preview-staging") {
  let action = null;
  await vaultBridge.queue({
    queue,
    messages: [{
      body,
      attempts,
      ack() { action = { type: "ack" }; },
      retry(options) { action = { type: "retry", ...options }; },
    }],
  }, env);
  return action;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test("fresh processing redelivery retries without resetting another worker's claim", async () => {
  const state = fixture({ jobStatus: "processing", attempts: 4 });
  try {
    const before = state.job();
    const result = await deliver(state.env);
    assert.deepEqual(result, { type: "retry", delaySeconds: 30 });
    assert.equal(state.job().attempts, before.attempts);
    assert.equal(state.job().status, "processing");
    assert.equal(state.job().updated_at, before.updated_at);
    assert.equal(state.imageCalls(), 0);
  } finally { state.close(); }
});

test("stale processing claim is reclaimed and completed with the next attempt", async () => {
  const state = fixture({ jobStatus: "processing", attempts: 1, updatedAt: "datetime('now','-6 minutes')" });
  try {
    assert.deepEqual(await deliver(state.env), { type: "ack" });
    assert.equal(state.job().status, "ready");
    assert.equal(state.job().attempts, 2);
    assert.ok(state.asset().preview_r2_key);
    assert.equal(state.authority().state, "preview_ready");
    assert.equal(state.output.size, 1);
  } finally { state.close(); }
});

test("an ordinary transformation error preserves the source and returns its owned job to queued", async () => {
  const state = fixture();
  state.setImageBehavior(async () => { throw new Error("safe transform failure"); });
  try {
    assert.deepEqual(await deliver(state.env), { type: "retry", delaySeconds: 30 });
    assert.equal(state.job().status, "queued");
    assert.equal(state.job().attempts, 1);
    assert.equal(state.job().last_error, "safe transform failure");
    assert.equal(state.asset().media_r2_key, "source-key");
    assert.equal(state.asset().source_available, 1);
    assert.equal(state.asset().preview_r2_key, null);
    assert.equal(state.authority().state, "canonical_verified");
    assert.equal(state.output.size, 0);
  } finally { state.close(); }
});

test("ready duplicate, foreign creator, and mismatched revision are acknowledged without mutation", async () => {
  const ready = fixture({ jobStatus: "ready", attempts: 2, previewKey: "existing-preview" });
  const foreign = fixture({ creatorId: "creator-2" });
  const revision = fixture({ objectRevision: "native:client-upload-2", jobRevision: "native:client-upload-2" });
  try {
    assert.deepEqual(await deliver(ready.env), { type: "ack" });
    assert.equal(ready.imageCalls(), 0);
    assert.equal(ready.asset().preview_r2_key, "existing-preview");
    assert.deepEqual(await deliver(foreign.env), { type: "ack" });
    assert.equal(foreign.job().status, "queued");
    assert.equal(foreign.imageCalls(), 0);
    assert.deepEqual(await deliver(revision.env), { type: "ack" });
    assert.equal(revision.job().status, "queued");
    assert.equal(revision.imageCalls(), 0);
  } finally { ready.close(); foreign.close(); revision.close(); }
});

test("a stale owner cannot publish completion after a newer claim finishes", async () => {
  const state = fixture();
  const entered = deferred();
  const release = deferred();
  state.setImageBehavior(async (call) => {
    if (call === 1) { entered.resolve(); await release.promise; }
    return new Uint8Array([1, 2, 3]);
  });
  try {
    const staleOwner = deliver(state.env);
    await entered.promise;
    state.db.prepare("UPDATE asset_preview_jobs SET updated_at=datetime('now','-6 minutes') WHERE id='job-1'").run();
    assert.deepEqual(await deliver(state.env), { type: "ack" });
    const newerPreview = state.asset().preview_r2_key;
    assert.equal(state.job().attempts, 2);
    release.resolve();
    assert.deepEqual(await staleOwner, { type: "ack" });
    assert.equal(state.job().status, "ready");
    assert.equal(state.job().attempts, 2);
    assert.equal(state.asset().preview_r2_key, newerPreview);
  } finally { release.resolve(); state.close(); }
});

test("a stale owner's failure cannot change the newer claim", async () => {
  const state = fixture();
  const entered = deferred();
  const release = deferred();
  state.setImageBehavior(async (call) => {
    if (call === 1) { entered.resolve(); await release.promise; throw new Error("old owner failed"); }
    return new Uint8Array([1, 2, 3]);
  });
  try {
    const staleOwner = deliver(state.env);
    await entered.promise;
    state.db.prepare("UPDATE asset_preview_jobs SET updated_at=datetime('now','-6 minutes') WHERE id='job-1'").run();
    assert.deepEqual(await deliver(state.env), { type: "ack" });
    assert.equal(state.job().status, "ready");
    release.resolve();
    assert.deepEqual(await staleOwner, { type: "retry", delaySeconds: 30 });
    assert.equal(state.job().status, "ready");
    assert.equal(state.job().attempts, 2);
    assert.equal(state.job().last_error, null);
    assert.equal(state.authority().state, "preview_ready");
  } finally { release.resolve(); state.close(); }
});
