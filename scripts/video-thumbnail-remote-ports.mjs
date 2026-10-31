import { createRequire } from "node:module";

// Reuse the app's pinned signer. No new package or credential store is created.
const appRequire = createRequire(new URL("../cloudflare/thot-os-next/package.json", import.meta.url));
const { AwsClient } = appRequire("aws4fetch");

function fail(code) { throw new Error(code); }
function nonempty(value) { return typeof value === "string" && value.trim().length > 0; }
function encodeKey(key) {
  if (!nonempty(key) || key.includes("..") || key.startsWith("/")) fail("invalid_r2_key");
  return key.split("/").map(encodeURIComponent).join("/");
}
function etag(value) { return typeof value === "string" ? value.replace(/^"|"$/g, "") : null; }
async function fetchBounded(fetchImpl, request, signal) {
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return fetchImpl(new Request(request, { signal: combined }));
}

export function createRemoteD1Port({ accountId, databaseId, databaseName, token, fetchImpl = globalThis.fetch,
  apiBase = "https://api.cloudflare.com/client/v4" }) {
  if (![accountId, databaseId, databaseName, token].every(nonempty) || !apiBase.startsWith("https://")) fail("thumbnail_d1_config_invalid");
  const root = `${apiBase.replace(/\/$/, "")}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}`;
  let verified;
  async function request(path, body) {
    const response = await fetchBounded(fetchImpl, new Request(`${root}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    let payload;
    try { payload = await response.json(); } catch { fail("thumbnail_d1_response_invalid"); }
    if (!response.ok || payload?.success !== true || !Array.isArray(payload.errors) || payload.errors.length) fail("thumbnail_d1_request_failed");
    return payload.result;
  }
  async function verifyTarget() {
    if (!verified) verified = request("").then((result) => {
      if (!result || result.uuid !== databaseId || result.name !== databaseName) fail("thumbnail_d1_target_mismatch");
      return true;
    }).catch((error) => { verified = undefined; throw error; });
    return verified;
  }
  async function query(sql, params) {
    await verifyTarget();
    const result = await request("/query", { sql, params });
    if (!Array.isArray(result) || result.length !== 1 || result[0]?.success !== true
      || !result[0].meta) fail("thumbnail_d1_query_ambiguous");
    return result[0];
  }
  return Object.freeze({ verifyTarget,
    prepare(sql) {
      if (typeof sql !== "string" || !/^\s*SELECT\b/i.test(sql) || sql.includes(";")) fail("thumbnail_d1_sql_invalid");
      return { bind(...params) {
        if (!params.every((value) => typeof value === "string" || Number.isSafeInteger(value))) fail("thumbnail_d1_params_invalid");
        return {
          async first() { const result = await query(sql, params.map(String));
            if (!Array.isArray(result.results)) fail("thumbnail_d1_query_ambiguous");
            return result.results[0] ?? null; },
          async all() { const result = await query(sql, params.map(String));
            if (!Array.isArray(result.results)) fail("thumbnail_d1_query_ambiguous");
            return { results: result.results, meta: result.meta }; },
          async run() { fail("thumbnail_d1_read_only"); },
        };
      } };
    },
  });
}

export function createRemotePosterCommitPort({ endpoint, serviceToken, accessClientId, accessClientSecret,
  fetchImpl = globalThis.fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.pathname !== "/api/internal/video-thumbnail/commit"
    || ![serviceToken, accessClientId, accessClientSecret].every(nonempty)) fail("thumbnail_commit_config_invalid");
  return Object.freeze({
    async commit(source, posterKey) {
      const payload = { creatorId: source.creatorId, assetId: source.assetId,
        source: { key: source.sourceKey, revision: source.sourceRevision, version: source.version,
          etag: source.etag, bytes: source.bytes, codec: source.codec }, posterKey };
      const request = new Request(url, { method: "POST", redirect: "manual", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${serviceToken}`,
        "x-thot-os-service-capability": "library.thumbnail.commit",
        "CF-Access-Client-Id": accessClientId, "CF-Access-Client-Secret": accessClientSecret,
      }, body: JSON.stringify(payload) });
      const response = await fetchBounded(fetchImpl, request);
      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        if (body?.error === "poster_already_selected" || body?.error === "source_changed") return false;
      }
      if (!response.ok) fail("thumbnail_commit_failed");
      const body = await response.json().catch(() => null);
      if (body?.ok !== true || !["committed", "already_committed"].includes(body.status)) fail("thumbnail_commit_response_invalid");
      return true;
    },
  });
}

export function createRemoteR2Port({ accountId, bucket, accessKeyId, secretAccessKey,
  fetchImpl = globalThis.fetch, endpoint = `https://${accountId}.r2.cloudflarestorage.com` }) {
  if (![accountId, bucket, accessKeyId, secretAccessKey].every(nonempty)
    || !/^https:\/\/[^/]+$/.test(endpoint) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) fail("thumbnail_r2_config_invalid");
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const url = (key) => `${endpoint}/${bucket}/${encodeKey(key)}`;
  async function signed(method, key, { headers = {}, body, signal } = {}) {
    const request = new Request(url(key), { method, headers, ...(body ? { body } : {}) });
    const signedRequest = await signer.sign(request);
    return fetchBounded(fetchImpl, signedRequest, signal);
  }
  function metadata(key, response) {
    const size = Number(response.headers.get("content-length"));
    const customMetadata = Object.fromEntries([...response.headers.entries()]
      .filter(([name]) => name.startsWith("x-amz-meta-"))
      .map(([name, value]) => [name.slice("x-amz-meta-".length), value]));
    return { key, version: response.headers.get("x-amz-version-id"), etag: etag(response.headers.get("etag")),
      size, customMetadata };
  }
  return Object.freeze({
    async head(key, { signal } = {}) {
      const response = await signed("HEAD", key, { signal });
      if (response.status === 404) return null;
      if (!response.ok) fail("thumbnail_r2_head_failed");
      return metadata(key, response);
    },
    async get(key, { onlyIf, signal } = {}) {
      const expected = onlyIf?.etagMatches;
      const response = await signed("GET", key, { headers: expected ? { "If-Match": `"${expected}"` } : {}, signal });
      if (response.status === 404 || response.status === 412) return null;
      if (!response.ok || !response.body) fail("thumbnail_r2_get_failed");
      return { ...metadata(key, response), body: response.body };
    },
    async put(key, bytes, { httpMetadata = {}, customMetadata = {} } = {}) {
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 12 * 1024 ** 2) fail("thumbnail_r2_put_invalid");
      const headers = { "Content-Type": httpMetadata.contentType ?? "image/jpeg",
        "Cache-Control": httpMetadata.cacheControl ?? "private, no-store", "If-None-Match": "*",
        ...Object.fromEntries(Object.entries(customMetadata).map(([name, value]) => [`x-amz-meta-${name}`, value])) };
      const response = await signed("PUT", key, { headers, body: bytes });
      if (response.status === 412) fail("thumbnail_r2_write_race");
      if (!response.ok) fail("thumbnail_r2_put_failed");
      return { key, etag: etag(response.headers.get("etag")) };
    },
  });
}
