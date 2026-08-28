#!/usr/bin/env node
/**
 * Safe Dropbox-to-private-R2 migration planner. The source directory is read
 * only; all evidence files are created with mode 0600 and never include an
 * absolute source path. `apply` is deliberately staging-only and requires the
 * exact reviewed plan confirmation before it will invoke Wrangler.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Map([["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"], ["heic", "image/heic"], ["mp4", "video/mp4"], ["mov", "video/quicktime"]]);
const maxBytes = 5 * 1024 ** 4;

function usage() {
  return `Usage:
  node scripts/source-media-migration.mjs inventory --source-root <absolute read-only root> --creator-map <absolute json> --output <absolute manifest.json>
  node scripts/source-media-migration.mjs plan --environment staging --release-id <id> --creator-map <absolute json> --manifest <absolute manifest.json> --bucket thot-os-library-media-staging --output <absolute plan.json>
  node scripts/source-media-migration.mjs export --plan <absolute plan.json> --output <absolute receipt.json>
  node scripts/source-media-migration.mjs apply --execute --plan <absolute plan.json> --manifest <absolute manifest.json> --source-root <absolute root> --confirmation media:<digest> --receipt <absolute receipt.json>
  node scripts/source-media-migration.mjs verify --plan <absolute plan.json> --manifest <absolute manifest.json> --receipt <absolute apply receipt.json> --output <absolute receipt.json>
  node scripts/source-media-migration.mjs resume --execute --plan <absolute plan.json> --manifest <absolute manifest.json> --source-root <absolute root> --confirmation media:<digest> --receipt <absolute receipt.json>
  node scripts/source-media-migration.mjs status --manifest <absolute manifest.json>`;
}

function parse(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === "--execute") options.execute = true;
    else if (["--source-root", "--creator-map", "--output", "--environment", "--release-id", "--manifest", "--bucket", "--plan", "--confirmation", "--receipt"].includes(item)) options[item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = rest[++index];
    else if (item === "--help") options.help = true;
    else throw new Error("unknown_option");
  }
  return options;
}

function absolute(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label}_must_be_absolute`);
  return path.resolve(value);
}

function writeNew(file, value) {
  const output = absolute(file, "output");
  if (existsSync(output)) throw new Error("refusing_to_overwrite_evidence");
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return output;
}

function parseJson(file, label) {
  const resolved = absolute(file, label);
  try { return { path: resolved, value: JSON.parse(readFileSync(resolved, "utf8")) }; }
  catch { throw new Error(`${label}_must_be_valid_json`); }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value) { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function fileDigest(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function validCreatorId(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value); }
function validAssetId(value) { return typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value); }
function safeRelative(value) { return typeof value === "string" && value.length > 0 && value.length <= 1024 && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes(".."); }
function resolveSource(rootPath, relativePath) {
  const resolved = path.resolve(rootPath, relativePath);
  if (!resolved.startsWith(`${rootPath}${path.sep}`)) throw new Error("source_path_outside_root");
  return resolved;
}
function checkedMap(input) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.creators) || !input.creators.length) throw new Error("creator_mapping_invalid");
  const creators = input.creators.map((creator) => {
    if (!validCreatorId(creator?.creatorId) || !safeRelative(creator?.sourceFolder) || !Array.isArray(creator.assets) || !creator.assets.length) throw new Error("creator_mapping_invalid");
    const assets = creator.assets.map((asset) => {
      if (!validAssetId(asset?.assetId) || !safeRelative(asset?.relativePath) || (asset.sourceRevision != null && (typeof asset.sourceRevision !== "string" || asset.sourceRevision.length > 240))) throw new Error("creator_mapping_invalid");
      return { assetId: asset.assetId, relativePath: asset.relativePath, sourceRevision: asset.sourceRevision ?? null };
    });
    return { creatorId: creator.creatorId, sourceFolder: creator.sourceFolder, assets };
  });
  const uniqueness = new Set();
  for (const creator of creators) for (const asset of creator.assets) {
    const key = `${creator.creatorId}:${asset.assetId}`;
    if (uniqueness.has(key)) throw new Error("creator_mapping_duplicate_asset");
    uniqueness.add(key);
  }
  return { schemaVersion: 1, creators };
}
async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
function gitIdentity() { return { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]) || "detached", clean: git(["status", "--porcelain"]) === "" }; }
function summary(items) { return items.reduce((total, item) => ({ assets: total.assets + 1, bytes: total.bytes + item.byteCount }), { assets: 0, bytes: 0 }); }

async function inventory(options) {
  const sourceRoot = absolute(options.sourceRoot, "source_root");
  const map = checkedMap(parseJson(options.creatorMap, "creator_map").value);
  const items = [];
  for (const creator of map.creators) for (const asset of creator.assets) {
    const file = resolveSource(sourceRoot, path.join(creator.sourceFolder, asset.relativePath));
    const info = statSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxBytes) throw new Error("source_file_invalid");
    const extension = path.extname(asset.relativePath).slice(1).toLowerCase();
    const mimeType = sourceExtensions.get(extension);
    if (!mimeType) throw new Error("source_media_type_unsupported");
    items.push({ creatorId: creator.creatorId, assetId: asset.assetId, relativePath: path.posix.join(creator.sourceFolder.split(path.sep).join("/"), asset.relativePath.split(path.sep).join("/")), sourceRevision: asset.sourceRevision, filename: path.basename(asset.relativePath), extension, mimeType, byteCount: info.size, sha256: await sha256File(file), objectKey: `originals/v1/${crypto.randomUUID()}` });
  }
  const manifest = { schemaVersion: 1, mode: "INVENTORY", createdAt: new Date().toISOString(), sourceRootLabel: path.basename(sourceRoot), mappingSha256: digest(map), items };
  manifest.manifestSha256 = digest(manifest);
  const output = writeNew(options.output, manifest);
  console.log(JSON.stringify({ mode: manifest.mode, manifest: output, ...summary(items), manifestSha256: manifest.manifestSha256 }, null, 2));
}

function checkedManifest(input) {
  if (input?.schemaVersion !== 1 || input.mode !== "INVENTORY" || !Array.isArray(input.items) || !/^[a-f0-9]{64}$/i.test(input.manifestSha256 ?? "")) throw new Error("manifest_invalid");
  const copy = { ...input }; delete copy.manifestSha256;
  if (digest(copy) !== input.manifestSha256) throw new Error("manifest_digest_invalid");
  for (const item of input.items) {
    if (!validCreatorId(item.creatorId) || !validAssetId(item.assetId) || !safeRelative(item.relativePath) || !safeRelative(item.objectKey) || !sourceExtensions.has(item.extension) || sourceExtensions.get(item.extension) !== item.mimeType || !Number.isSafeInteger(item.byteCount) || item.byteCount <= 0 || item.byteCount > maxBytes || !/^[a-f0-9]{64}$/i.test(item.sha256 ?? "")) throw new Error("manifest_item_invalid");
  }
  return input;
}
function checkedPlan(input) {
  if (input?.schemaVersion !== 1 || input.mode !== "PLAN" || input.environment !== "staging" || !/^[a-f0-9]{64}$/i.test(input.planSha256 ?? "")) throw new Error("plan_invalid");
  const copy = { ...input }; delete copy.planSha256; delete copy.confirmation;
  if (digest(copy) !== input.planSha256 || input.confirmation !== `media:${input.planSha256.slice(0, 16)}`) throw new Error("plan_digest_invalid");
  return input;
}
function plan(options) {
  if (options.environment !== "staging" || !/^[a-z0-9][a-z0-9._-]{2,95}$/i.test(options.releaseId ?? "") || options.bucket !== "thot-os-library-media-staging") throw new Error("staging_plan_required");
  const map = checkedMap(parseJson(options.creatorMap, "creator_map").value);
  const manifestInput = parseJson(options.manifest, "manifest");
  const manifest = checkedManifest(manifestInput.value);
  if (manifest.mappingSha256 !== digest(map)) throw new Error("creator_mapping_changed");
  const gitState = gitIdentity();
  if (!gitState.clean) throw new Error("plan_requires_clean_git");
  const result = { schemaVersion: 1, mode: "PLAN", environment: "staging", releaseId: options.releaseId, bucket: options.bucket, git: gitState, creatorMappingSha256: digest(map), manifestSha256: fileDigest(manifestInput.path), inventorySha256: manifest.manifestSha256, items: manifest.items.map(({ creatorId, assetId, relativePath, objectKey, byteCount, sha256, mimeType, sourceRevision, filename }) => ({ creatorId, assetId, relativePath, objectKey, byteCount, sha256, mimeType, sourceRevision, filename })), createdAt: new Date().toISOString() };
  result.planSha256 = digest(result);
  result.confirmation = `media:${result.planSha256.slice(0, 16)}`;
  const output = writeNew(options.output, result);
  console.log(JSON.stringify({ mode: result.mode, plan: output, ...summary(result.items), planSha256: result.planSha256, confirmation: result.confirmation }, null, 2));
}
function exportPlan(options) {
  const planInput = parseJson(options.plan, "plan");
  const plan = checkedPlan(planInput.value);
  const receipt = { schemaVersion: 1, mode: "READ_ONLY_PLAN_EXPORT", environment: plan.environment, releaseId: plan.releaseId, planSha256: plan.planSha256, planFileSha256: fileDigest(planInput.path), createdAt: new Date().toISOString(), ...summary(plan.items) };
  const output = writeNew(options.output, receipt);
  console.log(JSON.stringify({ mode: receipt.mode, receipt: output, assets: receipt.assets, bytes: receipt.bytes }, null, 2));
}
function currentSourceItems(plan, manifest, sourceRoot) {
  const byKey = new Map(manifest.items.map((item) => [`${item.creatorId}:${item.assetId}`, item]));
  return plan.items.map((item) => {
    const inventory = byKey.get(`${item.creatorId}:${item.assetId}`);
    if (!inventory || inventory.sha256 !== item.sha256 || inventory.objectKey !== item.objectKey) throw new Error("plan_manifest_mismatch");
    const rootFolder = inventory.relativePath.split("/").slice(0, -1).join("/");
    const file = resolveSource(sourceRoot, inventory.relativePath);
    const info = statSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== item.byteCount) throw new Error("source_changed_since_plan");
    return { ...item, file, rootFolder };
  });
}
function sql(value) { return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`; }
function registerVerifiedObject(plan, item) {
  const sqlText = `BEGIN;
INSERT INTO asset_storage_objects
  (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,source_revision,ingest_status,uploaded_at,verified_at)
VALUES (${sql(`r2:${item.creatorId}:${item.assetId}:${item.sha256}`)},${sql(item.creatorId)},${sql(item.assetId)},'r2','canonical_original','library_media',${sql(item.objectKey)},${sql(item.filename)},${Number(item.byteCount)},${sql(item.mimeType)},${sql(item.sha256)},'dropbox',${sql(item.sourceRevision)},'verified',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(creator_id,asset_id,storage_role,sha256) DO UPDATE SET
  object_key=excluded.object_key,byte_count=excluded.byte_count,verified_mime_type=excluded.verified_mime_type,
  ingest_status='verified',verified_at=CURRENT_TIMESTAMP,failure_code=NULL,updated_at=CURRENT_TIMESTAMP;
UPDATE creator_media_source_states SET migration_state='transferring',updated_at=CURRENT_TIMESTAMP WHERE creator_id=${sql(item.creatorId)};
INSERT INTO creator_media_source_events (id,creator_id,asset_id,actor_email,actor_role,event_type,detail)
VALUES (${sql(`migration:${plan.planSha256.slice(0, 16)}:${item.assetId}`)},${sql(item.creatorId)},${sql(item.assetId)},'service:source-media-migration','service','ingest_verified',${sql(JSON.stringify({ releaseId: plan.releaseId, byteCount: item.byteCount, source: "dropbox" }))});
COMMIT;\n`;
  const dir = mkdtempSync(path.join(os.tmpdir(), "creatoros-source-media-d1-"));
  const file = path.join(dir, "register.sql");
  try {
    writeFileSync(file, sqlText, { mode: 0o600 });
    execFileSync(path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler"), ["--cwd", path.join(root, "cloudflare/thot-os-next"), "d1", "execute", "thot-os-staging", "--remote", "--file", file], { cwd: root, stdio: "ignore" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function apply(options) {
  if (!options.execute) throw new Error("apply_requires_execute");
  const planInput = parseJson(options.plan, "plan"); const plan = checkedPlan(planInput.value);
  const manifest = checkedManifest(parseJson(options.manifest, "manifest").value);
  if (options.confirmation !== plan.confirmation) throw new Error("apply_confirmation_invalid");
  const gitState = gitIdentity();
  if (!gitState.clean || gitState.sha !== plan.git.sha || gitState.branch !== plan.git.branch) throw new Error("git_changed_since_plan");
  const sourceRoot = absolute(options.sourceRoot, "source_root");
  const items = currentSourceItems(plan, manifest, sourceRoot);
  const results = [];
  for (const item of items) {
    if (await sha256File(item.file) !== item.sha256) throw new Error("source_checksum_changed_since_plan");
    try {
      // No credentials are supplied to the script. Wrangler uses the existing
      // scoped staging login, and its stdout/stderr stay out of receipts.
      execFileSync(path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler"), ["r2", "object", "put", `${plan.bucket}/${item.objectKey}`, "--file", item.file], { cwd: root, stdio: "ignore" });
      const verifyDir = mkdtempSync(path.join(os.tmpdir(), "creatoros-source-media-apply-"));
      const verifiedFile = path.join(verifyDir, "object");
      try {
        execFileSync(path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler"), ["r2", "object", "get", `${plan.bucket}/${item.objectKey}`, "--file", verifiedFile], { cwd: root, stdio: "ignore" });
        if (statSync(verifiedFile).size !== item.byteCount || await sha256File(verifiedFile) !== item.sha256) throw new Error("r2_object_verification_failed");
      } finally { rmSync(verifyDir, { recursive: true, force: true }); }
      registerVerifiedObject(plan, item);
      results.push({ creatorId: item.creatorId, assetId: item.assetId, objectKey: item.objectKey, status: "registered", byteCount: item.byteCount, sha256: item.sha256 });
    } catch {
      results.push({ creatorId: item.creatorId, assetId: item.assetId, objectKey: item.objectKey, status: "failed" });
    }
  }
  const receipt = { schemaVersion: 1, mode: "STAGING_R2_APPLY", environment: "staging", planSha256: plan.planSha256, createdAt: new Date().toISOString(), results };
  const output = writeNew(options.receipt, receipt);
  console.log(JSON.stringify({ mode: receipt.mode, receipt: output, registered: results.filter((item) => item.status === "registered").length, failed: results.filter((item) => item.status === "failed").length }, null, 2));
}
function status(options) {
  const manifest = checkedManifest(parseJson(options.manifest, "manifest").value);
  console.log(JSON.stringify({ mode: "STATUS", ...summary(manifest.items), manifestSha256: manifest.manifestSha256, creators: new Set(manifest.items.map((item) => item.creatorId)).size }, null, 2));
}
function checkedApplyReceipt(input, plan) {
  if (input?.schemaVersion !== 1 || input.mode !== "STAGING_R2_APPLY" || input.environment !== "staging" || input.planSha256 !== plan.planSha256 || !Array.isArray(input.results)) throw new Error("apply_receipt_invalid");
  return input;
}
async function verify(options) {
  const plan = checkedPlan(parseJson(options.plan, "plan").value);
  const manifest = checkedManifest(parseJson(options.manifest, "manifest").value);
  const receipt = checkedApplyReceipt(parseJson(options.receipt, "apply_receipt").value, plan);
  const manifestByKey = new Map(manifest.items.map((item) => [`${item.creatorId}:${item.assetId}`, item]));
  const uploaded = receipt.results.filter((item) => item?.status === "registered");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "creatoros-r2-verify-"));
  const results = [];
  try {
    for (const item of uploaded) {
      const source = manifestByKey.get(`${item.creatorId}:${item.assetId}`);
      if (!source || source.objectKey !== item.objectKey || source.sha256 !== item.sha256) throw new Error("apply_receipt_manifest_mismatch");
      const file = path.join(temporary, crypto.randomUUID());
      try {
        execFileSync(path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler"), ["r2", "object", "get", `${plan.bucket}/${source.objectKey}`, "--file", file], { cwd: root, stdio: "ignore" });
        const info = statSync(file);
        results.push({ creatorId: source.creatorId, assetId: source.assetId, status: info.size === source.byteCount && await sha256File(file) === source.sha256 ? "verified" : "failed" });
      } catch { results.push({ creatorId: source.creatorId, assetId: source.assetId, status: "failed" }); }
      rmSync(file, { force: true });
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  const output = writeNew(options.output, { schemaVersion: 1, mode: "STAGING_R2_VERIFY", environment: "staging", planSha256: plan.planSha256, createdAt: new Date().toISOString(), results });
  console.log(JSON.stringify({ mode: "STAGING_R2_VERIFY", receipt: output, verified: results.filter((item) => item.status === "verified").length, failed: results.filter((item) => item.status === "failed").length }, null, 2));
}

try {
  const options = parse(process.argv.slice(2));
  if (options.help || !options.command) console.log(usage());
  else if (options.command === "inventory") await inventory(options);
  else if (options.command === "plan") plan(options);
  else if (options.command === "export") exportPlan(options);
  else if (options.command === "apply" || options.command === "resume") await apply(options);
  else if (options.command === "status") status(options);
  else if (options.command === "verify") await verify(options);
  else throw new Error("unknown_command");
} catch (error) {
  // Do not echo source paths, tokens, URLs, or provider diagnostics.
  console.error(`Source-media migration failed: ${error instanceof Error ? error.message.replace(/[\\/].*/g, "") : "unknown_error"}`);
  process.exitCode = 1;
}
