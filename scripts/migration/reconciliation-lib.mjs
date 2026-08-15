import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import Database from "better-sqlite3";
import { projectRoot, readDeploymentRegistry, readJsoncFile } from "../deployment-preflight.mjs";

export const MIGRATION_DISABLED_MESSAGE = "Migration apply is disabled by the Phase 1C.6 safety contract.";
const creatorIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const remoteD1Name = "thot-os-staging";
const migrationDirectory = path.join(projectRoot, "cloudflare/thot-os-app/migrations");
const safetyContractPath = path.join(projectRoot, "config/migration/safety-contract.json");

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashFile(filePath) {
  return sha256(readFileSync(filePath));
}

function fail(message) {
  throw new Error(message);
}

export function requireAbsoluteSnapshot(filePath, label) {
  if (!filePath || !path.isAbsolute(filePath)) fail(`${label} must be an absolute snapshot path.`);
  if (!existsSync(filePath)) fail(`${label} does not exist.`);
  if (lstatSync(filePath).isSymbolicLink()) fail(`${label} must not be a symlink.`);
  const resolved = realpathSync(filePath);
  if (resolved.includes(`${path.sep}.creator-os${path.sep}`)) fail(`${label} must be a protected snapshot, not a live .creator-os database.`);
  return resolved;
}

export function openReadOnlySnapshot(filePath, label) {
  const resolved = requireAbsoluteSnapshot(filePath, label);
  const before = hashFile(resolved);
  const db = new Database(resolved, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    db.close();
    fail(`${label} integrity check failed.`);
  }
  return { db, path: resolved, sha256: before, integrity };
}

export function closeStableSnapshot(snapshot, label) {
  snapshot.db.close();
  if (hashFile(snapshot.path) !== snapshot.sha256) fail(`${label} changed while reconciliation was running.`);
}

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => name));
}

function rows(db, sql, value) {
  return db.prepare(sql).all(value);
}

function recordReference(domain, creatorId, key) {
  return sha256(`${domain}:${creatorId}:${key}`).slice(0, 24);
}

function classifyByKey({ domain, creatorId, sourceRows, targetRows, key, equivalent, targetAuthoritativeFields = [] }) {
  const targetByKey = new Map(targetRows.map((row) => [key(row), row]));
  const sourceKeys = new Set();
  const records = [];
  for (const source of sourceRows) {
    const identity = key(source);
    sourceKeys.add(identity);
    const target = targetByKey.get(identity);
    const ref = recordReference(domain, creatorId, identity);
    if (!target) records.push({ ref, classification: "SOURCE_ONLY", key: sha256(identity).slice(0, 16) });
    else if (equivalent(source, target)) records.push({ ref, classification: "MATCH", key: sha256(identity).slice(0, 16) });
    else if (targetAuthoritativeFields.some((field) => target[field] != null && target[field] !== "")) {
      records.push({ ref, classification: "TARGET_AUTHORITATIVE", key: sha256(identity).slice(0, 16), reason: "target_protected_metadata_or_material_difference" });
    } else records.push({ ref, classification: "CONFLICT", key: sha256(identity).slice(0, 16), reason: "material_field_difference" });
  }
  for (const target of targetRows) {
    const identity = key(target);
    if (!sourceKeys.has(identity)) records.push({ ref: recordReference(domain, creatorId, identity), classification: "TARGET_ONLY", key: sha256(identity).slice(0, 16) });
  }
  return records.sort((a, b) => a.ref.localeCompare(b.ref));
}

const equalFields = (fields) => (source, target) => fields.every((field) => (source[field] ?? null) === (target[field] ?? null));

