import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createRemoteD1Port, createRemoteR2Port, createRemotePosterCommitPort } from "../scripts/video-thumbnail-remote-ports.mjs";

test("remote D1 port verifies the exact database and permits only read queries", async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE assets(id TEXT PRIMARY KEY,preview_r2_key TEXT); INSERT INTO assets VALUES ('asset-one',NULL)");
  const calls = [];
  const port = createRemoteD1Port({ accountId: "account-test", databaseId: "db-test", databaseName: "thot-os-staging",
    token: "synthetic-d1-token", apiBase: "https://d1.invalid/client/v4", fetchImpl: async (request) => {
      calls.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") });
      if (request.method === "GET") return Response.json({ success: true, errors: [], result: { uuid: "db-test", name: "thot-os-staging" } });
      const { sql, params } = await request.json();
      if (/^SELECT/i.test(sql)) return Response.json({ success: true, errors: [], result: [{ success: true,
        results: sqlite.prepare(sql).all(...params), meta: { changes: 0, changed_db: false } }] });
      const outcome = sqlite.prepare(sql).run(...params);
      return Response.json({ success: true, errors: [], result: [{ success: true,
        results: [], meta: { changes: outcome.changes, changed_db: outcome.changes > 0 } }] });
    } });
  try {
    assert.equal((await port.prepare("SELECT id FROM assets WHERE id=?").bind("asset-one").first()).id, "asset-one");
    assert.equal((await port.prepare("SELECT preview_r2_key FROM assets WHERE id=?").bind("asset-one").first()).preview_r2_key, null);
    assert.throws(() => port.prepare("UPDATE assets SET preview_r2_key='poster'"), /thumbnail_d1_sql_invalid/);
    assert.equal(calls.filter((call) => call.path.endsWith("/db-test")).length, 1);
    assert.ok(calls.every((call) => call.authorization === "Bearer synthetic-d1-token"));
  } finally { sqlite.close(); }
});

test("remote D1 port fails closed on wrong target or ambiguous response", async () => {
  const wrong = createRemoteD1Port({ accountId: "account-test", databaseId: "db-test", databaseName: "thot-os-staging",
    token: "synthetic", apiBase: "https://d1.invalid/client/v4", fetchImpl: async () => Response.json({
      success: true, errors: [], result: { uuid: "other-db", name: "thot-os-staging" },
    }) });
  await assert.rejects(wrong.prepare("SELECT 1").bind().first(), /thumbnail_d1_target_mismatch/);
});

test("read-only Mind D1 port refuses writes before sending a query", async () => {
  let queries = 0;
  const port = createRemoteD1Port({ accountId: "account-test", databaseId: "db-test", databaseName: "thot-os-staging",
    token: "synthetic", apiBase: "https://d1.invalid/client/v4",
    fetchImpl: async (request) => {
      if (request.method === "POST") queries++;
      return Response.json({ success: true, errors: [], result: { uuid: "db-test", name: "thot-os-staging" } });
    } });
  await assert.rejects(port.prepare("SELECT id FROM assets WHERE id=?").bind("asset-one").run(),
    /thumbnail_d1_read_only/);
  assert.equal(queries, 0);
});

