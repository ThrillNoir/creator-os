#!/usr/bin/env node
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createActivationD1ReadClient, captureWorkerMetadata, runWranglerMutation } from "./service-auth-activate.mjs";
import { loadAuthority, projectRoot, writeOwnerOnlyNew } from "./source-media-migration-lib.mjs";
import { assertApprovedCutoverPlan, coverageSummary, createCutoverPlan, readinessSummary } from "./source-media-cutover-lib.mjs";

const registry = JSON.parse(readFileSync(path.join(projectRoot, "config/deployments.json"), "utf8"));
const git = (args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
const target = (authority) => ({ accountId: authority.accountId, databaseId: authority.databaseId, databaseName: authority.databaseName });

function parse(argv) {
  const value = new Set(["--creator", "--output", "--approved-plan", "--confirmation"]); const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--plan" || item === "--apply") options.mode = item.slice(2);
    else if (item === "--rollback") options.rollback = true;
    else if (value.has(item)) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const next = argv[++index];
      options[key] = item === "--creator" ? next : path.resolve(next);
    }
    else if (item === "--help") options.help = true;
    else throw new Error("unknown_option");
  }
  return options;
}
function safeCreator(value) { if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) throw new Error("creator_required"); return value; }
function readPlan(file) { return JSON.parse(readFileSync(file, "utf8")); }

async function observed(creatorId) {
  const authority = await loadAuthority(); const d1 = createActivationD1ReadClient(); const context = target(authority);
  const [stateResult, coverageResult, readinessResult] = await Promise.all([
    d1.queryReadOnly(context, "SELECT active_backend,migration_state,dropbox_fallback_enabled FROM creator_media_source_states WHERE creator_id=?", [creatorId]),
    d1.queryReadOnly(context, `SELECT COUNT(*) AS available_assets, SUM(CASE WHEN EXISTS (
      SELECT 1 FROM asset_storage_objects o WHERE o.creator_id=a.creator_id AND o.asset_id=a.id AND o.provider='r2'
        AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
        AND o.source_provider='dropbox' AND o.source_revision IS a.dropbox_revision AND o.byte_count=a.bytes
        AND o.r2_version IS NOT NULL AND o.r2_etag IS NOT NULL
    ) THEN 1 ELSE 0 END) AS eligible_assets FROM assets a WHERE a.creator_id=? AND a.source_available=1`, [creatorId]),
    d1.queryReadOnly(context, "SELECT service_name,status,worker_version,deployment_evidence_sha256,health_evidence_sha256,asset_coverage_sha256,reason_code FROM creator_source_media_consumer_readiness WHERE creator_id=?", [creatorId]),
  ]);
  const workers = ["web", "vault", "instagram", "reddit"].map((component) => {
    const metadata = captureWorkerMetadata(registry, component);
    return { component, latestVersionId: metadata.latestVersionId, completeTraffic: metadata.deployment.versions.length === 1 && metadata.deployment.versions[0].versionId === metadata.latestVersionId && metadata.deployment.versions[0].percentage === 100, secretNames: metadata.secretNames };
  });
  return { authority, git: { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), clean: git(["status", "--porcelain"]) === "" }, state: { activeBackend: stateResult.rows[0]?.active_backend ?? "missing", migrationState: stateResult.rows[0]?.migration_state ?? "missing", dropboxFallbackEnabled: stateResult.rows[0]?.dropbox_fallback_enabled ?? null }, coverage: coverageSummary(coverageResult.rows), readiness: readinessSummary(readinessResult.rows), workerMetadata: workers };
}