export function reconcileAssets(sourceDb, targetDb, creatorId) {
  const sourceRows = rows(sourceDb, "SELECT id,relative_path,basename,extension,bytes,modified_at,source_available,safety_level,workflow_status FROM assets WHERE creator_id=? ORDER BY relative_path", creatorId);
  const targetRows = rows(targetDb, "SELECT id,relative_path,basename,extension,bytes,modified_at,source_available,safety_level,workflow_status,preview_r2_key,media_r2_key,dropbox_revision FROM assets WHERE creator_id=? ORDER BY relative_path", creatorId);
  const records = classifyByKey({ domain: "assets", creatorId, sourceRows, targetRows, key: (row) => row.relative_path, equivalent: equalFields(["basename", "extension", "bytes", "source_available", "safety_level", "workflow_status"]), targetAuthoritativeFields: ["preview_r2_key", "media_r2_key", "dropbox_revision"] });
  const sourceByPath = new Map(sourceRows.map((row) => [row.relative_path, row]));
  const targetByPath = new Map(targetRows.map((row) => [row.relative_path, row]));
  for (const record of records.filter((record) => record.classification === "MATCH")) {
    const source = sourceByPath.get([...sourceByPath.keys()].find((key) => record.ref === recordReference("assets", creatorId, key)));
    const target = source && targetByPath.get(source.relative_path);
    if (source?.modified_at && target?.modified_at && source.modified_at !== target.modified_at) {
      if (target.modified_at > source.modified_at) {
        record.classification = "TARGET_AUTHORITATIVE";
        record.reason = "canonical_d1_modification_time_is_newer";
      } else {
        record.classification = "CONFLICT";
        record.reason = "source_modification_time_is_newer_but_timestamp_is_not_write_authority";
      }
    }
  }
  return records;
}

export function reconcileClassifications(sourceDb, targetDb, creatorId) {
  const sourceRows = rows(sourceDb, "SELECT asset_id,safety,is_teaser,is_multi,teaser_for_asset_id,notes FROM asset_classifications WHERE creator_id=? ORDER BY asset_id", creatorId);
  const targetRows = rows(targetDb, "SELECT asset_id,safety,is_teaser,is_multi,teaser_for_asset_id,notes FROM asset_classifications WHERE creator_id=? ORDER BY asset_id", creatorId);
  return classifyByKey({ domain: "classifications", creatorId, sourceRows, targetRows, key: (row) => row.asset_id, equivalent: equalFields(["safety", "is_teaser", "is_multi", "teaser_for_asset_id", "notes"]) });
}

export function reconcileDestinations(sourceDb, targetDb, creatorId) {
  const sourceRows = rows(sourceDb, "SELECT asset_id,destination FROM asset_destinations WHERE creator_id=? ORDER BY asset_id,destination", creatorId);
  const targetRows = rows(targetDb, "SELECT asset_id,destination FROM asset_destinations WHERE creator_id=? ORDER BY asset_id,destination", creatorId);
  return classifyByKey({ domain: "destinations", creatorId, sourceRows, targetRows, key: (row) => `${row.asset_id}:${row.destination}`, equivalent: () => true });
}

export function reconcileMessages(sourceDb, targetDb, creatorId) {
  const sourceRows = rows(sourceDb, "SELECT external_message_id FROM messages WHERE creator_id=? AND external_message_id IS NOT NULL AND external_message_id<>'' ORDER BY external_message_id", creatorId);
  const targetRows = rows(targetDb, "SELECT external_message_id FROM messages WHERE creator_id=? AND external_message_id IS NOT NULL AND external_message_id<>'' ORDER BY external_message_id", creatorId);
  const records = classifyByKey({ domain: "messages", creatorId, sourceRows, targetRows, key: (row) => row.external_message_id, equivalent: () => true });
  for (const record of records.filter((record) => record.classification === "SOURCE_ONLY")) {
    record.classification = "AMBIGUOUS";
    record.reason = "provider_message_matches_but_connection_mapping_is_not_approved";
  }
  const unkeyed = sourceDb.prepare("SELECT count(*) AS count FROM messages WHERE creator_id=? AND (external_message_id IS NULL OR external_message_id='')").get(creatorId).count;
  for (let index = 0; index < unkeyed; index += 1) records.push({ ref: recordReference("messages", creatorId, `unkeyed:${index}`), classification: "AMBIGUOUS", reason: "missing_provider_message_identity" });
  return records.sort((a, b) => a.ref.localeCompare(b.ref));
}

