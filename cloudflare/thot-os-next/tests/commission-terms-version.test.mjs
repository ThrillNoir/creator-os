import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";
import { roleCan } from "../src/lib/authorization.ts";

const source = await readFile(new URL("../src/app/money-actions.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function saveAgencySplitAction(");
const end = source.indexOf("\nexport ", start + 1);
assert.notEqual(start, -1);
const actionCode = stripTypeScriptTypes(source.slice(start, end < 0 ? undefined : end).replace("export async function", "async function"));
const creatorDbSource = await readFile(new URL("../src/lib/creator-db.ts", import.meta.url), "utf8");
const helperCode = stripTypeScriptTypes(creatorDbSource.replace('import "server-only";\n\n', "").replaceAll("export function", "function"));
const creatorPrepare = new Function(`${helperCode}; return creatorPrepare;`)();

class RedirectSignal extends Error {
  constructor(location) { super(location); this.location = location; }
}

const requestId = "550e8400-e29b-41d4-a716-446655440000";
function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ requestId, agencySplitPercent: "50.00", effectiveOn: "2026-10-04", ...overrides })) data.set(key, value);
  return data;
}

function fixture(role = "agency_admin") {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE creator_finance_settings (
      creator_id TEXT PRIMARY KEY, agency_split_bps INTEGER NOT NULL DEFAULT 0 CHECK(agency_split_bps BETWEEN 0 AND 10000),
      revenue_basis TEXT NOT NULL DEFAULT 'imported_net_earnings' CHECK(revenue_basis='imported_net_earnings'),
      updated_by TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE finance_audit_events (
      id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, actor TEXT NOT NULL, actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO creator_finance_settings (creator_id,agency_split_bps,updated_by) VALUES ('own',2500,'old@example.test');
    INSERT INTO finance_audit_events (id,creator_id,actor,actor_role,event_type,detail)
      VALUES ('legacy','own','old@example.test','agency_admin','agency_split_updated','{"agencySplitBps":2500}');
  `);
  let dbCalls = 0;
  const DB = { prepare(sql) { return { bind(...values) { return {
    async first() { dbCalls++; return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { dbCalls++; const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  const identity = { creator: { creator_id: "own", role }, email: `${role}@example.test` };
  const revalidated = [];
  const action = new Function("requireCreatorContext", "cloudflareEnv", "creatorPrepare", "revalidatePath", "redirect", `${actionCode}; return saveAgencySplitAction;`)(
    async (permission) => { if (!roleCan(identity.creator.role, permission)) throw new Error("permission denied"); return identity; },
    () => ({ DB }), creatorPrepare, (path) => revalidated.push(path), (location) => { throw new RedirectSignal(location); },
  );
  return { sqlite, identity, action, revalidated, dbCalls: () => dbCalls };
}

async function submit(action, data = form()) {
  await assert.rejects(action(data), (error) => error instanceof RedirectSignal && error.location === "/money?notice=split_saved");
}

test("saving a proposal appends a creator-scoped version and keeps the existing settings cache constraint", async () => {
  const state = fixture();
  try {
    await submit(state.action);
    const versions = state.sqlite.prepare("SELECT * FROM finance_audit_events WHERE creator_id='own' AND event_type='agency_split_proposed'").all();
    assert.equal(versions.length, 1);
    assert.equal(versions[0].actor, "agency_admin@example.test");
    assert.equal(versions[0].actor_role, "agency_admin");
    assert.deepEqual(JSON.parse(versions[0].detail), {
      agencySplitBps: 5000, effectiveOn: "2026-10-04", revenueScope: "thot_generated_paid_site_sales",
      eligibleRevenueEvidence: "unresolved", basis: "unresolved", cadence: "unresolved", softwareFee: "none_currently", futureFee: "undecided",
    });
    assert.equal(state.sqlite.prepare("SELECT agency_split_bps FROM creator_finance_settings WHERE creator_id='own'").get().agency_split_bps, 2500);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_audit_events WHERE id='legacy'").get().n, 1);
    assert.deepEqual(state.revalidated, ["/money"]);
  } finally { state.sqlite.close(); }
});

test("percentage override and explicit zero are versioned without overwriting legacy settings", async () => {
  for (const [percent, expectedBps] of [["25.00", 2500], ["0", 0]]) {
    const state = fixture();
    try {
      await submit(state.action, form({ agencySplitPercent: percent }));
      assert.equal(state.sqlite.prepare("SELECT agency_split_bps FROM creator_finance_settings WHERE creator_id='own'").get().agency_split_bps, 2500);
      const version = state.sqlite.prepare("SELECT detail FROM finance_audit_events WHERE event_type='agency_split_proposed'").get();
      assert.equal(JSON.parse(version.detail).agencySplitBps, expectedBps);
    } finally { state.sqlite.close(); }
  }
});

test("invalid percentage and invalid effective dates are rejected before any proposal write", async () => {
  const state = fixture();
  try {
    for (const invalid of [
      { agencySplitPercent: "100.01" }, { agencySplitPercent: "-1" }, { agencySplitPercent: "1e2" },
      { effectiveOn: "2026-02-30" }, { effectiveOn: "2026-2-3" }, { effectiveOn: "" },
    ]) await assert.rejects(state.action(form(invalid)));
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_audit_events WHERE event_type='agency_split_proposed'").get().n, 0);
  } finally { state.sqlite.close(); }
});

test("only authorized managers may write and forged creator identifiers are ignored", async () => {
  for (const role of ["viewer", "operator", "creator"]) {
    const state = fixture(role);
    try { await assert.rejects(state.action(form()), /permission denied/); assert.equal(state.dbCalls(), 0); }
    finally { state.sqlite.close(); }
  }
  const state = fixture();
  try {
    state.sqlite.exec("INSERT INTO creator_finance_settings (creator_id,agency_split_bps,updated_by) VALUES ('foreign',7000,'x')");
    await submit(state.action, form({ creatorId: "foreign" }));
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_audit_events WHERE creator_id='foreign' AND event_type='agency_split_proposed'").get().n, 0);
  } finally { state.sqlite.close(); }
});

test("request replay is idempotent, conflicts fail, and another creator's request ID cannot be reused", async () => {
  const state = fixture();
  try {
    await submit(state.action);
    await submit(state.action);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_audit_events WHERE event_type='agency_split_proposed'").get().n, 1);
    await assert.rejects(state.action(form({ agencySplitPercent: "51" })), /request ID was already used for different proposed terms/);
    state.sqlite.prepare(`INSERT INTO finance_audit_events (id,creator_id,actor,actor_role,event_type,detail)
      VALUES (?, 'foreign', 'foreign@example.test','agency_admin','other','{}')`).run("550e8400-e29b-41d4-a716-446655440001");
    await assert.rejects(state.action(form({ requestId: "550e8400-e29b-41d4-a716-446655440001" })), /request ID was already used for different proposed terms/);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_audit_events WHERE creator_id='foreign'").get().n, 1);
  } finally { state.sqlite.close(); }
});

test("replaying an older proposal after a newer version leaves every version and legacy value unchanged", async () => {
  const state = fixture();
  try {
    const first = form();
    await submit(state.action, first);
    await submit(state.action, form({ requestId: "550e8400-e29b-41d4-a716-446655440002", agencySplitPercent: "61", effectiveOn: "2026-11-01" }));
    await submit(state.action, first);
    const rows = state.sqlite.prepare("SELECT id,detail FROM finance_audit_events WHERE event_type='agency_split_proposed' ORDER BY id").all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => JSON.parse(row.detail).agencySplitBps).sort((a, b) => a - b), [5000, 6100]);
    assert.equal(state.sqlite.prepare("SELECT agency_split_bps FROM creator_finance_settings WHERE creator_id='own'").get().agency_split_bps, 2500);
  } finally { state.sqlite.close(); }
});
