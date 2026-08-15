import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  MIGRATION_DISABLED_MESSAGE,
  buildManifest,
  loadMapping,
  openReadOnlySnapshot,
  closeStableSnapshot,
  reconcileAssets,
  reconcileMedia,
  reconcileMessages,
  requireApprovedMapping,
  validateTargetAuthority,
} from "../scripts/migration/reconciliation-lib.mjs";
import { readDeploymentRegistry } from "../scripts/deployment-preflight.mjs";
import { reconcile } from "../scripts/migration/reconcile.mjs";

async function fixtureDatabases() {
  const root = await mkdtemp(path.join(os.tmpdir(), "thot-os-phase1c-"));
  const sourcePath = path.join(root, "source.sqlite");
  const targetPath = path.join(root, "target.sqlite");
  const source = new Database(sourcePath);
  const target = new Database(targetPath);
  source.exec("CREATE TABLE assets (id TEXT, creator_id TEXT, relative_path TEXT, basename TEXT, extension TEXT, bytes INTEGER, modified_at TEXT, source_available INTEGER, safety_level TEXT, workflow_status TEXT); CREATE TABLE messages (creator_id TEXT, external_message_id TEXT); ");
  target.exec("CREATE TABLE assets (id TEXT, creator_id TEXT, relative_path TEXT, basename TEXT, extension TEXT, bytes INTEGER, modified_at TEXT, source_available INTEGER, safety_level TEXT, workflow_status TEXT, preview_r2_key TEXT, media_r2_key TEXT, dropbox_revision TEXT); CREATE TABLE messages (creator_id TEXT, external_message_id TEXT);");
  source.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)").run("match", "adelaide", "match.jpg", "match.jpg", "jpg", 10, "2026-08-01", 1, "sfw", "available");
  source.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)").run("only-source", "adelaide", "source.jpg", "source.jpg", "jpg", 20, "2026-08-01", 1, "sfw", "available");
  source.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)").run("conflict", "adelaide", "conflict.jpg", "conflict.jpg", "jpg", 30, "2026-08-03", 1, "sfw", "available");
  source.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)").run("missing", "adelaide", "missing.jpg", "missing.jpg", "jpg", 40, "2026-08-01", 0, "sfw", "available");
  target.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("match", "adelaide", "match.jpg", "match.jpg", "jpg", 10, "2026-08-01", 1, "sfw", "available", null, null, null);
  target.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("only-target", "adelaide", "target.jpg", "target.jpg", "jpg", 11, "2026-08-01", 1, "sfw", "available", null, null, null);
  target.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("conflict", "adelaide", "conflict.jpg", "conflict.jpg", "jpg", 31, "2026-08-02", 1, "sfw", "available", null, "r2/key", "rev");
  target.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("foreign", "bryshanagy", "source.jpg", "source.jpg", "jpg", 20, "2026-08-01", 1, "sfw", "available", null, null, null);
  source.prepare("INSERT INTO messages VALUES (?,?)").run("adelaide", "provider-match");
  source.prepare("INSERT INTO messages VALUES (?,?)").run("adelaide", "provider-needs-map");
  target.prepare("INSERT INTO messages VALUES (?,?)").run("adelaide", "provider-match");
  target.prepare("INSERT INTO messages VALUES (?,?)").run("adelaide", "provider-target-only");
  source.close(); target.close();
  return { root, sourcePath, targetPath };
}

test("fixtures declare required reconciliation cases", async () => {
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "tests/fixtures/migration-reconciliation/cases.json"), "utf8"));
  assert.deepEqual(fixture.assetCases, ["source-only", "target-only", "exact-match", "material-conflict", "target-newer"]);
  assert.ok(fixture.safetyCases.includes("production-rejected"));
});