export function reconcileThreads(sourceDb, targetDb, creatorId) {
  const sourceRows = rows(sourceDb, "SELECT external_thread_id FROM message_threads WHERE creator_id=? AND external_thread_id IS NOT NULL AND external_thread_id<>'' ORDER BY external_thread_id", creatorId);
  const targetRows = rows(targetDb, "SELECT external_thread_id FROM message_threads WHERE creator_id=? AND external_thread_id IS NOT NULL AND external_thread_id<>'' ORDER BY external_thread_id", creatorId);
  const records = classifyByKey({ domain: "threads", creatorId, sourceRows, targetRows, key: (row) => row.external_thread_id, equivalent: () => true });
  for (const record of records.filter((record) => record.classification === "SOURCE_ONLY")) {
    record.classification = "AMBIGUOUS";
    record.reason = "provider_thread_matches_but_connection_mapping_is_not_approved";
  }
  return records;
}

export function reconcileMedia(sourceDb, targetDb, creatorId) {
  const sourceRows = rows(sourceDb, "SELECT relative_path,source_available FROM assets WHERE creator_id=? ORDER BY relative_path", creatorId);
  const targetRows = rows(targetDb, "SELECT relative_path,media_r2_key,preview_r2_key FROM assets WHERE creator_id=? ORDER BY relative_path", creatorId);
  const targetByPath = new Map(targetRows.map((row) => [row.relative_path, row]));
  const records = sourceRows.map((source) => {
    const target = targetByPath.get(source.relative_path);
    if (!source.source_available) return { ref: recordReference("media", creatorId, source.relative_path), classification: "MANUAL_REVIEW", reason: "SOURCE_MISSING", mediaAction: "SOURCE_MISSING" };
    if (!target) return { ref: recordReference("media", creatorId, source.relative_path), classification: "MANUAL_REVIEW", reason: "binary_upload_not_permitted_in_phase1c", mediaAction: "UPLOAD_REQUIRED" };
    return { ref: recordReference("media", creatorId, source.relative_path), classification: "MATCH", mediaAction: target.media_r2_key ? "R2_ALREADY_PRESENT" : "METADATA_ONLY" };
  });
  for (const target of targetRows.filter((row) => !sourceRows.some((source) => source.relative_path === row.relative_path))) records.push({ ref: recordReference("media", creatorId, target.relative_path), classification: "TARGET_ONLY", mediaAction: "METADATA_ONLY" });
  return records;
}

function classifiedCount(records) {
  return records.reduce((counts, record) => ({ ...counts, [record.classification]: (counts[record.classification] ?? 0) + 1 }), {});
}

function manualDomain(sourceDb, targetDb, creatorId, name, sourceTable, targetTable, classification, reason) {
  const sourceCount = sourceTable && tableNames(sourceDb).has(sourceTable) ? sourceDb.prepare(`SELECT count(*) AS count FROM ${sourceTable} WHERE creator_id=?`).get(creatorId).count : 0;
  const targetCount = targetTable && tableNames(targetDb).has(targetTable) ? targetDb.prepare(`SELECT count(*) AS count FROM ${targetTable} WHERE creator_id=?`).get(creatorId).count : 0;
  const records = [];
  for (let index = 0; index < sourceCount; index += 1) records.push({ ref: recordReference(name, creatorId, `source:${index}`), classification, reason });
  for (let index = 0; index < targetCount; index += 1) records.push({ ref: recordReference(name, creatorId, `target:${index}`), classification: "TARGET_ONLY", reason: "target_state_preserved" });
  return records;
}

