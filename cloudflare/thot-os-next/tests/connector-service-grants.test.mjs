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
    sqlite.exec(`INSERT INTO service_principals (id,principal_name) VALUES ('ig','thot-os-web-instagram'),('tg','thot-os-web-telegram'),('reddit','thot-os-web-reddit');
      INSERT INTO service_principal_credentials (id,service_principal_id,token_hash) VALUES ('ig-key','ig','test-ig-hash'),('tg-key','tg','test-tg-hash'),('reddit-key','reddit','test-reddit-hash');`);
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
    await ensureConnectorServiceGrants(DB, identity, "reddit");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM service_principal_creator_grants WHERE service_principal_id='reddit' AND creator_id='new-creator'").get().n, 4);
    sqlite.exec("UPDATE service_principal_credentials SET expires_at='2000-01-01' WHERE service_principal_id='ig'");
    await assert.rejects(ensureConnectorServiceGrants(DB, identity, "instagram"), /permissions are not active/);
    sqlite.exec("UPDATE service_principal_credentials SET expires_at=NULL WHERE service_principal_id='ig'");
    await ensureConnectorServiceGrants(DB, identity, "instagram");
    sqlite.exec("UPDATE service_principal_creator_grants SET status='revoked' WHERE capability='instagram.connection.manage'");
    await assert.rejects(ensureConnectorServiceGrants(DB, identity, "instagram"), /permissions are not active/);
    assert.equal(sqlite.prepare("SELECT status FROM service_principal_creator_grants WHERE capability='instagram.connection.manage'").get().status, "revoked");
    sqlite.exec("UPDATE service_principal_credentials SET expires_at='2000-01-01' WHERE service_principal_id='ig'");
    await assert.rejects(ensureConnectorServiceGrants(DB, { ...identity, creator: { ...identity.creator, creator_id: "other-creator" } }, "instagram"), /permissions are not active/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM service_principal_creator_grants WHERE creator_id='other-creator'").get().n, 0);
  } finally { sqlite.close(); }
});

test("Instagram validation failure updates only the selected thread connection", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`CREATE TABLE messaging_connections (id TEXT PRIMARY KEY,creator_id TEXT,platform TEXT,outbound_validated INTEGER,last_error TEXT);
      CREATE TABLE message_threads (id TEXT PRIMARY KEY,creator_id TEXT,connection_id TEXT);`);
    sqlite.exec(`INSERT INTO messaging_connections VALUES
      ('ig-one','creator-a','instagram',1,NULL),('ig-two','creator-a','instagram',1,NULL),('ig-other','creator-b','instagram',1,NULL);
      INSERT INTO message_threads VALUES ('thread-two','creator-a','ig-two');`);
    const thread = sqlite.prepare(`SELECT t.connection_id
      FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
      WHERE t.id=? AND t.creator_id=? AND c.platform='instagram'`).get("thread-two", "creator-a");
    assert.equal(thread.connection_id, "ig-two");
    sqlite.prepare("UPDATE messaging_connections SET outbound_validated=0,last_error=? WHERE id=? AND creator_id=? AND platform='instagram'")
      .run("recipient validation failed", thread.connection_id, "creator-a");
    assert.deepEqual(sqlite.prepare("SELECT outbound_validated,last_error FROM messaging_connections WHERE id='ig-two'").get(), { outbound_validated: 0, last_error: "recipient validation failed" });
    assert.deepEqual(sqlite.prepare("SELECT outbound_validated,last_error FROM messaging_connections WHERE id='ig-one'").get(), { outbound_validated: 1, last_error: null });
    assert.deepEqual(sqlite.prepare("SELECT outbound_validated,last_error FROM messaging_connections WHERE id='ig-other'").get(), { outbound_validated: 1, last_error: null });
  } finally { sqlite.close(); }
});
