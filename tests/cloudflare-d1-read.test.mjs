import assert from "node:assert/strict";
import test from "node:test";
import { StructuredD1ReadError, assertReadOnlySql, canonicalMigrationNames, checkD1Integrity, createStructuredD1ReadClient, inspectSchemaObjects } from "../scripts/cloudflare-d1-read.mjs";

const target = { accountId: "account-id", databaseId: "database-id", databaseName: "thot-os-staging" };
const envelope = (result) => ({ success: true, errors: [], messages: [], result });
const identity = () => new Response(JSON.stringify(envelope({ uuid: target.databaseId, name: target.databaseName })), { status: 200 });
const query = (rows, meta = { changed_db: false, rows_written: 0, changes: 0 }) => new Response(JSON.stringify(envelope([{ success: true, results: rows, meta }])), { status: 200 });

test("structured D1 client verifies identity and returns canonical migration names from the REST API", async () => {
  const requests = [];
  const client = createStructuredD1ReadClient({
    token: "test-token",
    apiBase: "https://cloudflare.example.test/client/v4",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return requests.length % 2 === 1 ? identity() : query([
        { id: 1, name: "0001_first.sql", applied_at: "2026-08-16T00:00:00.000Z" },
        { id: 28, name: "0028_service_auth_principals.sql", applied_at: "2026-08-16T00:01:00.000Z" },
      ]);
    },
  });
  assert.deepEqual(await client.readMigrationHistory(target), ["0001_first.sql", "0028_service_auth_principals.sql"]);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/accounts\/account-id\/d1\/database\/database-id$/);
  assert.equal(requests[1].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].init.body), { sql: "SELECT id, name, applied_at FROM d1_migrations ORDER BY id", params: [] });
  assert.equal(requests.every((request) => request.init.headers.Authorization === "Bearer test-token"), true);
});

test("structured D1 client rejects credentials, malformed envelopes, identity drift, and changed_db results without leaking details", async () => {
  assert.throws(() => createStructuredD1ReadClient({ token: "", fetchImpl: fetch }), (error) => error instanceof StructuredD1ReadError && error.code === "AUTH_UNAVAILABLE");
  const malformed = createStructuredD1ReadClient({ token: "test", fetchImpl: async () => new Response("not json", { status: 200 }) });
  await assert.rejects(() => malformed.verifyTarget(target), /non-JSON/);
  const wrongIdentity = createStructuredD1ReadClient({ token: "test", fetchImpl: async () => new Response(JSON.stringify(envelope({ uuid: "wrong", name: target.databaseName })), { status: 200 }) });
  await assert.rejects(() => wrongIdentity.verifyTarget(target), /identity/);
  let requestCount = 0;
  const mutationReported = createStructuredD1ReadClient({ token: "test", fetchImpl: async () => (++requestCount === 1 ? identity() : query([], { changed_db: true, rows_written: 1, changes: 1 })) });
  await assert.rejects(() => mutationReported.queryReadOnly(target, "SELECT 1"), /changed the database/);
});

test("read-only SQL guard blocks mutations, transaction controls, and ambiguous multi-statements", () => {
  for (const statement of ["INSERT INTO things VALUES (1)", "WITH x AS (DELETE FROM things RETURNING id) SELECT * FROM x", "SELECT 1; DELETE FROM things", "PRAGMA user_version", "SELECT 'DROP TABLE' AS safe_but_conservative"]) {
    assert.throws(() => assertReadOnlySql(statement), /read/i);
  }
  assert.equal(assertReadOnlySql("  WITH selected AS (SELECT 1 AS value) SELECT value FROM selected  "), "WITH selected AS (SELECT 1 AS value) SELECT value FROM selected");
  assert.equal(assertReadOnlySql("PRAGMA quick_check"), "PRAGMA quick_check");
  assert.equal(assertReadOnlySql("PRAGMA foreign_key_check"), "PRAGMA foreign_key_check");
});

test("schema inspection is parameterized and migration history must be canonical", async () => {
  const calls = [];
  const client = { queryReadOnly: async (...args) => { calls.push(args); return { rows: [] }; } };
  await inspectSchemaObjects(client, target, ["service_principals", "service_auth_activation_runs"]);
  assert.match(calls[0][1], /name IN \(\?, \?\)/);
  assert.deepEqual(calls[0][2], ["service_principals", "service_auth_activation_runs"]);
  assert.deepEqual(canonicalMigrationNames([{ id: 1, name: "0001_first.sql", applied_at: "now" }]), ["0001_first.sql"]);
  assert.throws(() => canonicalMigrationNames([{ id: 2, name: "0002.sql", applied_at: "now" }, { id: 1, name: "0001.sql", applied_at: "now" }]), /malformed/);
});

test("integrity checks are read-only building blocks and fail closed on any violation", async () => {
  const calls = [];
  const clean = { queryReadOnly: async (_target, statement) => { calls.push(statement); return statement === "PRAGMA quick_check" ? { rows: [{ quick_check: "ok" }] } : { rows: [] }; } };
  assert.deepEqual(await checkD1Integrity(clean, target), { quickCheck: "ok", foreignKeyViolations: 0 });
  assert.deepEqual(calls, ["PRAGMA quick_check", "PRAGMA foreign_key_check"]);
  await assert.rejects(() => checkD1Integrity({ queryReadOnly: async () => ({ rows: [{ quick_check: "not ok" }] }) }, target), /integrity/);
});
