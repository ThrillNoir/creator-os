#!/usr/bin/env node
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AwsClient } from "aws4fetch";
import { createActivationD1ReadClient, captureWorkerMetadata, mutationWranglerEnvironment, runWranglerMutation } from "./service-auth-activate.mjs";
import { loadAuthority, projectRoot, writeOwnerOnlyNew } from "./source-media-migration-lib.mjs";
import { assertApprovedVideoCleanupPlan, createVideoCleanupPlan, createVideoR2ConfigurationPlan } from "./r2-video-recovery-lib.mjs";

const configPath = "cloudflare/thot-os-next/wrangler.jsonc";
const accountId = "3e7cfa6efb7a97825f1dc24515410c63";
const bucket = "thot-os-library-media-staging";
const registry = JSON.parse(readFileSync(path.join(projectRoot, "config/deployments.json"), "utf8"));
const git = (args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function parse(argv) {
  const options = { mode: "plan" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan" || arg === "--apply" || arg === "--config-plan") options.mode = arg.slice(2);
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
    if (!output) return [];
    try { return JSON.parse(output); } catch { throw new Error("r2_cors_metadata_not_json"); }
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
  return `BEGIN IMMEDIATE;\nUPDATE asset_video_ingest_sessions SET status='expired',finalization_state='expired',failure_code='session_expired',multipart_upload_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${q(session.id)} AND creator_id=${q(session.creator_id)} AND finalization_state='incomplete';\nUPDATE asset_video_ingest_parts SET status='failed',failure_code=COALESCE(failure_code,'session_expired'),updated_at=CURRENT_TIMESTAMP WHERE session_id=${q(session.id)} AND creator_id=${q(session.creator_id)} AND status<>'failed';\nUPDATE asset_storage_objects SET ingest_status='failed',failure_code='session_expired',updated_at=CURRENT_TIMESTAMP WHERE id=${q(session.storage_object_id)} AND creator_id=${q(session.creator_id)} AND ingest_status<>'verified';\nUPDATE asset_media_authorities SET state='archived',preview_failure_code='session_expired',updated_at=CURRENT_TIMESTAMP WHERE asset_id=${q(session.asset_id)} AND creator_id=${q(session.creator_id)} AND authority_kind='r2_native' AND state<>'canonical_verified';\nUPDATE asset_video_playback_states SET state='archived',failure_code='session_expired',updated_at=CURRENT_TIMESTAMP WHERE asset_id=${q(session.asset_id)} AND creator_id=${q(session.creator_id)} AND state<>'playback_ready';\nUPDATE assets SET source_available=0,indexed_at=CURRENT_TIMESTAMP WHERE id=${q(session.asset_id)} AND creator_id=${q(session.creator_id)};\nINSERT INTO asset_video_ingest_events (id,creator_id,asset_id,session_id,actor_email,actor_role,event_type,detail) VALUES (lower(hex(randomblob(16))),${q(session.creator_id)},${q(session.asset_id)},${q(session.id)},'service:r2-video-cleanup','service','ingest_failed','{"outcome":"expired","failureCode":"session_expired"}');\nINSERT INTO identity_audit_events (id,creator_id,actor_email,event_type,subject,detail) VALUES (lower(hex(randomblob(16))),${q(session.creator_id)},'service:r2-video-cleanup','native_video_ingest_terminal',${q(session.asset_id)},'{"outcome":"expired","failureCode":"session_expired"}');\nCOMMIT;`;
}
async function observed({ includeCors = false, targetCount = 2 } = {}) {
  const authority = await loadAuthority(); const d1 = createActivationD1ReadClient();
  if (!Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > 10) throw new Error("cleanup_target_count_invalid");
  const sessions = (await d1.queryReadOnly(target(authority), `SELECT id,creator_id,asset_id,storage_object_id,object_key,multipart_upload_id,expected_bytes,uploaded_bytes,expires_at,status,finalization_state FROM asset_video_ingest_sessions WHERE finalization_state='incomplete' AND expires_at<=CURRENT_TIMESTAMP AND multipart_upload_id IS NOT NULL ORDER BY expires_at ASC LIMIT ${targetCount + 1}`, [])).rows;
  const worker = captureWorkerMetadata(registry, "web");
  const currentCors = includeCors ? currentCorsRules() : null;
  return { authority, sessions, worker: { latestVersionId: worker.latestVersionId, deployment: worker.deployment, secretNames: worker.latestSecretVersion.secretNames }, currentCors, git: { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), clean: git(["status", "--porcelain"]) === "" } };
}
async function abortMultipart(session) {
  const client = new AwsClient({ accessKeyId: readKeychain("access-key-id"), secretAccessKey: readKeychain("secret-access-key"), service: "s3", region: "auto" });
  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${session.object_key.split("/").map(encodeURIComponent).join("/")}`); url.searchParams.set("uploadId", session.multipart_upload_id);
  const response = await client.fetch(url, { method: "DELETE" });
  if (!response.ok) throw new Error("r2_multipart_abort_not_confirmed");
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
async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) return console.log("Usage: node scripts/r2-video-recovery.mjs --plan|--config-plan|--apply --output <owner-only-json> [--target-count 1..10] [--approved-plan <plan> --confirmation cleanup:<token> --backup <owner-only-json>]");
  if (!options.output) throw new Error("owner_only_output_required"); if (options.mode === "apply" && (!options.approvedPlan || !options.confirmation)) throw new Error("approved_plan_and_confirmation_required"); const approved = options.mode === "apply" ? JSON.parse(readFileSync(options.approvedPlan, "utf8")) : null; const targetCount = approved?.targetCount ?? options.targetCount ?? 2; const current = await observed({ includeCors: options.mode === "config-plan", targetCount }); if (!current.git.clean) throw new Error("clean_git_required");
  if (options.mode === "config-plan") { const plan = createVideoR2ConfigurationPlan({ authority: current.authority, git: current.git, worker: current.worker, origin: "https://thot-os-staging.thot-os.workers.dev", currentCors: current.currentCors }); writeOwnerOnlyNew(options.output, plan); console.log(JSON.stringify({ configurationToken: plan.confirmation, requiredSecretNames: plan.requiredSecretNames, featureFlag: plan.featureFlag.name }, null, 2)); return; }
  if (options.mode === "plan") { const plan = createVideoCleanupPlan({ ...current, targetCount }); writeOwnerOnlyNew(options.output, plan); console.log(JSON.stringify({ cleanupToken: plan.confirmation, targetCount: plan.targetCount, targetDigest: plan.targetDigest }, null, 2)); return; }
  const plan = approved; await apply(plan, current, options); writeOwnerOnlyNew(options.output, { schemaVersion: 1, kind: "staging-r2-video-cleanup-receipt", environment: "staging", planSha256: plan.planSha256, appliedAt: new Date().toISOString(), targetCount: plan.targetCount, productionTouched: false }); console.log("APPLIED");
}
main().catch((error) => { console.error(`R2 video recovery failed: ${error instanceof Error ? error.message : "unknown_error"}`); process.exitCode = 1; });
