import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { ensureConnectorServiceGrants } from "../src/lib/connector-service-grants.ts";

test("connection setup provisions only the selected creator and connector, without reviving revoked access", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`CREATE TABLE creators (id TEXT PRIMARY KEY);
      INSERT INTO creators VALUES ('new-creator'),('other-creator');
      CREATE TABLE identity_audit_events (id TEXT,creator_id TEXT,actor_email TEXT,actor_role TEXT,event_type TEXT,subject TEXT,detail TEXT);`);
    sqlite.exec(readFileSync(new URL("../../thot-os-app/migrations/0029_service_principal_capabilities.sql", import.meta.url), "utf8"));
    sqlite.exec(`INSERT INTO service_principals (id,principal_name) VALUES ('ig','thot-os-web-instagram'),('tg','thot-os-web-telegram');
      INSERT INTO service_principal_credentials (id,service_principal_id,token_hash) VALUES ('ig-key','ig','test-ig-hash'),('tg-key','tg','test-tg-hash');`);
    const DB = {
      prepare(sql) {
        return { bind(...params) {
          const statement = sqlite.prepare(sql);
          return {
            first: async () => statement.get(...params) ?? null,
            run: async () => ({ meta: { changes: statement.run(...params).changes } }),
          };
        } };
      },
      batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
    };
    const identity = { email: "creator@example.test", creator: { creator_id: "new-creator", role: "creator" } };
    await ensureConnectorServiceGrants(DB, identity, "instagram");
    await ensureConnectorServiceGrants(DB, identity, "instagram");
    const rows = sqlite.prepare("SELECT service_principal_id,creator_id,capability,status FROM service_principal_creator_grants").all();
    assert.equal(rows.length, 6);
    assert.ok(rows.every((row) => row.service_principal_id === "ig" && row.creator_id === "new-creator" && row.capability.startsWith("instagram.") && row.status === "active"));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM identity_audit_events").get().n, 1);
    await assert.rejects(ensureConnectorServiceGrants(DB, { ...identity, creator: { ...identity.creator, role: "viewer" } }, "instagram"), /not authorised/);
    await assert.rejects(ensureConnectorServiceGrants(DB, identity, "telegram"), /not authorised/);
    await ensureConnectorServiceGrants(DB, { ...identity, creator: { ...identity.creator, role: "agency_admin" } }, "telegram");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM service_principal_creator_grants WHERE service_principal_id='tg' AND capability LIKE 'telegram.%'").get().n, 4);
    sqlite.exec("UPDATE service_principal_creator_grants SET status='revoked' WHERE capability='instagram.connection.manage'");
    await assert.rejects(ensureConnectorServiceGrants(DB, identity, "instagram"), /permissions are not active/);
    assert.equal(sqlite.prepare("SELECT status FROM service_principal_creator_grants WHERE capability='instagram.connection.manage'").get().status, "revoked");
    sqlite.exec("UPDATE service_principal_credentials SET expires_at='2000-01-01' WHERE service_principal_id='ig'");
    await assert.rejects(ensureConnectorServiceGrants(DB, { ...identity, creator: { ...identity.creator, creator_id: "other-creator" } }, "instagram"), /permissions are not active/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM service_principal_creator_grants WHERE creator_id='other-creator'").get().n, 0);
  } finally { sqlite.close(); }
});