function applySql(plan) {
  const creator = plan.creatorId.replaceAll("'", "''"); const sha = plan.planSha256.replaceAll("'", "''"); const gitSha = plan.git.sha.replaceAll("'", "''"); const coverage = plan.coverageSha256.replaceAll("'", "''"); const readiness = plan.readinessSha256.replaceAll("'", "''");
  const r2 = plan.action === "r2_cutover";
  const receiptId = `${r2 ? "cutover" : "rollback"}:${sha.slice(0, 16)}`;
  const state = r2
    ? "active_backend='r2',migration_state='r2_active',dropbox_fallback_enabled=1,cutover_by='service:source-media-cutover',cutover_at=CURRENT_TIMESTAMP,rollback_reason=''"
    : "active_backend='dropbox',migration_state='rollback',dropbox_fallback_enabled=1,cutover_by='service:source-media-cutover',cutover_at=CURRENT_TIMESTAMP,rollback_reason='bounded_rollback'";
  const expected = r2 ? "dropbox" : "r2";
  const action = r2 ? "r2_cutover" : "dropbox_rollback";
  // SQLite's RAISE() expression is valid only inside triggers. Keep this
  // transaction portable to D1; the caller proves both the state transition
  // and receipt with a separate read before reporting success.
  return `BEGIN IMMEDIATE;\nUPDATE creator_media_source_states SET ${state},updated_at=CURRENT_TIMESTAMP WHERE creator_id='${creator}' AND active_backend='${expected}';\nINSERT INTO creator_media_source_cutover_receipts (id,creator_id,plan_sha256,git_sha,asset_coverage_sha256,readiness_evidence_sha256,applied_by,action) SELECT '${receiptId}','${creator}','${sha}','${gitSha}','${coverage}','${readiness}','service:source-media-cutover','${action}' WHERE changes()=1;\nCOMMIT;`;
}

async function verifyAppliedCutover(creatorId, plan, authority) {
  const d1 = createActivationD1ReadClient();
  const expected = plan.action === "r2_cutover" ? "r2" : "dropbox";
  const receiptId = `${plan.action === "r2_cutover" ? "cutover" : "rollback"}:${plan.planSha256.slice(0, 16)}`;
  const [state, receipt] = await Promise.all([
    d1.queryReadOnly(target(authority), "SELECT active_backend FROM creator_media_source_states WHERE creator_id=?", [creatorId]),
    d1.queryReadOnly(target(authority), "SELECT id FROM creator_media_source_cutover_receipts WHERE id=? AND creator_id=? AND plan_sha256=?", [receiptId, creatorId, plan.planSha256]),
  ]);
  if (state.rows[0]?.active_backend !== expected || receipt.rows.length !== 1) throw new Error("cutover_apply_not_confirmed");
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) return console.log("Usage: node scripts/source-media-cutover.mjs --plan|--apply --creator <id> --output <absolute json> [--rollback --approved-plan <plan> --confirmation cutover:<digest>]");
  const creatorId = safeCreator(options.creator); if (!options.mode || !options.output) throw new Error("mode_and_owner_only_output_required");
  const action = options.rollback ? "dropbox_rollback" : "r2_cutover"; const current = await observed(creatorId);
  if (!current.git.clean) throw new Error("cutover_requires_clean_git");
  if (options.mode === "plan") {
    const plan = createCutoverPlan({ creatorId, action, ...current }); writeOwnerOnlyNew(options.output, plan);
    console.log(JSON.stringify({ eligible: plan.eligible, confirmation: plan.confirmation, coverage: plan.coverage, readiness: plan.readiness.services.map((entry) => ({ service: entry.service, status: entry.status, reasonCode: entry.reasonCode })) }, null, 2)); return;
  }
  if (!options.approvedPlan || !options.confirmation) throw new Error("approved_plan_and_confirmation_required");
  const plan = readPlan(options.approvedPlan); assertApprovedCutoverPlan(plan, options.confirmation, current);
  const directory = mkdtempSync(path.join(os.tmpdir(), "creatoros-cutover-")); chmodSync(directory, 0o700); const sql = path.join(directory, "cutover.sql");
  try { writeFileSync(sql, applySql(plan), { mode: 0o600, flag: "wx" }); runWranglerMutation(["--config", "cloudflare/thot-os-next/wrangler.jsonc", "d1", "execute", current.authority.databaseName, "--remote", "--file", sql], registry, { operation: "creator-source-media-cutover" }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
  await verifyAppliedCutover(creatorId, plan, current.authority);
  writeOwnerOnlyNew(options.output, { schemaVersion: 1, kind: "creator-source-media-cutover-receipt", environment: "staging", creatorId, action: plan.action, planSha256: plan.planSha256, appliedAt: new Date().toISOString(), productionTouched: false });
  console.log("APPLIED");
}
main().catch((error) => { console.error(`Cutover coordinator failed: ${error instanceof Error ? error.message : "unknown_error"}`); process.exitCode = 1; });
