import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";
import { roleCan } from "../src/lib/authorization.ts";

const actionsSource = await readFile(new URL("../src/app/money-actions.ts", import.meta.url), "utf8");
const actionStart = actionsSource.indexOf("export async function recordCommissionPaymentAction(");
const nextAction = actionsSource.indexOf("\nexport ", actionStart + 1);
assert.notEqual(actionStart, -1);
const actionCode = stripTypeScriptTypes(actionsSource.slice(actionStart, nextAction < 0 ? undefined : nextAction).replace("export async function", "async function"));

const creatorDbSource = await readFile(new URL("../src/lib/creator-db.ts", import.meta.url), "utf8");
const helperCode = stripTypeScriptTypes(creatorDbSource.replace('import "server-only";\n\n', "").replaceAll("export function", "function"));
const creatorPrepare = new Function(`${helperCode}; return creatorPrepare;`)();

class RedirectSignal extends Error {
  constructor(location) {
    super(location);
    this.location = location;
  }
}

function fixture(role = "agency_admin", withSettings = true) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE creator_finance_settings (creator_id TEXT PRIMARY KEY, agency_split_bps INTEGER NOT NULL);
    CREATE TABLE finance_audit_events (
      id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, actor TEXT NOT NULL, actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO creator_finance_settings (creator_id,agency_split_bps) VALUES ('own',0);
  `);
  if (!withSettings) sqlite.prepare("DELETE FROM creator_finance_settings WHERE creator_id='own'").run();
  let dbCalls = 0;
  const DB = {
    prepare(sql) {
      dbCalls += 1;
      return {
        bind(...values) {
          return {
            async first() { return sqlite.prepare(sql).get(...values) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...values) }; },
            async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
          };
        },
      };
    },
  };
  const identity = { creator: { creator_id: "own", role }, email: `${role}@example.test` };
  const revalidated = [];
  const requireCreatorContext = async (permission) => {
    if (!roleCan(identity.creator.role, permission)) throw new Error("permission denied");
    return identity;
  };
  const action = new Function("requireCreatorContext", "cloudflareEnv", "creatorPrepare", "revalidatePath", "redirect", `${actionCode}; return recordCommissionPaymentAction;`)(
    requireCreatorContext,
    () => ({ DB }),
    creatorPrepare,
    (path) => revalidated.push(path),
    (location) => { throw new RedirectSignal(location); },
  );
  const rowCount = (creatorId = "own") => sqlite.prepare("SELECT COUNT(*) AS count FROM finance_audit_events WHERE creator_id=? AND event_type='commission_payment_reported'").get(creatorId).count;
  return { sqlite, action, dbCalls: () => dbCalls, rowCount, revalidated, identity };
}

function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    amount: "12.34",
    currency: "aud",
    receivedOn: "2026-10-03",
    reference: "AGENCY-RECEIPT-42",
    ...overrides,
  })) data.set(key, value);
  return data;
}

async function submit(action, data = form()) {
  await assert.rejects(action(data), (error) => error instanceof RedirectSignal && error.location === "/money?notice=commission_payment_reported");
}

test("only agency admins can write payment evidence; viewer and operator deny before DB access", async () => {
  for (const role of ["viewer", "operator", "creator"]) {
    const state = fixture(role);
    try {
      await assert.rejects(state.action(form()), /permission denied/);
      assert.equal(state.dbCalls(), 0);
      assert.equal(state.rowCount(), 0);
    } finally {
      state.sqlite.close();
    }
  }
});

test("evidence is written only to the authenticated creator despite a forged creator field", async () => {
  const state = fixture();
  try {
    state.sqlite.exec("INSERT INTO creator_finance_settings (creator_id,agency_split_bps) VALUES ('foreign',2500)");
    await submit(state.action, form({ creatorId: "foreign" }));
    assert.equal(state.rowCount("own"), 1);
    assert.equal(state.rowCount("foreign"), 0);
    const row = state.sqlite.prepare("SELECT creator_id,actor,actor_role,event_type,detail FROM finance_audit_events").get();
    assert.equal(row.creator_id, "own");
    assert.equal(row.actor, "agency_admin@example.test");
    assert.equal(row.actor_role, "agency_admin");
    assert.equal(row.event_type, "commission_payment_reported");
    assert.deepEqual(JSON.parse(row.detail), { amountMinor: 1234, currency: "AUD", receivedOn: "2026-10-03", reference: "AGENCY-RECEIPT-42" });
    assert.deepEqual(state.revalidated, ["/money"]);
  } finally {
    state.sqlite.close();
  }
});

test("an explicitly saved zero split allows evidence, while an absent agreement blocks it", async () => {
  const zero = fixture("agency_admin", true);
  try {
    await submit(zero.action);
    assert.equal(zero.rowCount(), 1);
  } finally {
    zero.sqlite.close();
  }
  const unset = fixture("agency_admin", false);
  try {
    await assert.rejects(unset.action(form()), /Save a commission percentage proposal/);
    assert.equal(unset.rowCount(), 0);
  } finally {
    unset.sqlite.close();
  }
});

test("a valid explicit zero proposal allows reported-payment evidence without writing the legacy setting cache", async () => {
  const state = fixture("agency_admin", false);
  try {
    state.sqlite.prepare(`INSERT INTO finance_audit_events (id,creator_id,actor,actor_role,event_type,detail)
      VALUES ('proposal-zero','own','agency_admin@example.test','agency_admin','agency_split_proposed',?)`).run(JSON.stringify({
      agencySplitBps: 0, effectiveOn: "2026-10-04", revenueScope: "thot_generated_paid_site_sales",
      eligibleRevenueEvidence: "unresolved", basis: "unresolved", cadence: "unresolved",
      softwareFee: "none_currently", futureFee: "undecided",
    }));
    await submit(state.action);
    assert.equal(state.rowCount(), 1);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM creator_finance_settings WHERE creator_id='own'").get().count, 0);
  } finally { state.sqlite.close(); }
});

test("amount, currency, date, and reference are validated before any evidence is written", async () => {
  const invalidForms = [
    { amount: "0" }, { amount: "-1.00" }, { amount: "1.001" }, { amount: "1e2" }, { amount: "9999999999999.99" },
    { currency: "US" }, { currency: "US$" }, { receivedOn: "2026-02-30" }, { receivedOn: "03/10/2026" },
    { reference: " " }, { reference: "x".repeat(161) }, { reference: "REF\nINJECT" },
  ];
  const state = fixture();
  try {
    for (const invalid of invalidForms) await assert.rejects(state.action(form(invalid)));
    assert.equal(state.rowCount(), 0);
  } finally {
    state.sqlite.close();
  }
});

test("identical idempotency replay is harmless and a changed payload with the same ID fails", async () => {
  const state = fixture();
  try {
    const original = form();
    await submit(state.action, original);
    await submit(state.action, original);
    assert.equal(state.rowCount(), 1);
    await assert.rejects(state.action(form({ amount: "13.00" })), /request ID was already used for different evidence/);
    assert.equal(state.rowCount(), 1);
  } finally {
    state.sqlite.close();
  }
});

test("a request ID already owned by another creator cannot be replayed or disclosed", async () => {
  const state = fixture();
  try {
    state.sqlite.prepare(`INSERT INTO finance_audit_events (id,creator_id,actor,actor_role,event_type,detail)
      VALUES ('550e8400-e29b-41d4-a716-446655440000','foreign','other@example.test','agency_admin','commission_payment_reported','{}')`).run();
    await assert.rejects(state.action(form()), /request ID was already used for different evidence/);
    assert.equal(state.rowCount("own"), 0);
    assert.equal(state.rowCount("foreign"), 1);
  } finally {
    state.sqlite.close();
  }
});

test("money page lists only bounded creator-scoped agency-reported evidence without due totals", async () => {
  const [finance, page] = await Promise.all([
    readFile(new URL("../src/lib/finance.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/money/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(finance, /WHERE creator_id=@creator AND event_type='commission_payment_reported'[\s\S]*LIMIT 10/);
  assert.match(page, /Recent agency-reported evidence/);
  assert.match(page, /not bank-verified/);
  assert.match(page, /do not verify a bank transfer or state an amount due/);
  assert.doesNotMatch(page, /outstanding balance|amount owed|receivable total/i);
  assert.match(page, /context\.creator\.role === "agency_admin" && splitSet/);
});