test("narrow poster commit sends service and Access credentials only to the pinned HTTPS endpoint", async () => {
  const source = { creatorId: "creator-one", assetId: "11111111-1111-4111-8111-111111111111",
    sourceKey: "originals/synthetic", sourceRevision: "native:test", version: "v1", etag: "e1", bytes: 123, codec: "h265" };
  let calls = 0;
  const options = { endpoint: "https://staging.invalid/api/internal/video-thumbnail/commit",
    serviceToken: "synthetic-service", accessClientId: "synthetic-access-id", accessClientSecret: "synthetic-access-secret" };
  const port = createRemotePosterCommitPort({ ...options, fetchImpl: async (request) => {
    calls++;
    assert.equal(new URL(request.url).origin, "https://staging.invalid");
    assert.equal(request.redirect, "manual");
    assert.equal(request.headers.get("authorization"), "Bearer synthetic-service");
    assert.equal(request.headers.get("cf-access-client-id"), "synthetic-access-id");
    assert.equal(request.headers.get("cf-access-client-secret"), "synthetic-access-secret");
    assert.equal(request.headers.get("x-thot-os-service-capability"), "library.thumbnail.commit");
    assert.deepEqual(await request.json(), { creatorId: "creator-one", assetId: source.assetId,
      source: { key: source.sourceKey, revision: source.sourceRevision, version: "v1", etag: "e1", bytes: 123, codec: "h265" },
      contentType: "image/jpeg", posterBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64") });
    return Response.json({ ok: true, status: "committed" });
  } });
  assert.equal(await port.commit(source, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), true);
  assert.equal(calls, 1);
  assert.throws(() => createRemotePosterCommitPort({ ...options, endpoint: "http://staging.invalid/api/internal/video-thumbnail/commit" }),
    /thumbnail_commit_config_invalid/);
  assert.throws(() => createRemotePosterCommitPort({ ...options, endpoint: "https://staging.invalid/other" }),
    /thumbnail_commit_config_invalid/);
});

test("commit redirect, manual-wins conflict and ambiguous failures are handled without retry", async () => {
  const source = { creatorId: "creator-one", assetId: "11111111-1111-4111-8111-111111111111",
    sourceKey: "originals/synthetic", sourceRevision: "native:test", version: "v1", etag: "e1", bytes: 123, codec: "h265" };
  const options = { endpoint: "https://staging.invalid/api/internal/video-thumbnail/commit",
    serviceToken: "synthetic-service", accessClientId: "synthetic-access-id", accessClientSecret: "synthetic-access-secret" };
  let calls = 0;
  const manual = createRemotePosterCommitPort({ ...options, fetchImpl: async () => {
    calls++; return Response.json({ ok: false, error: "poster_already_selected" }, { status: 409 });
  } });
  assert.equal(await manual.commit(source, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), false);
  const redirected = createRemotePosterCommitPort({ ...options, fetchImpl: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: "https://other.invalid/" } });
  } });
  await assert.rejects(redirected.commit(source, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), /thumbnail_commit_failed/);
  const uncertain = createRemotePosterCommitPort({ ...options, fetchImpl: async () => {
    calls++; return Response.json({ ok: false, error: "commit_uncertain" }, { status: 503 });
  } });
  await assert.rejects(uncertain.commit(source, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), /thumbnail_commit_failed/);
  assert.equal(calls, 3);
});

test("remote R2 port signs mocked Head/Get/Put, requires version and keeps the source unmodified", async () => {
  const source = new Uint8Array([1, 2, 3, 4]);
  const calls = [];
  const fetchImpl = async (request) => {
    calls.push({ method: request.method, path: new URL(request.url).pathname,
      signed: Boolean(request.headers.get("authorization")), ifMatch: request.headers.get("if-match"),
      ifNoneMatch: request.headers.get("if-none-match") });
    const path = new URL(request.url).pathname;
    if (path === "/source-bucket/originals/v1/test" && request.method === "HEAD") return new Response(null, {
      headers: { "content-length": "4", etag: '"source-etag"', "x-amz-version-id": "source-version" },
    });
    if (path === "/source-bucket/originals/v1/test" && request.method === "GET") return new Response(source, {
      headers: { "content-length": "4", etag: '"source-etag"', "x-amz-version-id": "source-version" },
    });
    if (path === "/poster-bucket/creators/test/poster.jpg" && request.method === "HEAD") return new Response(null, { status: 404 });
    if (path === "/poster-bucket/creators/test/poster.jpg" && request.method === "PUT") return new Response(null, { status: 200,
      headers: { etag: '"poster-etag"' } });
    return new Response(null, { status: 404 });
  };
  const common = { accountId: "account-test", accessKeyId: "synthetic-key", secretAccessKey: "synthetic-secret",
    endpoint: "https://r2.invalid", fetchImpl };
  const originals = createRemoteR2Port({ ...common, bucket: "source-bucket" });
  const posters = createRemoteR2Port({ ...common, bucket: "poster-bucket" });
  assert.deepEqual(await originals.head("originals/v1/test"), {
    key: "originals/v1/test", version: "source-version", etag: "source-etag", size: 4, customMetadata: {},
  });
  const read = await originals.get("originals/v1/test", { onlyIf: { etagMatches: "source-etag" } });
  const chunks = [];
  for await (const chunk of read.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(source));
  assert.equal((await posters.put("creators/test/poster.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    customMetadata: { creator_id: "test", asset_id: "asset" } })).etag, "poster-etag");
  assert.ok(calls.every((call) => call.signed));
  assert.equal(calls.find((call) => call.method === "GET").ifMatch, '"source-etag"');
  assert.equal(calls.find((call) => call.method === "PUT").ifNoneMatch, "*");
  assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
});

test("remote R2 port reports absent version for the adapter to reject and never retries failed conditional writes", async () => {
  let puts = 0;
  const port = createRemoteR2Port({ accountId: "account-test", bucket: "source-bucket",
    accessKeyId: "synthetic-key", secretAccessKey: "synthetic-secret", endpoint: "https://r2.invalid",
    fetchImpl: async (request) => request.method === "HEAD"
      ? new Response(null, { headers: { etag: '"etag"', "content-length": "5" } })
      : (puts++, new Response(null, { status: 412 })) });
  assert.equal((await port.head("originals/v1/test")).version, null);
  await assert.rejects(port.put("poster.jpg", new Uint8Array([1])), /thumbnail_r2_write_race/);
  assert.equal(puts, 1);
});