export function reconcileCreator({ sourceDb, targetDb, creatorId }) {
  if (!creatorIdPattern.test(creatorId)) fail("Creator identifier is invalid.");
  const sourceCreator = sourceDb.prepare("SELECT id,slug FROM creators WHERE id=?").get(creatorId);
  const targetCreator = targetDb.prepare("SELECT id,slug FROM creators WHERE id=?").get(creatorId);
  if (!sourceCreator || !targetCreator || sourceCreator.slug !== targetCreator.slug) fail(`Creator mapping for ${creatorId} is not an exact source/target ID and slug match.`);
  const domains = {
    assets: reconcileAssets(sourceDb, targetDb, creatorId),
    classifications: reconcileClassifications(sourceDb, targetDb, creatorId),
    destinations: reconcileDestinations(sourceDb, targetDb, creatorId),
    messages: reconcileMessages(sourceDb, targetDb, creatorId),
    threads: reconcileThreads(sourceDb, targetDb, creatorId),
    media: reconcileMedia(sourceDb, targetDb, creatorId),
    people: manualDomain(sourceDb, targetDb, creatorId, "people", "people", "people", "MANUAL_REVIEW", "person_mapping_and_private_notes_require_review"),
    accounts: manualDomain(sourceDb, targetDb, creatorId, "accounts", "accounts", "operational_accounts", "MANUAL_REVIEW", "provider_identity_and_credentials_require_reconnect"),
    credentials: manualDomain(sourceDb, targetDb, creatorId, "credentials", "platform_connections", "provider_connections", "ARCHIVE_ONLY", "credential_material_is_explicitly_excluded"),
    publishing: manualDomain(sourceDb, targetDb, creatorId, "publishing", "publication_jobs", "social_posts", "MANUAL_REVIEW", "publication_history_requires_transform_and_provenance"),
    finance: manualDomain(sourceDb, targetDb, creatorId, "finance", "analytics_metrics", "finance_daily_metrics", "MANUAL_REVIEW", "financial_import_identity_and_minor_units_are_not_equivalent"),
    memory: manualDomain(sourceDb, targetDb, creatorId, "memory", "creator_voice_profiles", null, "ARCHIVE_ONLY", "no_canonical_d1_memory_schema"),
    audit: manualDomain(sourceDb, targetDb, creatorId, "audit", "messaging_audit_events", "messaging_audit_events", "ARCHIVE_ONLY", "historical_audit_must_not_be_inserted_as_current_audit")
  };
  return Object.fromEntries(Object.entries(domains).map(([name, records]) => [name, { records, counts: classifiedCount(records) }]));
}

export function loadMapping(mappingPath = path.join(projectRoot, "config/migration/creator-mappings.json")) {
  const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
  if (mapping.schemaVersion !== 1 || !Array.isArray(mapping.mappings)) fail("Unsupported creator mapping file.");
  return mapping;
}

export function loadSafetyContract(contractPath = safetyContractPath) {
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  if (
    contract.schemaVersion !== 1 ||
    contract.phase !== "1C.6" ||
    contract.applyEnabled !== false ||
    contract.allowedEnvironment !== "staging" ||
    contract.targetMigrationBaseline?.requiredState !== "exact" ||
    typeof contract.targetMigrationBaseline?.lastApplied !== "string" ||
    typeof contract.pendingLocalMigration !== "string"
  ) fail("Unsupported or unsafe migration safety contract.");
  return contract;
}

export function requireApprovedMapping(mapping, creatorId) {
  const found = mapping.mappings.find((candidate) => candidate.sqliteCreatorId === creatorId && candidate.d1CreatorId === creatorId && candidate.confidence === "high" && candidate.approval === "identity_match_only");
  if (!found) fail(`Creator ${creatorId} has no approved exact identity mapping.`);
  return found;
}

export function validateTargetAuthority({ environment, registry = readDeploymentRegistry(), config = readJsoncFile(path.join(projectRoot, "cloudflare/thot-os-next/wrangler.jsonc")) }) {
  if (environment !== "staging") fail("Only the explicitly provisioned staging D1 target is permitted during Phase 1C.");
  const target = registry.environments?.staging;
  const registryD1 = target?.resources?.d1?.[remoteD1Name];
  const binding = (config.d1_databases ?? []).find((item) => item.database_name === remoteD1Name);
  if (!target?.provisioned || !registryD1?.id || !binding || binding.database_id !== registryD1.id || config.account_id !== target.accountId) {
    fail("Staging D1 registry/configuration identity mismatch.");
  }
  return { environment, databaseName: remoteD1Name, databaseId: registryD1.id, registryHash: sha256(stableJson(registry)) };
}

