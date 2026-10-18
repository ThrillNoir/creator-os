import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import Database from "better-sqlite3";

const pairingSource = await readFile(new URL("../src/lib/fansly-pairing.ts", import.meta.url), "utf8");
const identityActionsSource = await readFile(new URL("../src/app/identity-actions.ts", import.meta.url), "utf8");
const operationsSource = await readFile(new URL("../src/lib/operations.ts", import.meta.url), "utf8");
const creatorDbSource = await readFile(new URL("../src/lib/creator-db.ts", import.meta.url), "utf8");
const pairingCode = stripTypeScriptTypes(pairingSource.replace(/^import .*;\n/gm, "").replaceAll("export async function", "async function"));
const assignmentStart = identityActionsSource.indexOf("export async function assignBrowserProfileAction(");
const assignmentEnd = identityActionsSource.indexOf("\nexport ", assignmentStart + 1);
assert.notEqual(assignmentStart, -1);
const assignmentCode = stripTypeScriptTypes(identityActionsSource.slice(assignmentStart, assignmentEnd).replace("export async function", "async function"));
const revocationStart = identityActionsSource.indexOf("export async function revokeBridgeCredentialsAction(");
const revocationEnd = identityActionsSource.indexOf("\nexport ", revocationStart + 1);
assert.notEqual(revocationStart, -1);
const revocationCode = stripTypeScriptTypes(identityActionsSource.slice(revocationStart, revocationEnd).replace("export async function", "async function"));
const creatorDbCode = stripTypeScriptTypes(creatorDbSource.replace('import "server-only";\n\n', "").replaceAll("export function", "function"));
const creatorPrepare = new Function(`${creatorDbCode}; return creatorPrepare;`)();

const oldInstallation = "11111111-1111-4111-8111-111111111111";
const newInstallation = "22222222-2222-4222-8222-222222222222";