test("asset reconciliation is creator-scoped and conflict-aware", async () => {
  const fixture = await fixtureDatabases();
  const source = openReadOnlySnapshot(fixture.sourcePath, "source");
  const target = openReadOnlySnapshot(fixture.targetPath, "target");
  try {
    const records = reconcileAssets(source.db, target.db, "adelaide");
    assert.equal(records.filter((record) => record.classification === "MATCH").length, 1);
    assert.equal(records.filter((record) => record.classification === "SOURCE_ONLY").length, 2);
    assert.equal(records.filter((record) => record.classification === "TARGET_ONLY").length, 1);
    assert.equal(records.filter((record) => record.classification === "CONFLICT").length, 1);
  } finally { closeStableSnapshot(source, "source"); closeStableSnapshot(target, "target"); await rm(fixture.root, { recursive: true, force: true }); }
});

test("messages use provider IDs but do not invent a connection mapping", async () => {
  const fixture = await fixtureDatabases();
  const source = openReadOnlySnapshot(fixture.sourcePath, "source");
  const target = openReadOnlySnapshot(fixture.targetPath, "target");
  try {
    const records = reconcileMessages(source.db, target.db, "adelaide");
    assert.equal(records.filter((record) => record.classification === "MATCH").length, 1);
    assert.equal(records.filter((record) => record.classification === "AMBIGUOUS").length, 1);
    assert.equal(records.filter((record) => record.classification === "TARGET_ONLY").length, 1);
  } finally { closeStableSnapshot(source, "source"); closeStableSnapshot(target, "target"); await rm(fixture.root, { recursive: true, force: true }); }
});

test("media reconciliation never treats an R2 pointer as an upload instruction", async () => {
  const fixture = await fixtureDatabases();
  const source = openReadOnlySnapshot(fixture.sourcePath, "source");
  const target = openReadOnlySnapshot(fixture.targetPath, "target");
  try {
    const records = reconcileMedia(source.db, target.db, "adelaide");
    assert.ok(records.some((record) => record.mediaAction === "METADATA_ONLY"));
    assert.ok(records.some((record) => record.mediaAction === "SOURCE_MISSING"));
    assert.ok(records.some((record) => record.mediaAction === "UPLOAD_REQUIRED"));
  } finally { closeStableSnapshot(source, "source"); closeStableSnapshot(target, "target"); await rm(fixture.root, { recursive: true, force: true }); }
});

test("only explicit approved mappings and staging authority are accepted", () => {
  const mapping = loadMapping();
  assert.equal(requireApprovedMapping(mapping, "adelaide").d1CreatorId, "adelaide");
  assert.throws(() => requireApprovedMapping(mapping, "thrill-noir"), /no approved exact identity mapping/);
  assert.throws(() => validateTargetAuthority({ environment: "production" }), /Only the explicitly provisioned staging/);
  const registry = readDeploymentRegistry();
  registry.environments.staging.resources.d1["thot-os-staging"].id = "wrong-d1-id";
  assert.throws(() => validateTargetAuthority({ environment: "staging", registry }), /identity mismatch/);
  assert.throws(() => reconcile({ apply: true }), /Migration apply is disabled during Phase 1C\./);
  assert.equal(MIGRATION_DISABLED_MESSAGE, "Migration apply is disabled during Phase 1C.");
});

test("dry-run manifests are idempotent and exclude credential material", () => {
  const input = {
    source: { path: "/snapshot/source.sqlite", sha256: "source", integrity: "ok" },
    target: { environment: "staging", databaseName: "thot-os-staging", databaseId: "d1", sha256: "target", migrations: ["0001.sql"] },
    mapping: { d1CreatorId: "adelaide", confidence: "high", evidence: ["exact_stable_id"] },
    creatorId: "adelaide",
    domains: { assets: { records: [{ ref: "a", classification: "SOURCE_ONLY" }], counts: { SOURCE_ONLY: 1 } } },
    gitSha: "fixture"
  };
  const first = buildManifest(input);
  const second = buildManifest(input);
  assert.equal(first.migrationId, second.migrationId);
  assert.ok(first.exclusions.includes("OAuth tokens"));
  assert.equal(first.domains.assets.proposedOperations.INSERT, 1);
});
