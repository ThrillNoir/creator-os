#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createActivationD1ReadClient, mutationWranglerEnvironment } from "./service-auth-activate.mjs";
import { canonicalConfigPath, loadAuthority, writeOwnerOnlyNew } from "./source-media-migration-lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const wrangler = path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const opaque = (value) => sha256(`creatoros-staging-reconciliation:${value}`).slice(0, 20);

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") options.output = path.resolve(argv[++index]);
    else if (argv[index] === "--help") options.help = true;
    else throw new Error("unknown_option");
  }
  return options;
}

function inspectObject(authority, key, expectedBytes, expectedSha256) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "creatoros-r2-readonly-")); const output = path.join(temporary, "object");
  try {
    const result = spawnSync(wrangler, ["--config", canonicalConfigPath, "r2", "object", "get", `${authority.bucket}/${key}`, "--remote", "--file", output], { cwd: root, encoding: "utf8", env: mutationWranglerEnvironment({ accountId: authority.accountId }), stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) {
      const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      return /\b404\b|not found|does not exist|nosuchkey/i.test(diagnostic) ? { state: "missing" } : { state: "uncertain" };
    }
    const bytes = statSync(output).size; const checksum = sha256(readFileSync(output));
    return { state: "present", byteCountMatch: bytes === expectedBytes, checksumMatch: checksum === expectedSha256 };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export async function reconcile({ output, d1Client = createActivationD1ReadClient(), inspect = inspectObject }) {
  if (!output || !path.isAbsolute(output)) throw new Error("owner_only_absolute_output_required");
  const authority = await loadAuthority(d1Client); const target = { accountId: authority.accountId, databaseId: authority.databaseId, databaseName: authority.databaseName };
  const objects = (await d1Client.queryReadOnly(target, "SELECT id,creator_id,asset_id,object_key,byte_count,sha256,ingest_status FROM asset_storage_objects WHERE provider='r2' AND bucket_role='library_media' ORDER BY created_at,id")).rows;
  const sessions = (await d1Client.queryReadOnly(target, "SELECT id,creator_id,asset_id,storage_object_id,status,multipart_upload_id FROM asset_ingest_sessions ORDER BY created_at,id")).rows;
  const sessionByObject = new Map(sessions.map((session) => [session.storage_object_id, session]));
  const items = objects.map((record) => {
    const observed = inspect(authority, record.object_key, record.byte_count, record.sha256); const session = sessionByObject.get(record.id);
    let disposition = "manual_review";
    if (record.ingest_status === "verified" && observed.state === "present" && observed.byteCountMatch && observed.checksumMatch) disposition = "retain_requires_immutable_identity_backfill";
    else if (observed.state === "present") disposition = "quarantine_completed_or_mismatched_object";
    else if (observed.state === "missing" && session?.multipart_upload_id) disposition = "retain_upload_id_for_authenticated_abort_or_retry";
    else if (observed.state === "missing") disposition = "safe_to_retry_with_new_opaque_key";
    return { correlationId: opaque(`${record.id}:${session?.id ?? "none"}`), d1ObjectState: record.ingest_status, sessionState: session?.status ?? "none", r2ObjectState: observed.state, byteCountMatch: observed.byteCountMatch ?? null, checksumMatch: observed.checksumMatch ?? null, immutableIdentityRecorded: false, wouldSatisfyHardenedCutover: false, disposition };
  });
  const summary = {
    objects: objects.length,
    verified: objects.filter((entry) => entry.ingest_status === "verified").length,
    failed: objects.filter((entry) => entry.ingest_status === "failed").length,
    sessions: sessions.length,
    finalized: sessions.filter((entry) => entry.status === "finalized").length,
    aborted: sessions.filter((entry) => entry.status === "aborted").length,
    multipartUploadIdsRetained: sessions.filter((entry) => typeof entry.multipart_upload_id === "string" && entry.multipart_upload_id.length > 0).length,
    hardenedCutoverEligible: items.filter((entry) => entry.wouldSatisfyHardenedCutover).length,
  };
  const report = { schemaVersion: 1, kind: "sanitized-staging-source-media-reconciliation", environment: "staging", authority: { databaseId: authority.databaseId, bucket: authority.bucket, remoteMigrationSha256: authority.remoteMigrationSha256 }, observedAt: new Date().toISOString(), readOnly: true, summary, items };
  writeOwnerOnlyNew(output, report); return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parse(process.argv.slice(2)); if (options.help) console.log("Usage: node scripts/reconcile-staging-source-media.mjs --output <owner-only absolute json>");
    else { const result = await reconcile(options); console.log(JSON.stringify({ kind: result.kind, summary: result.summary }, null, 2)); }
  } catch (error) { console.error(`Source-media reconciliation failed: ${error instanceof Error ? error.message : "unknown_error"}`); process.exitCode = 1; }
}
