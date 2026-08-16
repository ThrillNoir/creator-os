const DEFAULT_API_BASE = "https://api.cloudflare.com/client/v4";
const READ_ONLY_START = /^(?:SELECT|EXPLAIN|WITH|PRAGMA)\b/i;
const READ_ONLY_PRAGMA = /^PRAGMA\s+(?:quick_check|foreign_key_check)\s*$/i;
const WRITE_OR_DDL = /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

export class StructuredD1ReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StructuredD1ReadError";
    this.code = code;
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new StructuredD1ReadError("INVALID_TARGET", `${field} must be a non-empty string.`);
  return value;
}

export function assertD1Target(target) {
  if (!record(target)) throw new StructuredD1ReadError("INVALID_TARGET", "D1 target must be an object.");
  return {
    accountId: nonEmptyString(target.accountId, "D1 account ID"),
    databaseId: nonEmptyString(target.databaseId, "D1 database ID"),
    databaseName: nonEmptyString(target.databaseName, "D1 database name"),
  };
}

export function assertReadOnlySql(sql) {
  if (typeof sql !== "string" || sql.trim() === "") throw new StructuredD1ReadError("INVALID_READ_ONLY_SQL", "Structured D1 reads require one non-empty SQL statement.");
  const statement = sql.trim().replace(/;$/, "").trim();
  if (statement === "" || statement.includes(";")) throw new StructuredD1ReadError("INVALID_READ_ONLY_SQL", "Structured D1 reads permit exactly one SQL statement.");
  if (!READ_ONLY_START.test(statement) || WRITE_OR_DDL.test(statement)) throw new StructuredD1ReadError("INVALID_READ_ONLY_SQL", "Structured D1 reads permit only SELECT, EXPLAIN, non-mutating WITH, or allow-listed integrity PRAGMA statements.");
  if (/^PRAGMA\b/i.test(statement) && !READ_ONLY_PRAGMA.test(statement)) throw new StructuredD1ReadError("INVALID_READ_ONLY_SQL", "Structured D1 reads permit only PRAGMA quick_check or PRAGMA foreign_key_check.");
  return statement;
}

function errorCodes(payload) {
  if (!Array.isArray(payload?.errors)) return [];
  return payload.errors.map((entry) => Number.isInteger(entry?.code) ? entry.code : "unknown");
}

async function parseApiResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new StructuredD1ReadError("MALFORMED_API_RESPONSE", "Cloudflare D1 returned a non-JSON response.");
  }
  if (!record(payload) || typeof payload.success !== "boolean" || !Array.isArray(payload.errors) || !Array.isArray(payload.messages)) {
    throw new StructuredD1ReadError("MALFORMED_API_RESPONSE", "Cloudflare D1 returned an ambiguous response envelope.");
  }
  if (!response.ok || payload.success !== true || payload.errors.length !== 0) {
    const status = Number.isInteger(response.status) ? response.status : "unknown";
    const codes = errorCodes(payload).join(",") || "none";
    throw new StructuredD1ReadError("D1_API_REJECTED", `Cloudflare D1 read was rejected (HTTP ${status}; API codes ${codes}).`);
  }
  return payload;
}

function validateQueryResult(payload) {
  if (!Array.isArray(payload.result) || payload.result.length !== 1) throw new StructuredD1ReadError("MALFORMED_QUERY_RESPONSE", "Cloudflare D1 returned an ambiguous query result count.");
  const result = payload.result[0];
  if (!record(result) || result.success !== true || !Array.isArray(result.results) || !record(result.meta)) {
    throw new StructuredD1ReadError("MALFORMED_QUERY_RESPONSE", "Cloudflare D1 returned an invalid read-only query envelope.");
  }
  if (result.meta.changed_db !== false || result.meta.rows_written !== 0 || result.meta.changes !== 0) {
    throw new StructuredD1ReadError("READ_ONLY_VIOLATION", "Cloudflare D1 reported that a structured read changed the database.");
  }
  if (!result.results.every(record)) throw new StructuredD1ReadError("MALFORMED_QUERY_RESPONSE", "Cloudflare D1 returned a malformed result row.");
  return { rows: result.results, meta: result.meta };
}

export function canonicalMigrationNames(rows) {
  if (!Array.isArray(rows) || !rows.every((row, index) => Number.isInteger(row.id) && row.id > 0 && (index === 0 || row.id > rows[index - 1].id) && typeof row.name === "string" && row.name.length > 0 && typeof row.applied_at === "string" && row.applied_at.length > 0)) {
    throw new StructuredD1ReadError("MALFORMED_MIGRATION_HISTORY", "Canonical D1 migration history is malformed.");
  }
  return rows.map((row) => row.name);
}