export function migrationState(db) {
  const tables = tableNames(db);
  if (!tables.has("d1_migrations")) fail("Target snapshot does not contain D1 migration state.");
  return db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map(({ name }) => name);
}

export function verifyExpectedMigrations(targetState, contract = loadSafetyContract()) {
  const expected = readdirSync(migrationDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const lastApplied = contract.targetMigrationBaseline.lastApplied;
  const lastAppliedIndex = expected.indexOf(lastApplied);
  if (lastAppliedIndex === -1 || expected[lastAppliedIndex + 1] !== contract.pendingLocalMigration) fail("Local migrations do not match the declared Phase 1C.6 target baseline.");
  const targetExpected = expected.slice(0, lastAppliedIndex + 1);
  if (stableJson(targetExpected) !== stableJson(targetState)) fail("Target D1 migration state does not exactly match the declared staging baseline.");
  return { local: expected, target: targetExpected, pendingLocalMigration: contract.pendingLocalMigration };
}

export function operationFor(record) {
  if (record.classification === "SOURCE_ONLY") return "INSERT";
  if (record.classification === "MATCH" || record.classification === "TARGET_ONLY" || record.classification === "TARGET_AUTHORITATIVE") return "SKIP";
  if (record.classification === "ARCHIVE_ONLY") return "ARCHIVE";
  return "MANUAL_REVIEW";
}

export function assertNoUpdateOperations(operations) {
  for (const [domain, domainOperations] of Object.entries(operations)) {
    if ((domainOperations.UPDATE ?? 0) > 0) fail(`Unsafe UPDATE operation proposed for ${domain}.`);
  }
}

export function buildManifest({ source, target, mapping, creatorId, domains, gitSha }) {
  const operations = {};
  const conflicts = [];
  for (const [domain, result] of Object.entries(domains)) {
    operations[domain] = result.records.reduce((counts, record) => ({ ...counts, [operationFor(record)]: (counts[operationFor(record)] ?? 0) + 1 }), {});
    for (const record of result.records.filter((record) => ["CONFLICT", "AMBIGUOUS", "MANUAL_REVIEW"].includes(record.classification))) conflicts.push({ domain, recordRef: record.ref, classification: record.classification, reason: record.reason ?? "manual_review_required" });
  }
  assertNoUpdateOperations(operations);
  const identity = sha256(stableJson({ source: source.sha256, target: target.sha256, creatorId, mapping: mapping.d1CreatorId, domains: Object.fromEntries(Object.entries(domains).map(([name, result]) => [name, result.counts])) }));
  return {
    schemaVersion: 1,
    migrationId: `phase1c-${identity.slice(0, 20)}`,
    mode: "DRY RUN",
    safetyContract: {
      phase: loadSafetyContract().phase,
      applyEnabled: false,
      existingD1UpdateDefault: "DENY",
      precedence: loadSafetyContract().precedence
    },
    source: { database: "sqlite", snapshot: path.basename(source.path), checksum: source.sha256, integrity: source.integrity },
    target: { database: "d1", environment: target.environment, databaseName: target.databaseName, databaseId: target.databaseId, snapshotChecksum: target.sha256, migrationState: target.migrations },
    creator: { sqliteCreatorId: creatorId, d1CreatorId: mapping.d1CreatorId, confidence: mapping.confidence, evidence: mapping.evidence },
    domains: Object.fromEntries(Object.entries(domains).map(([name, result]) => [name, { classificationCounts: result.counts, proposedOperations: operations[name], recordsConsidered: result.records.length }])),
    conflicts,
    exclusions: ["OAuth tokens", "API keys", "refresh tokens", "session cookies", "bridge tokens", "R2 binary upload", "D1 writes", "credentials"],
    tool: { gitSha },
    generatedAt: new Date().toISOString()
  };
}

export function gitSha() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(); } catch { return "unknown"; }
}
