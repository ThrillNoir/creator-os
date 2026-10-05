import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import ts from "../cloudflare/thot-os-next/node_modules/typescript/lib/typescript.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workerSource = await readFile(new URL("../cloudflare/vault-bridge/src/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../cloudflare/thot-os-app/migrations/0007_vault_bridge.sql", import.meta.url), "utf8");
const extensionSource = await readFile(new URL("../public/local-bridge-extension/background.js", import.meta.url), "utf8");
function functionSource(name, endMarker) {
  const start = workerSource.indexOf(`async function ${name}(`);
  const end = workerSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${name} handler boundaries exist`);
  return workerSource.slice(start, end);
}
const boundedReceiptStart = workerSource.indexOf("function boundedReceipt(");
const boundedReceiptEnd = workerSource.indexOf("\ntype FanslyReceiptJob", boundedReceiptStart);
assert.ok(boundedReceiptStart >= 0 && boundedReceiptEnd > boundedReceiptStart, "bounded receipt helper boundaries exist");
const handlers = ts.transpileModule([
  workerSource.slice(boundedReceiptStart, boundedReceiptEnd),
  functionSource("claimJob", "\nasync function mediaRedirect"),
  functionSource("recordReceipt", "\nfunction canonicalFanslyThread"),
].join("\n"), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE assets (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, basename TEXT NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE operational_accounts (id TEXT PRIMARY KEY, creator_id TEXT, platform TEXT, last_success_at TEXT, last_checked_at TEXT, warning_level TEXT, warning_message TEXT, updated_at TEXT);
    CREATE TABLE vault_upload_jobs (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, account_id TEXT NOT NULL, asset_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('fansly','myroomz')), status TEXT NOT NULL DEFAULT 'approved'
      CHECK(status IN ('approved','claimed','staged','verified','failed','cancelled')), approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, claimed_at TEXT, completed_at TEXT, error TEXT,
      receipt TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE vault_upload_events (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, creator_id TEXT NOT NULL, actor TEXT NOT NULL,
      actor_role TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  // Keep the fixture aligned with the documented status contract in the original schema.
  assert.match(migration, /status IN \('approved','claimed','staged','verified','failed','cancelled'\)/);
  db.prepare("INSERT INTO assets VALUES ('asset-1','creator-1','photo.jpg',12)").run();
  db.prepare("INSERT INTO operational_accounts (id,creator_id,platform) VALUES ('account-1','creator-1','fansly')").run();
  db.prepare("INSERT INTO vault_upload_jobs (id,creator_id,account_id,asset_id,platform,approved_by) VALUES ('job-1','creator-1','account-1','asset-1','fansly','owner')").run();
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        first() { return db.prepare(sql).get(...values) ?? null; },
        run() { const result = db.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try { const results = statements.map((statement) => statement.run()); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  const identity = { creator_id: "creator-1", account_id: "account-1", profile_id: "profile-1", platform: "fansly" };
  const json = (_request, body, status = 200) => Response.json(body, { status });
  const loaded = await new AsyncFunction("json", "crypto", `${handlers}\nreturn { claimJob, recordReceipt };`)(json, globalThis.crypto);
  return { db, DB, identity, handlers: loaded };
}

const claimRequest = () => new Request("https://bridge.example/jobs/claim", { headers: { "x-thot-os-vault-client": "explicit-v4" } });
const receiptRequest = (body) => new Request("https://bridge.example/jobs/job-1/receipt", { method: "POST", body: JSON.stringify(body) });

test("expired Fansly claims become uncertain, stay nonclaimable, and accept a same-account late receipt", async () => {
  const state = await fixture();
  const env = { DB: state.DB };
  const initial = await state.handlers.claimJob(claimRequest(), env, state.identity);
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).job.id, "job-1");
  const lostReceipt = await state.handlers.recordReceipt(receiptRequest({ status: "failed", error: "Lost response while saving receipt.", receipt: { uploadStarted: true, diagnostic: "x".repeat(13_000) } }), env, state.identity, "job-1");
  assert.equal(lostReceipt.status, 200);
  const caughtUncertain = state.db.prepare("SELECT status,completed_at,receipt FROM vault_upload_jobs WHERE id='job-1'").get();
  assert.equal(caughtUncertain.status, "claimed");
  assert.equal(caughtUncertain.completed_at, null);
  assert.equal(JSON.parse(caughtUncertain.receipt).outcome, "uncertain");
  assert.equal(JSON.parse(caughtUncertain.receipt).reconciliationRequired, true);
  assert.equal(JSON.parse(caughtUncertain.receipt).receiptTruncated, true, "bounded overflow must preserve valid uncertainty JSON");
  state.db.prepare("UPDATE vault_upload_jobs SET claimed_at=datetime('now','-3 minutes') WHERE id='job-1'").run();

  const replay = await state.handlers.claimJob(claimRequest(), env, state.identity);
  const replayBody = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayBody.job, null, "expired claim must never be handed to a second upload attempt");
  assert.equal(replayBody.reconciliationRequired, true);
  const uncertain = state.db.prepare("SELECT status,error,receipt FROM vault_upload_jobs WHERE id='job-1'").get();
  assert.equal(uncertain.status, "claimed", "uncertainty stays active so manual retry cannot requeue the original");
  assert.match(uncertain.error, /outcome is uncertain/i);
  assert.equal(JSON.parse(uncertain.receipt).outcome, "uncertain");
  assert.equal(JSON.parse(uncertain.receipt).reconciliationRequired, true);

  const foreignReceipt = await state.handlers.recordReceipt(receiptRequest({ status: "staged", receipt: { savedVaultRecord: true, nativeAttachment: true, externalMediaId: "media-1" } }), env,
    { ...state.identity, account_id: "other-account" }, "job-1");
  assert.equal(foreignReceipt.status, 409, "late receipts remain scoped to the original account identity");

  const lateReceipt = await state.handlers.recordReceipt(receiptRequest({ status: "staged", receipt: { savedVaultRecord: true, nativeAttachment: true, externalMediaId: "media-1" } }), env, state.identity, "job-1");
  assert.equal(lateReceipt.status, 200);
  assert.deepEqual(await lateReceipt.json(), { ok: true, status: "verified" });
  assert.equal(state.db.prepare("SELECT status FROM vault_upload_jobs WHERE id='job-1'").get().status, "verified");
});

test("post-attachment negative and incomplete staged receipts remain uncertain", async () => {
  const state = await fixture();
  const env = { DB: state.DB };
  const claimed = await state.handlers.claimJob(claimRequest(), env, state.identity);
  assert.equal((await claimed.json()).job.id, "job-1");

  const negativeResult = await state.handlers.recordReceipt(receiptRequest({ status: "failed", error: "Fansly did not confirm the saved record.", receipt: { uploadStarted: true, nativeAttachment: true } }), env, state.identity, "job-1");
  assert.equal(negativeResult.status, 200);
  let job = state.db.prepare("SELECT status,error,receipt FROM vault_upload_jobs WHERE id='job-1'").get();
  assert.equal(job.status, "claimed", "a nonthrowing browser failure after attachment cannot become retryable");
  assert.equal(JSON.parse(job.receipt).outcome, "uncertain");
  assert.match(job.error, /verify the vault before retrying/i);

  const incompleteSuccess = await state.handlers.recordReceipt(receiptRequest({ status: "staged", receipt: { uploadStarted: true, nativeAttachment: true, savedVaultRecord: true } }), env, state.identity, "job-1");
  assert.equal(incompleteSuccess.status, 200);
  job = state.db.prepare("SELECT status,receipt FROM vault_upload_jobs WHERE id='job-1'").get();
  assert.equal(job.status, "claimed", "staged without a stable external media ID remains uncertain");
  assert.equal(JSON.parse(job.receipt).outcome, "uncertain");
});

test("extension only reports a Fansly upload as staged after server verification", async () => {
  const start = extensionSource.indexOf("const processVaultQueue=async(");
  const end = extensionSource.indexOf("\n\nchrome.runtime.onMessage.addListener", start);
  assert.ok(start >= 0 && end > start, "extension queue handler boundaries exist");
  const body = extensionSource.slice(start, end);
  async function run(serverStatus) {
    let executeCount = 0;
    let receiptPayload;
    const chrome = { scripting: { executeScript: async () => {
      executeCount++;
      if (executeCount === 1) return [{ result: { ready: true } }];
      if (executeCount === 2) return [{ result: { savedMediaIds: [] } }];
      return [{ result: { status: "failed", error: "Fansly did not confirm the saved record.", receipt: { savedVaultRecord: false } } }];
    } } };
    const bridgeRequest = async (_config, path, options = {}) => {
      if (path === "/jobs/claim") return { ok: true, status: 200, json: async () => ({ job: { id: "job-1", basename: "photo.jpg" } }) };
      receiptPayload = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, status: serverStatus }) };
    };
    const makeHandler = new Function("chrome", "vaultPlatformForUrl", "claim", "bridgeRequest", "prepareFanslyVault", "readFanslyVaultState", "downloadBridgeMedia", "attachLocalFileToNativeInput", "verifyFanslyVaultAttachment", "discardBridgeDownload",
      `let vaultUploadRunning=false; ${body}; return processVaultQueue;`);
    const handler = makeHandler(chrome, () => true, async () => ({ token: "fixture" }), bridgeRequest,
      () => {}, () => {}, async () => ({ downloadId: "download-1", localMediaPath: "/tmp/photo.jpg", downloadBytes: 12 }),
      async () => {}, () => {}, async () => {});
    return { result: await handler(1, "https://fansly.com/creator/vault"), receiptPayload };
  }
  const uncertain = await run("claimed");
  assert.equal(uncertain.result.state, "uncertain");
  assert.equal(uncertain.result.ok, false);
  assert.equal(uncertain.receiptPayload.receipt.uploadStarted, true);
  assert.equal(uncertain.receiptPayload.receipt.outcome, "uncertain");
  const verified = await run("verified");
  assert.equal(verified.result.state, "staged");
  assert.equal(verified.result.ok, true);
});