/**
 * Create the repository-owned, read-only administrative D1 client.
 *
 * It intentionally consumes the existing CLOUDFLARE_API_TOKEN environment
 * contract used by the staging-resource tooling. No token is persisted,
 * written to receipts, or included in diagnostics.
 */
export function createStructuredD1ReadClient({ token = process.env.CLOUDFLARE_API_TOKEN, fetchImpl = globalThis.fetch, apiBase = DEFAULT_API_BASE } = {}) {
  if (typeof token !== "string" || token.trim() === "") throw new StructuredD1ReadError("AUTH_UNAVAILABLE", "Structured D1 verification requires CLOUDFLARE_API_TOKEN.");
  if (typeof fetchImpl !== "function") throw new StructuredD1ReadError("FETCH_UNAVAILABLE", "Structured D1 verification requires a fetch implementation.");
  if (typeof apiBase !== "string" || !apiBase.startsWith("https://")) throw new StructuredD1ReadError("INVALID_API_BASE", "Structured D1 verification requires an HTTPS API base URL.");
  const base = apiBase.replace(/\/$/, "");

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new StructuredD1ReadError("TRANSPORT_UNAVAILABLE", "Cloudflare D1 structured read could not reach the API.");
    }
    return parseApiResponse(response);
  }

  async function verifyTarget(input) {
    const target = assertD1Target(input);
    const payload = await request(`/accounts/${encodeURIComponent(target.accountId)}/d1/database/${encodeURIComponent(target.databaseId)}`);
    if (!record(payload.result) || payload.result.uuid !== target.databaseId || payload.result.name !== target.databaseName) {
      throw new StructuredD1ReadError("TARGET_IDENTITY_MISMATCH", "Cloudflare D1 target identity did not match the reviewed account/database target.");
    }
    return { accountId: target.accountId, databaseId: target.databaseId, databaseName: target.databaseName };
  }

  async function queryReadOnly(input, sql, params = []) {
    const target = await verifyTarget(input);
    const statement = assertReadOnlySql(sql);
    if (!Array.isArray(params) || !params.every((value) => typeof value === "string")) throw new StructuredD1ReadError("INVALID_QUERY_PARAMS", "Structured D1 read parameters must be string values.");
    const payload = await request(`/accounts/${encodeURIComponent(target.accountId)}/d1/database/${encodeURIComponent(target.databaseId)}/query`, { method: "POST", body: { sql: statement, params } });
    return validateQueryResult(payload);
  }

  async function readMigrationHistory(input) {
    const { rows } = await queryReadOnly(input, "SELECT id, name, applied_at FROM d1_migrations ORDER BY id");
    return canonicalMigrationNames(rows);
  }

  return Object.freeze({ verifyTarget, queryReadOnly, readMigrationHistory });
}

/**
 * A conservative building block for a reviewed migration-specific schema
 * verifier. Callers must supply the expected object names from their approved
 * migration; this helper does not infer them from untrusted SQL text.
 */
export async function inspectSchemaObjects(client, target, names) {
  if (!Array.isArray(names) || names.length === 0 || !names.every((name) => typeof name === "string" && name.length > 0)) {
    throw new StructuredD1ReadError("INVALID_SCHEMA_CHECK", "Schema inspection requires explicit expected object names.");
  }
  const placeholders = names.map(() => "?").join(", ");
  return client.queryReadOnly(target, `SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name IN (${placeholders}) ORDER BY type, name`, names);
}

/**
 * Read-only integrity checks for a migration-specific uncertain-outcome
 * verifier. They are intentionally not invoked automatically: a passing
 * integrity check cannot by itself prove a particular migration had no effect.
 */
export async function checkD1Integrity(client, target) {
  const quickCheck = await client.queryReadOnly(target, "PRAGMA quick_check");
  const foreignKeyCheck = await client.queryReadOnly(target, "PRAGMA foreign_key_check");
  const quickCheckValues = quickCheck.rows.map((row) => row.quick_check);
  if (quickCheckValues.length !== 1 || quickCheckValues[0] !== "ok" || foreignKeyCheck.rows.length !== 0) {
    throw new StructuredD1ReadError("INTEGRITY_CHECK_FAILED", "Cloudflare D1 integrity verification did not return a clean result.");
  }
  return Object.freeze({ quickCheck: "ok", foreignKeyViolations: 0 });
}
