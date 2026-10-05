import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { File } from "node:buffer";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";
import { financePlatforms, normaliseFinanceCsv } from "../src/lib/finance-metrics.ts";

const source = await readFile(new URL("../src/app/money-actions.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function importFinanceCsvAction(");
const end = source.indexOf("\nexport ", start + 1);
assert.notEqual(start, -1);
const actionCode = stripTypeScriptTypes(source.slice(start, end < 0 ? undefined : end).replace("export async function", "async function"));
const platformCode = stripTypeScriptTypes(source.match(/function platformValue\([\s\S]*?\n}/)?.[0].replace("function", "function") ?? "");
const hashCode = stripTypeScriptTypes(source.match(/async function sha256\([\s\S]*?\n}/)?.[0] ?? "");
assert.ok(platformCode && hashCode);
const creatorDbSource = await readFile(new URL("../src/lib/creator-db.ts", import.meta.url), "utf8");
const helperCode = stripTypeScriptTypes(creatorDbSource.replace('import "server-only";\n\n', "").replaceAll("export function", "function"));
const creatorPrepare = new Function(`${helperCode}; return creatorPrepare;`)();

function fixture({ dbFailure = false } = {}) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE finance_imports (id TEXT PRIMARY KEY, creator_id TEXT, platform TEXT, source_name TEXT, content_hash TEXT, row_count INTEGER, imported_by TEXT, UNIQUE(creator_id,platform,content_hash));
    CREATE TABLE finance_daily_metrics (creator_id TEXT, platform TEXT, period_date TEXT, currency TEXT, gross_revenue_minor INTEGER, refunds_minor INTEGER, net_revenue_minor INTEGER, subscribers INTEGER, import_id TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(creator_id,platform,period_date,currency));
    CREATE TABLE finance_audit_events (id TEXT PRIMARY KEY, creator_id TEXT, actor TEXT, actor_role TEXT, event_type TEXT, detail TEXT);
  `);
  let prepares = 0;
  let batches = 0;
  const DB = {
    prepare(sql) {
      prepares++;
      if (dbFailure) throw new Error("SECRET SQL/connection detail");
      return { bind(...values) { return {
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      }; } };
    },
    async batch(statements) { batches++; return Promise.all(statements.map((statement) => statement.run())); },
  };
  const identity = { creator: { creator_id: "creator-own", role: "agency_admin" }, email: "admin@example.test" };
  const code = `${platformCode}; ${hashCode}; ${actionCode}; return importFinanceCsvAction;`;
  const action = new Function("requireCreatorContext", "cloudflareEnv", "creatorPrepare", "financePlatforms", "normaliseFinanceCsv", "File", "revalidatePath", code)(
    async () => identity,
    () => ({ DB }),
    creatorPrepare,
    financePlatforms,
    normaliseFinanceCsv,
    File,
    () => {},
  );
  return { sqlite, action, get prepares() { return prepares; }, get batches() { return batches; } };
}

function submission(csv, overrides = {}) {
  const data = new FormData();
  data.set("platform", "onlyfans");
  data.set("file", new File([csv], "earnings.csv", { type: "text/csv" }));
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

test("missing currency header and blank row currency return row-specific errors before any database access", async () => {
  for (const csv of ["date,revenue\n2026-10-01,10.00", "date,revenue,currency\n2026-10-01,10.00,  "]) {
    const state = fixture();
    try {
      const result = await state.action(submission(csv));
      assert.equal(result.kind, "error");
      assert.match(result.message, /Row 2 needs a currency code/);
      assert.equal(state.prepares, 0);
      assert.equal(state.batches, 0);
    } finally { state.sqlite.close(); }
  }
});

test("a valid mixed-currency reviewed export keeps its currencies separate and exact reimport is duplicate", async () => {
  const state = fixture();
  try {
    const csv = "date,gross_revenue,refunds,currency,subscribers\n2026-10-01,100.00,10.00,aud,3\n2026-10-01,50.00,,USD,4";
    assert.deepEqual(await state.action(submission(csv)), { kind: "imported" });
    assert.deepEqual(state.sqlite.prepare("SELECT currency,gross_revenue_minor,refunds_minor,net_revenue_minor FROM finance_daily_metrics ORDER BY currency").all(), [
      { currency: "AUD", gross_revenue_minor: 10000, refunds_minor: 1000, net_revenue_minor: 9000 },
      { currency: "USD", gross_revenue_minor: 5000, refunds_minor: null, net_revenue_minor: 5000 },
    ]);
    assert.deepEqual(await state.action(submission(csv)), { kind: "duplicate" });
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM finance_imports").get().count, 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM finance_daily_metrics").get().count, 2);
  } finally { state.sqlite.close(); }
});

test("database failures return a safe retry instruction without exposing internals", async () => {
  const state = fixture({ dbFailure: true });
  try {
    const result = await state.action(submission("date,revenue,currency\n2026-10-01,10.00,AUD"));
    assert.equal(result.kind, "error");
    assert.match(result.message, /file is still selected; check recent imports before retrying/);
    assert.doesNotMatch(result.message, /SECRET SQL|connection detail/);
  } finally { state.sqlite.close(); }
});

test("client form submits in place and only clears selected file after import confirmation", async () => {
  const source = await readFile(new URL("../src/components/finance-csv-import-form.tsx", import.meta.url), "utf8");
  assert.match(source, /onSubmit=\{submit\}/);
  assert.doesNotMatch(source, /<form[^>]*action=/);
  assert.match(source, /await submitFinanceCsv\(/);
  assert.match(source, /result\?\.kind === "error"[\s\S]*selected file remains available/);
  const helperCode = stripTypeScriptTypes(source.match(/export async function submitFinanceCsv\([\s\S]*?\n}/)?.[0].replace("export async function", "async function") ?? "");
  assert.ok(helperCode);
  const submitFinanceCsv = new Function(`${helperCode}; return submitFinanceCsv;`)();
  let result;
  let resets = 0;
  let refreshes = 0;
  await submitFinanceCsv(
    async () => { throw new Error("private transport/database detail"); },
    (value) => { result = value; },
    () => { resets++; },
    () => { refreshes++; },
  );
  assert.equal(result.kind, "error");
  assert.match(result.message, /server did not confirm the import/);
  assert.match(result.message, /file is still selected/);
  assert.doesNotMatch(result.message, /private transport|database detail/);
  assert.equal(resets, 0);
  assert.equal(refreshes, 0);
});
