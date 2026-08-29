#!/usr/bin/env node
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AwsClient } from "aws4fetch";
import { createActivationD1ReadClient, captureWorkerMetadata, mutationWranglerEnvironment, runWranglerMutation } from "./service-auth-activate.mjs";
import { loadAuthority, projectRoot, writeOwnerOnlyNew } from "./source-media-migration-lib.mjs";
import { assertApprovedVideoCleanupPlan, assertApprovedVideoR2ConfigurationPlan, createVideoCleanupPlan, createVideoR2ConfigurationPlan, digest, parseR2CorsListOutput, stableJson } from "./r2-video-recovery-lib.mjs";

const configPath = "cloudflare/thot-os-next/wrangler.jsonc";
const accountId = "3e7cfa6efb7a97825f1dc24515410c63";
const bucket = "thot-os-library-media-staging";
const registry = JSON.parse(readFileSync(path.join(projectRoot, "config/deployments.json"), "utf8"));
const git = (args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function parse(argv) {
  const options = { mode: "plan" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan" || arg === "--apply" || arg === "--config-plan" || arg === "--config-apply") options.mode = arg.slice(2);
    else if (["--output", "--approved-plan", "--backup"].includes(arg)) options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = path.resolve(argv[++index]);
    else if (arg === "--target-count") options.targetCount = Number(argv[++index]);
    else if (arg === "--confirmation") options.confirmation = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error("unknown_option");
  }
  return options;
}
function target(authority) { return { accountId: authority.accountId, databaseId: authority.databaseId, databaseName: authority.databaseName }; }

function currentCorsRules() {
  const wrangler = path.join(projectRoot, "cloudflare/thot-os-next/node_modules/.bin/wrangler");
  try {
    const output = String(execFileSync(wrangler, ["r2", "bucket", "cors", "list", bucket, "--config", configPath], {
      cwd: projectRoot,
      encoding: "utf8",
      env: mutationWranglerEnvironment({ accountId }),
      stdio: ["ignore", "pipe", "pipe"],
    })).trim();
    if (!output) throw new Error("r2_cors_metadata_empty_output");
    return parseR2CorsListOutput(output);
  } catch (error) {
    const diagnostic = String(error?.stderr ?? "");
    if (/10059|configuration does not exist/i.test(diagnostic)) return [];
    throw new Error("r2_cors_metadata_read_failed");
  }
}
function readKeychain(account) {
  try { const value = String(execFileSync("/usr/bin/security", ["find-generic-password", "-s", "creatoros-r2-video-cleanup", "-a", account, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).trim(); if (!value) throw new Error("empty"); return value; }
  catch { throw new Error("staging_r2_cleanup_credentials_unavailable_from_keychain"); }
}
function cleanupSql(session) {
  const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const detail = '{"outcome":"expired","failureCode":"session_expired","operation":"approved_staging_r2_cleanup"}';
  return `UPDATE asset_video_ingest_sessions SET status='expired',finalization_state='expired',failure_code='session_expired',multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${q(session.id)} AND creator_id=${q(session.creator_id)} AND finalization_state='incomplete';\nUPDATE asset_video_ingest_parts SET status='failed',failure_code=COALESCE(failure_code,'session_expired'),updated_at=CURRENT_TIMESTAMP WHERE session_id=${q(session.id)} AND creator_id=${q(session.creator_id)} AND status<>'failed';\nUPDATE asset_storage_objects SET ingest_status='failed',failure_code='session_expired',updated_at=CURRENT_TIMESTAMP WHERE id=${q(session.storage_object_id)} AND creator_id=${q(session.creator_id)} AND ingest_status<>'verified';\nUPDATE asset_media_authorities SET state='archived',preview_failure_code='session_expired',updated_at=CURRENT_TIMESTAMP WHERE asset_id=${q(session.asset_id)} AND creator_id=${q(session.creator_id)} AND authority_kind='r2_native' AND state<>'canonical_verified';\nUPDATE asset_video_playback_states SET state='archived',failure_code='session_expired',updated_at=CURRENT_TIMESTAMP WHERE asset_id=${q(session.asset_id)} AND creator_id=${q(session.creator_id)} AND state<>'playback_ready';\nUPDATE assets SET source_available=0,indexed_at=CURRENT_TIMESTAMP WHERE id=${q(session.asset_id)} AND creator_id=${q(session.creator_id)};\nINSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (lower(hex(randomblob(16))),${q(session.creator_id)},${q(session.asset_id)},${q(session.id)},${q(session.actor_email)},${q(session.actor_role)},'ingest_failed',${q(detail)});\nINSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (lower(hex(randomblob(16))),${q(session.creator_id)},${q(session.actor_email)},${q(session.actor_role)},'native_video_ingest_terminal',${q(session.asset_id)},${q(detail)});`;
}
function currentWorkerMetadata() {
  const worker = captureWorkerMetadata(registry, "web");
  return { latestVersionId: worker.latestVersionId, deployment: worker.deployment, secretNames: worker.latestSecretVersion.secretNames };
}
function currentGitMetadata() { return { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), clean: git(["status", "--porcelain"]) === "" }; }
async function observedConfiguration({ includeCors = true } = {}) {
  const authority = await loadAuthority();
  return { authority, worker: currentWorkerMetadata(), currentCors: includeCors ? currentCorsRules() : null, git: currentGitMetadata() };
}
async function observed({ targetCount = 2 } = {}) {
  const configuration = await observedConfiguration({ includeCors: false }); const d1 = createActivationD1ReadClient();
  if (!Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > 10) throw new Error("cleanup_target_count_invalid");
  const sessions = (await d1.queryReadOnly(target(configuration.authority), `SELECT id,creator_id,asset_id,storage_object_id,object_key,multipart_upload_id,expected_bytes,uploaded_bytes,expires_at,status,finalization_state,actor_email,actor_role FROM asset_video_ingest_sessions WHERE finalization_state='incomplete' AND expires_at<=CURRENT_TIMESTAMP AND multipart_upload_id IS NOT NULL ORDER BY expires_at ASC LIMIT ${targetCount + 1}`, [])).rows;
  return { ...configuration, sessions };
}
async function abortMultipart(session) {
  const client = new AwsClient({ accessKeyId: readKeychain("access-key-id"), secretAccessKey: readKeychain("secret-access-key"), service: "s3", region: "auto" });
  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${session.object_key.split("/").map(encodeURIComponent).join("/")}`); url.searchParams.set("uploadId", session.multipart_upload_id);
  const response = await client.fetch(url, { method: "DELETE" });
  // A prior interrupted attempt can have completed R2's abort before its D1
  // terminalization step. Treat R2's explicit absent response as confirmation,
  // so a retry remains bounded and cannot strand the corresponding record.
  if (!response.ok && response.status !== 404) throw new Error("r2_multipart_abort_not_confirmed");
}
async function apply(plan, current, options) {
  assertApprovedVideoCleanupPlan(plan, options.confirmation, current);
  if (!options.backup) throw new Error("owner_only_backup_required");
  writeOwnerOnlyNew(options.backup, { schemaVersion: 1, kind: "staging-r2-video-cleanup-backup", environment: "staging", planSha256: plan.planSha256, capturedAt: new Date().toISOString(), sessions: current.sessions });
  for (const session of current.sessions) {
    await abortMultipart(session);
    const directory = mkdtempSync(path.join(os.tmpdir(), "creatoros-video-cleanup-")); chmodSync(directory, 0o700); const sql = path.join(directory, "cleanup.sql");
    try { writeFileSync(sql, cleanupSql(session), { mode: 0o600, flag: "wx" }); runWranglerMutation(["--config", configPath, "d1", "execute", current.authority.databaseName, "--remote", "--file", sql], registry, { operation: "staging-r2-video-cleanup" }); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
}
function directUploadsEnabledInStagingConfig() {
  const config = readFileSync(path.join(projectRoot, configPath), "utf8");
  if (!/"R2_VIDEO_DIRECT_UPLOADS_ENABLED"\s*:\s*"1"/.test(config)) throw new Error("staging_direct_video_feature_flag_not_enabled");
}
function pause(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function readCorsAfterApply() {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return currentCorsRules(); } catch (error) { lastError = error; if (attempt < 3) await pause(1_000); }
  }
  throw lastError ?? new Error("r2_cors_post_apply_readback_failed");
}
async function applyConfiguration(plan, current, options) {
  assertApprovedVideoR2ConfigurationPlan(plan, options.confirmation, current);
  directUploadsEnabledInStagingConfig();
  if (!options.backup) throw new Error("owner_only_backup_required");
  writeOwnerOnlyNew(options.backup, {
    schemaVersion: 1, kind: "staging-r2-video-direct-upload-configuration-backup", environment: "staging",
    planSha256: plan.planSha256, capturedAt: new Date().toISOString(), targetBucket: current.authority.bucket, previousCors: current.currentCors,
  });
  const directory = mkdtempSync(path.join(os.tmpdir(), "creatoros-r2-video-cors-")); chmodSync(directory, 0o700);
  const configurationFile = path.join(directory, "cors.json");
  try {
    writeFileSync(configurationFile, `${JSON.stringify({ rules: plan.desiredCors })}\n`, { mode: 0o600, flag: "wx" });
    runWranglerMutation(["--config", configPath, "r2", "bucket", "cors", "set", current.authority.bucket, "--file", configurationFile, "-y"], registry, { operation: "staging-r2-video-direct-upload-cors" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
  let observedCors = null; let outcome = "applied";
  try { observedCors = await readCorsAfterApply(); }
  catch { outcome = "readback_required"; }
  const receipt = {
    schemaVersion: 1, kind: "staging-r2-video-direct-upload-configuration-receipt", environment: "staging", planSha256: plan.planSha256,
    appliedAt: new Date().toISOString(), targetBucket: current.authority.bucket, previousCorsDigest: digest(current.currentCors),
    desiredCorsDigest: plan.desiredCorsDigest, observedCorsDigest: observedCors ? digest(observedCors) : null, outcome, productionTouched: false,
  };
  writeOwnerOnlyNew(options.output, receipt);
  if (outcome !== "applied" || stableJson(observedCors) !== stableJson(plan.desiredCors)) throw new Error("r2_cors_post_apply_readback_mismatch");
}
async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) return console.log("Usage: node scripts/r2-video-recovery.mjs --plan|--config-plan|--apply|--config-apply --output <owner-only-json> [--target-count 1..10] [--approved-plan <plan> --confirmation cleanup:<token>|r2-config:<token> --backup <owner-only-json>]");
  if (!options.output) throw new Error("owner_only_output_required"); if (["apply", "config-apply"].includes(options.mode) && (!options.approvedPlan || !options.confirmation)) throw new Error("approved_plan_and_confirmation_required"); const approved = ["apply", "config-apply"].includes(options.mode) ? JSON.parse(readFileSync(options.approvedPlan, "utf8")) : null;
  if (options.mode === "config-plan" || options.mode === "config-apply") {
    const current = await observedConfiguration(); if (!current.git.clean) throw new Error("clean_git_required");
    if (options.mode === "config-plan") { const plan = createVideoR2ConfigurationPlan({ authority: current.authority, git: current.git, worker: current.worker, origin: "https://thot-os-staging.thot-os.workers.dev", currentCors: current.currentCors }); writeOwnerOnlyNew(options.output, plan); console.log(JSON.stringify({ configurationToken: plan.confirmation, requiredSecretNames: plan.requiredSecretNames, featureFlag: plan.featureFlag.name, desiredCorsDigest: plan.desiredCorsDigest }, null, 2)); return; }
    await applyConfiguration(approved, current, options); console.log("CONFIGURATION_APPLIED"); return;
  }
  const targetCount = approved?.targetCount ?? options.targetCount ?? 2; const current = await observed({ targetCount }); if (!current.git.clean) throw new Error("clean_git_required");
  if (options.mode === "plan") { const plan = createVideoCleanupPlan({ ...current, targetCount }); writeOwnerOnlyNew(options.output, plan); console.log(JSON.stringify({ cleanupToken: plan.confirmation, targetCount: plan.targetCount, targetDigest: plan.targetDigest }, null, 2)); return; }
  const plan = approved; await apply(plan, current, options); writeOwnerOnlyNew(options.output, { schemaVersion: 1, kind: "staging-r2-video-cleanup-receipt", environment: "staging", planSha256: plan.planSha256, appliedAt: new Date().toISOString(), targetCount: plan.targetCount, productionTouched: false }); console.log("APPLIED");
}
main().catch((error) => { console.error(`R2 video recovery failed: ${error instanceof Error ? error.message : "unknown_error"}`); process.exitCode = 1; });
