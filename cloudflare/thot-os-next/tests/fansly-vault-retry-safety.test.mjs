import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";
import { canRetryVaultJob } from "../src/lib/vault-job-status.ts";

const actionsSource = await readFile(new URL("../src/app/actions.ts", import.meta.url), "utf8");
const start = actionsSource.indexOf("export async function retryFanslyVaultJobAction(");
const end = actionsSource.indexOf("\nexport ", start + 1);
assert.notEqual(start, -1);
const actionCode = stripTypeScriptTypes(actionsSource.slice(start, end < 0 ? undefined : end).replace("export async function", "async function"));
const creatorDbSource = await readFile(new URL("../src/lib/creator-db.ts", import.meta.url), "utf8");
const helperCode = stripTypeScriptTypes(creatorDbSource.replace('import "server-only";\n\n', "").replaceAll("export function", "function"));
const creatorPrepare = new Function(`${helperCode}; return creatorPrepare;`)();

class RedirectSignal extends Error {
  constructor(location) { super(location); this.location = location; }
}

function fixture(role = "agency_admin", beforeUpdate = null) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE vault_upload_jobs (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, platform TEXT NOT NULL, status TEXT NOT NULL, receipt TEXT NOT NULL DEFAULT '{}', claimed_at TEXT, completed_at TEXT, error TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE vault_upload_events (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, creator_id TEXT NOT NULL, actor TEXT NOT NULL, actor_role TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT NOT NULL);
    INSERT INTO vault_upload_jobs (id,creator_id,platform,status,receipt) VALUES
      ('normal','own','fansly','failed','{"outcome":"failed"}'),
      ('uncertain','own','fansly','failed','{"outcome":"uncertain","reconciliationRequired":true}'),
      ('started','own','fansly','failed','{"uploadStarted":true}'),
      ('malformed','own','fansly','failed','{"outcome":'),
      ('foreign','other','fansly','failed','{}'),
      ('claimed','own','fansly','claimed','{}');
  `);
  const DB = {
    prepare(sql) {
      return { bind(...values) { return {
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async run() { if (sql.startsWith("UPDATE vault_upload_jobs")) beforeUpdate?.(sqlite); const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      }; } };
    },
  };
  const identity = { creator: { creator_id: "own", role }, email: "admin@example.test" };
  let authCalls = 0;
  const requireCreatorContext = async (permission) => {
    authCalls += 1;
    if (permission !== "approve" || role !== "agency_admin") throw new Error("permission denied");
    return identity;
  };
  const revalidated = [];
  const action = new Function("requireCreatorContext", "cloudflareEnv", "creatorPrepare", "canRetryVaultJob", "revalidatePath", "redirect", `${actionCode}; return retryFanslyVaultJobAction;`)(
    requireCreatorContext,
    () => ({ DB }),
    creatorPrepare,
    canRetryVaultJob,
    (path) => revalidated.push(path),
    (location) => { throw new RedirectSignal(location); },
  );
  return { sqlite, action, revalidated, authCalls: () => authCalls };
}

function form(jobId) { const data = new FormData(); data.set("jobId", jobId); return data; }

test("normal failed Fansly retry is creator-scoped and records the approved retry", async () => {
  const state = fixture();
  try {
    await assert.rejects(state.action(form("normal")), (error) => error instanceof RedirectSignal && error.location === "/operations?platform=fansly&section=queue&saved=retry_queued");
    assert.deepEqual(state.sqlite.prepare("SELECT status,receipt FROM vault_upload_jobs WHERE id='normal'").get(), { status: "approved", receipt: "{}" });
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM vault_upload_events WHERE job_id='normal' AND creator_id='own'").get().count, 1);
    assert.deepEqual(state.revalidated, ["/operations"]);
  } finally { state.sqlite.close(); }
});

test("uncertain, post-start, malformed, or still-claimed jobs cannot be reset for upload", async () => {
  for (const id of ["uncertain", "started", "malformed", "claimed"]) {
    const state = fixture();
    try {
      const before = state.sqlite.prepare("SELECT status,receipt FROM vault_upload_jobs WHERE id=?").get(id);
      await assert.rejects(state.action(form(id)), /Uncertain outcomes must be reconciled first/);
      assert.deepEqual(state.sqlite.prepare("SELECT status,receipt FROM vault_upload_jobs WHERE id=?").get(id), before);
      assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM vault_upload_events WHERE job_id=?").get(id).count, 0);
    } finally { state.sqlite.close(); }
  }
});

test("foreign creator jobs are invisible and non-approvers are rejected before database access", async () => {
  const foreignState = fixture();
  try {
    await assert.rejects(foreignState.action(form("foreign")), /Only a certain failed Fansly upload can be retried/);
    assert.equal(foreignState.sqlite.prepare("SELECT status FROM vault_upload_jobs WHERE id='foreign'").get().status, "failed");
    assert.equal(foreignState.sqlite.prepare("SELECT COUNT(*) AS count FROM vault_upload_events").get().count, 0);
  } finally { foreignState.sqlite.close(); }

  const viewer = fixture("viewer");
  try {
    await assert.rejects(viewer.action(form("normal")), /permission denied/);
    assert.equal(viewer.authCalls(), 1);
    assert.equal(viewer.sqlite.prepare("SELECT status FROM vault_upload_jobs WHERE id='normal'").get().status, "failed");
    assert.equal(viewer.sqlite.prepare("SELECT COUNT(*) AS count FROM vault_upload_events").get().count, 0);
  } finally { viewer.sqlite.close(); }
});


test("a late uncertainty receipt between read and retry cannot be erased", async () => {
  const receipt = JSON.stringify({ outcome: "uncertain", reconciliationRequired: true });
  const state = fixture("agency_admin", (db) => db.prepare("UPDATE vault_upload_jobs SET receipt=? WHERE id='normal'").run(receipt));
  try {
    await assert.rejects(state.action(form("normal")), /changed while retry was being approved/);
    assert.deepEqual(state.sqlite.prepare("SELECT status,receipt FROM vault_upload_jobs WHERE id='normal'").get(), { status: "failed", receipt });
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM vault_upload_events").get().count, 0);
  } finally { state.sqlite.close(); }
});