function fixture({ afterRead, afterCurrentRead, failAudit = false } = {}) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE operational_accounts (id TEXT PRIMARY KEY,creator_id TEXT,platform TEXT,label TEXT,external_identity_confirmed_at TEXT);
    CREATE TABLE browser_profiles (id TEXT PRIMARY KEY,creator_id TEXT,installation_id TEXT,status TEXT);
    CREATE TABLE account_browser_profiles (creator_id TEXT,account_id TEXT,profile_id TEXT,platform TEXT,assigned_by TEXT,assigned_at TEXT,verified_at TEXT,PRIMARY KEY(creator_id,account_id));
    CREATE TABLE messaging_connections (id TEXT,creator_id TEXT,account_id TEXT,platform TEXT);
    CREATE TABLE bridge_credentials (id TEXT PRIMARY KEY,creator_id TEXT,account_id TEXT,profile_id TEXT,platform TEXT,token_hash TEXT,status TEXT,issued_by TEXT,expires_at TEXT,revoked_at TEXT);
    CREATE TABLE messaging_audit_events (id TEXT,creator_id TEXT,connection_id TEXT,event_type TEXT,actor TEXT,actor_role TEXT,detail TEXT);
    CREATE TABLE identity_audit_events (id TEXT,creator_id TEXT,actor_email TEXT,actor_role TEXT,event_type TEXT,subject TEXT,detail TEXT);
    INSERT INTO operational_accounts VALUES ('account','adelaide','fansly','Adelaide Fansly',CURRENT_TIMESTAMP);
    INSERT INTO browser_profiles VALUES ('old','adelaide','${oldInstallation}','paired');
    INSERT INTO browser_profiles VALUES ('new','adelaide','${newInstallation}','registered');
    INSERT INTO account_browser_profiles (creator_id,account_id,profile_id,platform,assigned_by) VALUES ('adelaide','account','old','fansly','admin@example.test');
    INSERT INTO messaging_connections VALUES ('connection','adelaide','account','fansly');
    INSERT INTO bridge_credentials VALUES ('old-credential','adelaide','account','old','fansly','old-hash','active','admin@example.test',datetime('now','+30 days'),NULL);
  `);
  const DB = {
    prepare(sql) {
      return { bind(...params) { return {
        async first() {
          const row = sqlite.prepare(sql).get(...params) ?? null;
          if (sql.includes("AS account_id")) afterRead?.(sqlite);
          if (sql.includes("AS has_live_credential")) afterCurrentRead?.(sqlite);
          return row;
        },
        async run() {
          if (failAudit && sql.includes("INSERT INTO identity_audit_events")) throw new Error("audit unavailable");
          return { meta: { changes: sqlite.prepare(sql).run(...params).changes } };
        },
      }; } };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const identity = { creator: { creator_id: "adelaide", role: "agency_admin" }, email: "admin@example.test" };
  const issue = new Function("requireCreatorContext", "cloudflareEnv", "creatorPrepare", "humanAuditActor", "identityAuditStatement", `${pairingCode}; return issueFanslyBridgePairing;`)(
    async (permission) => { assert.equal(permission, "manage_identity"); return identity; },
    () => ({ DB, VAULT_BRIDGE_BASE_URL: "https://bridge.example.test" }),
    creatorPrepare,
    (context) => ({ identity: context.email, role: context.creator.role, creatorId: context.creator.creator_id }),
    (db, actor, eventType, subject, detail) => db.prepare("INSERT INTO identity_audit_events VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), actor.creatorId, actor.identity, actor.role, eventType, subject, JSON.stringify(detail)),
  );
  const assign = new Function("requireCreatorContext", "cloudflareEnv", "humanAuditActor", "identityAuditStatement", "revalidatePath", `${assignmentCode}; return assignBrowserProfileAction;`)(
    async (permission, creatorId) => { assert.equal(permission, "manage_identity"); assert.equal(creatorId, "adelaide"); return identity; },
    () => ({ DB }),
    (context) => ({ identity: context.email, role: context.creator.role, creatorId: context.creator.creator_id }),
    (db, actor, eventType, subject, detail) => db.prepare("INSERT INTO identity_audit_events VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), actor.creatorId, actor.identity, actor.role, eventType, subject, JSON.stringify(detail)),
    () => {},
  );
  const revoke = new Function("requireConfirmation", "requireCreatorContext", "cloudflareEnv", "humanAuditActor", "identityAuditStatement", "revalidatePath", `${revocationCode}; return revokeBridgeCredentialsAction;`)(
    (form, value) => { assert.equal(form.get("confirmation"), value); },
    async (permission, creatorId) => { assert.equal(permission, "manage_identity"); assert.equal(creatorId, "adelaide"); return identity; },
    () => ({ DB }),
    (context) => ({ identity: context.email, role: context.creator.role, creatorId: context.creator.creator_id }),
    (db, actor, eventType, subject, detail) => db.prepare("INSERT INTO identity_audit_events VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), actor.creatorId, actor.identity, actor.role, eventType, subject, JSON.stringify(detail)),
    () => {},
  );
  return { sqlite, issue, assign, revoke };
}

function state(sqlite) {
  return {
    credentials: sqlite.prepare("SELECT id,profile_id,status,revoked_at FROM bridge_credentials ORDER BY id").all(),
    auditCount: sqlite.prepare("SELECT COUNT(*) AS n FROM identity_audit_events").get().n,
  };
}

test("new installation is rejected before any credential or audit mutation", async () => {
  const { sqlite, issue } = fixture();
  try {
    const before = state(sqlite);
    await assert.rejects(issue("vault", newInstallation), /not the assigned Chrome profile/);
    await assert.rejects(issue("messages", ""), /Copy the installation ID/);
    assert.deepEqual(state(sqlite), before);
  } finally { sqlite.close(); }
});

test("matching installation cannot accumulate a second active bearer credential", async () => {
  const { sqlite, issue } = fixture();
  try {
    await assert.rejects(issue("vault", oldInstallation), /already has a live bridge/);
    assert.deepEqual(sqlite.prepare("SELECT status,revoked_at FROM bridge_credentials WHERE id='old-credential'").get(), { status: "active", revoked_at: null });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bridge_credentials").get().n, 1);
    assert.equal(state(sqlite).auditCount, 0);
  } finally { sqlite.close(); }
});

test("matching installation can pair after the old credential expires", async () => {
  const { sqlite, issue } = fixture();
  try {
    sqlite.prepare("UPDATE bridge_credentials SET expires_at=datetime('now','-1 day') WHERE id='old-credential'").run();
    const url = await issue("vault", oldInstallation);
    assert.match(url, /^https:\/\/bridge\.example\.test\/pair#/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bridge_credentials WHERE status='active' AND expires_at>CURRENT_TIMESTAMP").get().n, 1);
    assert.equal(state(sqlite).auditCount, 1);
  } finally { sqlite.close(); }
});

test("a changed assignment between lookup and insert fails without revoking the old credential", async () => {
  const { sqlite, issue } = fixture({ afterRead: (db) => db.prepare("UPDATE account_browser_profiles SET profile_id='new' WHERE account_id='account'").run() });
  try {
    sqlite.prepare("UPDATE bridge_credentials SET expires_at=datetime('now','-1 day') WHERE id='old-credential'").run();
    await assert.rejects(issue("vault", oldInstallation), /assigned profile changed/);
    assert.equal(sqlite.prepare("SELECT status FROM bridge_credentials WHERE id='old-credential'").get().status, "active");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bridge_credentials").get().n, 1);
    assert.equal(state(sqlite).auditCount, 0);
  } finally { sqlite.close(); }
});

test("admin profile reassignment cannot displace a live bridge credential", async () => {
  const { sqlite, assign } = fixture();
  try {
    const form = new FormData();
    form.set("accountId", "account");
    form.set("profileId", "new");
    await assert.rejects(assign("adelaide", form), /live bridge credential/);
    assert.equal(sqlite.prepare("SELECT profile_id FROM account_browser_profiles WHERE account_id='account'").get().profile_id, "old");
    assert.equal(state(sqlite).auditCount, 0);
  } finally { sqlite.close(); }
});

test("admin assignment still works after the prior credential is no longer active", async () => {
  const { sqlite, assign } = fixture();
  try {
    sqlite.prepare("UPDATE bridge_credentials SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id='old-credential'").run();
    const form = new FormData();
    form.set("accountId", "account");
    form.set("profileId", "new");
    await assign("adelaide", form);
    assert.equal(sqlite.prepare("SELECT profile_id FROM account_browser_profiles WHERE account_id='account'").get().profile_id, "new");
    assert.equal(state(sqlite).auditCount, 1);
  } finally { sqlite.close(); }
});

test("admin revocation targets only the selected assigned credential", async () => {
  const { sqlite, revoke } = fixture();
  try {
    sqlite.prepare("INSERT INTO bridge_credentials VALUES ('other-credential','adelaide','account','new','fansly','other-hash','active','admin@example.test',datetime('now','+30 days'),NULL)").run();
    const form = new FormData();
    form.set("accountId", "account");
    form.set("credentialId", "old-credential");
    form.set("confirmation", "revoke-bridge");
    await revoke("adelaide", form);
    assert.equal(sqlite.prepare("SELECT status FROM bridge_credentials WHERE id='old-credential'").get().status, "revoked");
    assert.equal(sqlite.prepare("SELECT status FROM bridge_credentials WHERE id='other-credential'").get().status, "active");
    assert.equal(state(sqlite).auditCount, 1);
    await assert.rejects(revoke("adelaide", form), /no longer assigned/);
    form.set("credentialId", "other-credential");
    await assert.rejects(revoke("adelaide", form), /no longer assigned/);
    assert.equal(state(sqlite).auditCount, 1);
  } finally { sqlite.close(); }
});

test("admin revocation rolls back when its audit cannot be written", async () => {
  const { sqlite, revoke } = fixture({ failAudit: true });
  try {
    const form = new FormData();
    form.set("accountId", "account");
    form.set("credentialId", "old-credential");
    form.set("confirmation", "revoke-bridge");
    await assert.rejects(revoke("adelaide", form), /audit unavailable/);
    assert.equal(sqlite.prepare("SELECT status FROM bridge_credentials WHERE id='old-credential'").get().status, "active");
    assert.equal(state(sqlite).auditCount, 0);
  } finally { sqlite.close(); }
});

test("credential arriving during admin reassignment blocks the change and its success audit", async () => {
  const { sqlite, assign } = fixture({ afterCurrentRead: (db) => db.prepare("UPDATE bridge_credentials SET status='active',revoked_at=NULL WHERE id='old-credential'").run() });
  try {
    sqlite.prepare("UPDATE bridge_credentials SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id='old-credential'").run();
    const form = new FormData();
    form.set("accountId", "account");
    form.set("profileId", "new");
    await assert.rejects(assign("adelaide", form), /bridge became active/);
    assert.equal(sqlite.prepare("SELECT profile_id FROM account_browser_profiles WHERE account_id='account'").get().profile_id, "old");
    assert.equal(state(sqlite).auditCount, 0);
  } finally { sqlite.close(); }
});

test("vault health selects only the currently assigned credential and distinguishes pending from verified", () => {
  const query = operationsSource.match(/DB\.prepare\(`(SELECT bc\.status,bc\.expires_at,bc\.last_seen_at,bc\.created_at[\s\S]*?)`\)\.bind\(creatorId, creatorId\)/)?.[1];
  assert.ok(query, "vault pairing health query exists");
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE bridge_credentials (creator_id TEXT,account_id TEXT,profile_id TEXT,platform TEXT,status TEXT,expires_at TEXT,last_seen_at TEXT,created_at TEXT);
      CREATE TABLE account_browser_profiles (creator_id TEXT,account_id TEXT,profile_id TEXT,verified_at TEXT);
      CREATE TABLE browser_profiles (id TEXT,creator_id TEXT,label TEXT,status TEXT);
      CREATE TABLE operational_accounts (id TEXT,creator_id TEXT,platform TEXT,is_active INTEGER,label TEXT);
      INSERT INTO operational_accounts VALUES ('account','adelaide','fansly',1,'Fansly');
      INSERT INTO browser_profiles VALUES ('old','adelaide','Old Chrome','paired'),('new','adelaide','New Chrome','registered');
      INSERT INTO account_browser_profiles VALUES ('adelaide','account','old',CURRENT_TIMESTAMP);
      INSERT INTO bridge_credentials VALUES ('adelaide','account','old','fansly','active',datetime('now','+30 days'),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    `);
    const read = () => sqlite.prepare(query).get("adelaide", "adelaide") ?? null;
    assert.equal(read().profile_status, "paired");
    sqlite.prepare("UPDATE account_browser_profiles SET profile_id='new',verified_at=NULL").run();
    assert.equal(read(), null, "a formerly paired but displaced profile is not current health");
    sqlite.prepare("INSERT INTO bridge_credentials VALUES ('adelaide','account','new','fansly','active',datetime('now','+30 days'),NULL,CURRENT_TIMESTAMP)").run();
    assert.deepEqual({ status: read().profile_status, seen: read().last_seen_at, verified: read().verified_at }, { status: "registered", seen: null, verified: null });
    sqlite.prepare("UPDATE browser_profiles SET status='paired' WHERE id='new'").run();
    sqlite.prepare("UPDATE bridge_credentials SET last_seen_at=CURRENT_TIMESTAMP WHERE profile_id='new'").run();
    sqlite.prepare("UPDATE account_browser_profiles SET verified_at=CURRENT_TIMESTAMP WHERE profile_id='new'").run();
    assert.ok(read().last_seen_at && read().verified_at && read().profile_status === "paired");
  } finally { sqlite.close(); }
});
