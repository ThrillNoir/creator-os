#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CONCURRENCY, MANIFEST_SCHEMA, STAGING_BUCKET, TOOL_VERSION, aggregateResults, assertApprovedSourceRoot, assertSameAuthority,
  canonicalConfigPath, checkedMap, digest, fileDigest, gitIdentity, hashStableSource, loadAuthority, mapBounded,
  newObjectKey, projectRoot, sourceExtensions, stableJson, validateMediaFile, withRetry, writeOwnerOnlyNew,
  wranglerMutationEnvironment,
} from "./source-media-migration-lib.mjs";
import { createActivationD1ReadClient, runWranglerMutation } from "./service-auth-activate.mjs";

function usage() {
  return `Usage:
  node scripts/source-media-migration.mjs inventory --source-root <absolute root> --creator-map <absolute json> --output <absolute manifest.json>
  node scripts/source-media-migration.mjs plan --environment staging --release-id <id> --creator-map <absolute json> --manifest <absolute manifest.json> --bucket ${STAGING_BUCKET} --output <absolute plan.json>
  node scripts/source-media-migration.mjs export --plan <absolute plan.json> --output <absolute receipt.json>
  node scripts/source-media-migration.mjs apply --execute --plan <absolute plan.json> --manifest <absolute manifest.json> --creator-map <absolute json> --source-root <absolute root> --export-receipt <absolute receipt.json> --confirmation media:<digest> --receipt <absolute receipt.json> [--concurrency 2]
  node scripts/source-media-migration.mjs resume --execute <same apply arguments> --previous-receipt <absolute receipt.json>
  node scripts/source-media-migration.mjs verify --plan <absolute plan.json> --receipt <absolute apply receipt.json> --output <absolute receipt.json>
  node scripts/source-media-migration.mjs status --receipt <absolute receipt.json>`;
}

function parse(argv) {
  const [command, ...rest] = argv; const options = { command };
  const values = new Set(["--source-root", "--creator-map", "--output", "--environment", "--release-id", "--manifest", "--bucket", "--plan", "--confirmation", "--receipt", "--export-receipt", "--previous-receipt", "--concurrency"]);
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === "--execute") options.execute = true;
    else if (values.has(item)) options[item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = rest[++index];
    else if (item === "--help") options.help = true;
    else throw new Error("unknown_option");
  }
  return options;
}
function absolute(value, label) { if (!value || !path.isAbsolute(value)) throw new Error(`${label}_must_be_absolute`); return path.resolve(value); }
function readJson(file, label) { try { const resolved = absolute(file, label); return { path: resolved, value: JSON.parse(readFileSync(resolved, "utf8")) }; } catch { throw new Error(`${label}_must_be_valid_json`); } }
function summary(items) { return items.reduce((total, item) => ({ assets: total.assets + 1, bytes: total.bytes + item.byteCount }), { assets: 0, bytes: 0 }); }

function checkedManifest(input) {
  if (input?.schemaVersion !== MANIFEST_SCHEMA || input.mode !== "INVENTORY" || !Array.isArray(input.items) || !/^[a-f0-9]{64}$/.test(input.manifestSha256 ?? "")) throw new Error("manifest_invalid");
  const copy = { ...input }; delete copy.manifestSha256; if (digest(copy) !== input.manifestSha256) throw new Error("manifest_digest_invalid");
  for (const item of input.items) if (!item.relativePath || !item.identitySha256 || !item.sha256 || !item.objectKey.startsWith("originals/v2/") || !sourceExtensions.has(item.extension) || sourceExtensions.get(item.extension) !== item.mimeType) throw new Error("manifest_item_invalid");
  return input;
}
function checkedPlan(input) {
  if (input?.schemaVersion !== 2 || input.mode !== "PLAN" || input.environment !== "staging" || input.bucket !== STAGING_BUCKET || input.toolVersion !== TOOL_VERSION || !/^[a-f0-9]{64}$/.test(input.planSha256 ?? "")) throw new Error("plan_invalid");
  if (input.catalogue?.schemaVersion !== 1 || !Array.isArray(input.catalogue.rows) || digest(input.catalogue.rows) !== input.catalogue.sha256) throw new Error("plan_catalogue_invalid");
  const copy = { ...input }; delete copy.planSha256; delete copy.confirmation;
  if (digest(copy) !== input.planSha256 || input.confirmation !== `media:${input.planSha256.slice(0, 16)}`) throw new Error("plan_digest_invalid");
  return input;
}

async function inventory(options) {
  const sourceRoot = assertApprovedSourceRoot(absolute(options.sourceRoot, "source_root")); const mappingInput = readJson(options.creatorMap, "creator_map"); const mapping = checkedMap(mappingInput.value); const items = [];
  for (const creator of mapping.creators) for (const asset of creator.assets) {
    const relativePath = path.posix.join(creator.sourceFolder.split(path.sep).join("/"), asset.relativePath.split(path.sep).join("/"));
    const extension = path.extname(relativePath).slice(1).toLowerCase(); const expectedMime = sourceExtensions.get(extension);
    if (!expectedMime) throw new Error("source_media_type_unsupported");
    const source = await hashStableSource(sourceRoot, relativePath); const media = await validateMediaFile(source.bytes, expectedMime);
    items.push({ creatorId: creator.creatorId, assetId: asset.assetId, relativePath, sourceRevision: asset.sourceRevision, filename: path.basename(relativePath), extension, mimeType: media.mimeType, width: media.width ?? null, height: media.height ?? null, byteCount: source.byteCount, sha256: source.sha256, identitySha256: source.identitySha256, objectKey: newObjectKey() });
  }
  const manifest = { schemaVersion: MANIFEST_SCHEMA, toolVersion: TOOL_VERSION, mode: "INVENTORY", createdAt: new Date().toISOString(), sourceRootLabel: path.basename(sourceRoot), creatorMappingSha256: fileDigest(mappingInput.path), creatorMappingCanonicalSha256: digest(mapping), items };
  manifest.manifestSha256 = digest(manifest); writeOwnerOnlyNew(options.output, manifest);
  console.log(JSON.stringify({ mode: manifest.mode, ...summary(items), manifestSha256: manifest.manifestSha256 }, null, 2));
}

async function plan(options) {
  if (options.environment !== "staging" || options.bucket !== STAGING_BUCKET || !/^[a-z0-9][a-z0-9._-]{2,95}$/i.test(options.releaseId ?? "")) throw new Error("staging_plan_required");
  const mappingInput = readJson(options.creatorMap, "creator_map"); const mapping = checkedMap(mappingInput.value); const manifestInput = readJson(options.manifest, "manifest"); const manifest = checkedManifest(manifestInput.value);
  if (manifest.creatorMappingSha256 !== fileDigest(mappingInput.path) || manifest.creatorMappingCanonicalSha256 !== digest(mapping)) throw new Error("creator_mapping_changed");
  const git = gitIdentity(); if (!git.clean) throw new Error("plan_requires_clean_git");
  const d1Client = createActivationD1ReadClient(); const authority = await loadAuthority(d1Client);
  const catalogue = await loadCatalogueEvidence(d1Client, authority, mapping, manifest);
  const result = { schemaVersion: 2, toolVersion: TOOL_VERSION, mode: "PLAN", environment: "staging", releaseId: options.releaseId, bucket: STAGING_BUCKET, authority, catalogue, git, creatorMappingSha256: fileDigest(mappingInput.path), creatorMappingCanonicalSha256: digest(mapping), manifestFileSha256: fileDigest(manifestInput.path), inventorySha256: manifest.manifestSha256, items: manifest.items, createdAt: new Date().toISOString() };
  result.planSha256 = digest(result); result.confirmation = `media:${result.planSha256.slice(0, 16)}`; writeOwnerOnlyNew(options.output, result);
  console.log(JSON.stringify({ mode: result.mode, ...summary(result.items), planSha256: result.planSha256, confirmation: result.confirmation }, null, 2));
}

function exportPlan(options) {
  const input = readJson(options.plan, "plan"); const planValue = checkedPlan(input.value);
  const receipt = { schemaVersion: 2, toolVersion: TOOL_VERSION, mode: "READ_ONLY_PLAN_EXPORT", environment: "staging", planSha256: planValue.planSha256, planFileSha256: fileDigest(input.path), createdAt: new Date().toISOString(), ...summary(planValue.items) };
  writeOwnerOnlyNew(options.output, receipt); console.log(JSON.stringify({ mode: receipt.mode, assets: receipt.assets, bytes: receipt.bytes }, null, 2));
}

function readExportReceipt(file, planValue, planPath) {
  const receipt = readJson(file, "export_receipt").value;
  if (receipt?.schemaVersion !== 2 || receipt.mode !== "READ_ONLY_PLAN_EXPORT" || receipt.planSha256 !== planValue.planSha256 || receipt.planFileSha256 !== fileDigest(planPath)) throw new Error("plan_export_receipt_invalid");
  return receipt;
}

function oauthToken() {
  const wrangler = path.join(projectRoot, "cloudflare/thot-os-next/node_modules/.bin/wrangler");
  const output = execFileSync(wrangler, ["auth", "token", "--json"], { cwd: projectRoot, encoding: "utf8", env: wranglerMutationEnvironment(loadRegistryAccount()), stdio: ["ignore", "pipe", "pipe"] });
  let parsed; try { parsed = JSON.parse(output); } catch { throw new Error("r2_oauth_token_unavailable"); }
  const candidate = parsed?.token ?? parsed?.value ?? parsed?.api_token;
  if (!candidate) throw new Error("r2_oauth_token_unavailable"); return candidate;
}
function loadRegistryAccount() { return JSON.parse(readFileSync(path.join(projectRoot, "config/deployments.json"), "utf8")).environments.staging.accountId; }
function objectUrl(authority, key) { return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(authority.accountId)}/r2/buckets/${encodeURIComponent(authority.bucket)}/objects/${encodeURIComponent(key)}`; }
function immutableIdentity(response, body = null) {
  const etag = body?.result?.etag ?? response.headers.get("etag"); const version = body?.result?.version ?? response.headers.get("cf-r2-version") ?? response.headers.get("x-amz-version-id");
  if (!etag || !version) throw Object.assign(new Error("r2_immutable_identity_unavailable"), { code: "UNCERTAIN" }); return { etag: etag.replace(/^\"|\"$/g, ""), version };
}
async function inspectR2(authority, key, token, hashBody = false) {
  const response = await fetch(objectUrl(authority, key), { headers: { authorization: `Bearer ${token}`, ...(hashBody ? {} : { range: "bytes=0-0" }) } });
  if (response.status === 404) return null; if (!response.ok || !response.body) throw Object.assign(new Error("r2_inspection_failed"), { status: response.status });
  const id = immutableIdentity(response); if (!hashBody) return { ...id, byteCount: Number(response.headers.get("content-range")?.split("/")[1] ?? response.headers.get("content-length")) };
  const hash = createHash("sha256"); let bytes = 0; for await (const chunk of response.body) { bytes += chunk.byteLength; hash.update(chunk); }
  return { ...id, byteCount: bytes, sha256: hash.digest("hex") };
}
async function uploadR2(authority, item, bytes, token) {
  const response = await fetch(objectUrl(authority, item.objectKey), { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": item.mimeType, "content-length": String(item.byteCount), "x-creatoros-sha256": item.sha256, "if-none-match": "*" }, body: bytes });
  if (!response.ok) throw Object.assign(new Error("r2_upload_failed"), { status: response.status });
  let payload = null; try { payload = await response.clone().json(); } catch { /* Object API may return an empty body. */ }
  return immutableIdentity(response, payload);
}
async function uploadOrReconcileR2(authority, item, bytes, token) {
  try { return await uploadR2(authority, item, bytes, token); }
  catch (error) {
    let observed;
    try { observed = await inspectR2(authority, item.objectKey, token, true); }
    catch { throw Object.assign(new Error("r2_upload_uncertain"), { code: "UNCERTAIN" }); }
    if (observed && observed.byteCount === item.byteCount && observed.sha256 === item.sha256) return observed;
    if (observed) throw new Error("r2_object_collision");
    throw error;
  }
}
function sql(value) { return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`; }
function register(authority, planValue, item, identity) {
  const statement = `INSERT INTO asset_storage_objects (id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,source_revision,ingest_status,r2_version,r2_etag,uploaded_at,verified_at) VALUES (${sql(`r2:${item.creatorId}:${item.assetId}:${item.sha256}`)},${sql(item.creatorId)},${sql(item.assetId)},'r2','canonical_original','library_media',${sql(item.objectKey)},${sql(item.filename)},${item.byteCount},${sql(item.mimeType)},${sql(item.sha256)},'dropbox',${sql(item.sourceRevision)},'verified',${sql(identity.version)},${sql(identity.etag)},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(creator_id,asset_id,storage_role,sha256) DO NOTHING;\nINSERT OR IGNORE INTO creator_media_source_events (id,creator_id,asset_id,actor_email,actor_role,event_type,detail) VALUES (${sql(`migration:${planValue.planSha256.slice(0, 16)}:${item.assetId}`)},${sql(item.creatorId)},${sql(item.assetId)},'service:source-media-migration','service','ingest_verified',${sql(JSON.stringify({ releaseId: planValue.releaseId, byteCount: item.byteCount, source: "dropbox" }))});`;
  const registry = JSON.parse(readFileSync(path.join(projectRoot, "config/deployments.json"), "utf8"));
  const temporary = mkdtempSync(path.join(os.tmpdir(), "creatoros-d1-registration-")); chmodSync(temporary, 0o700); const sqlFile = path.join(temporary, "registration.sql");
  try {
    writeFileSync(sqlFile, statement, { mode: 0o600, flag: "wx" });
    runWranglerMutation(["--config", canonicalConfigPath, "d1", "execute", authority.databaseName, "--remote", "--file", sqlFile], registry, { operation: "source-media-registration" });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function target(authority) { return { accountId: authority.accountId, databaseId: authority.databaseId, databaseName: authority.databaseName }; }

async function loadCatalogueEvidence(client, authority, mapping, manifest) {
  const manifestByAsset = new Map(manifest.items.map((item) => [`${item.creatorId}:${item.assetId}`, item])); const rows = [];
  const mappedCount = mapping.creators.reduce((count, creator) => count + creator.assets.length, 0);
  if (manifestByAsset.size !== manifest.items.length || manifest.items.length !== mappedCount) throw new Error("catalogue_mapping_mismatch");
  for (const creator of mapping.creators) for (const mapped of creator.assets) {
    const result = await client.queryReadOnly(target(authority), `SELECT a.id,a.creator_id,a.relative_path,a.basename,a.extension,a.bytes,a.dropbox_revision,a.source_available
      FROM assets a WHERE a.id=? AND a.creator_id=?`, [mapped.assetId, creator.creatorId]);
    const row = result.rows[0]; const planned = manifestByAsset.get(`${creator.creatorId}:${mapped.assetId}`);
    const expectedLocalPath = path.posix.join(creator.sourceFolder.split(path.sep).join("/"), mapped.relativePath.split(path.sep).join("/"));
    if (result.rows.length !== 1 || !planned || row.source_available !== 1 || row.relative_path !== mapped.relativePath || row.dropbox_revision !== mapped.sourceRevision || planned.sourceRevision !== mapped.sourceRevision || planned.relativePath !== expectedLocalPath || row.basename !== planned.filename || Number(row.bytes) !== planned.byteCount || String(row.extension).toLowerCase() !== planned.extension) throw new Error("catalogue_mapping_mismatch");
    rows.push({ creatorId: creator.creatorId, assetId: mapped.assetId, relativePath: row.relative_path, sourceRevision: row.dropbox_revision, byteCount: Number(row.bytes) });
  }
  rows.sort((left, right) => `${left.creatorId}:${left.assetId}`.localeCompare(`${right.creatorId}:${right.assetId}`));
  return { schemaVersion: 1, rows, sha256: digest(rows) };
}

async function identicalD1(client, authority, item, identity) {
  const target = { accountId: authority.accountId, databaseId: authority.databaseId, databaseName: authority.databaseName };
  const result = await client.queryReadOnly(target, "SELECT object_key,byte_count,verified_mime_type,sha256,r2_version,r2_etag,ingest_status FROM asset_storage_objects WHERE creator_id=? AND asset_id=? AND storage_role='canonical_original' AND sha256=?", [item.creatorId, item.assetId, item.sha256]);
  return result.rows.some((row) => row.object_key === item.objectKey && row.byte_count === item.byteCount && row.verified_mime_type === item.mimeType && row.r2_version === identity.version && row.r2_etag === identity.etag && row.ingest_status === "verified");
}

async function existingD1Records(client, authority, item) {
  const target = { accountId: authority.accountId, databaseId: authority.databaseId, databaseName: authority.databaseName };
  return (await client.queryReadOnly(target, "SELECT object_key,byte_count,verified_mime_type,sha256,r2_version,r2_etag,ingest_status FROM asset_storage_objects WHERE creator_id=? AND asset_id=? AND storage_role='canonical_original' AND sha256=?", [item.creatorId, item.assetId, item.sha256])).rows;
}

async function apply(options, resume = false) {
  if (!options.execute) throw new Error("apply_requires_execute");
  const planInput = readJson(options.plan, "plan"); const planValue = checkedPlan(planInput.value); const manifestInput = readJson(options.manifest, "manifest"); const manifest = checkedManifest(manifestInput.value); const mappingInput = readJson(options.creatorMap, "creator_map"); const mapping = checkedMap(mappingInput.value);
  readExportReceipt(options.exportReceipt, planValue, planInput.path);
  if (options.confirmation !== planValue.confirmation || fileDigest(manifestInput.path) !== planValue.manifestFileSha256 || manifest.manifestSha256 !== planValue.inventorySha256 || fileDigest(mappingInput.path) !== planValue.creatorMappingSha256 || digest(mapping) !== planValue.creatorMappingCanonicalSha256) throw new Error("apply_evidence_changed");
  const git = gitIdentity(); if (!git.clean || stableJson(git) !== stableJson(planValue.git)) throw new Error("git_changed_since_plan");
  const d1Client = createActivationD1ReadClient(); const currentAuthority = await loadAuthority(d1Client); assertSameAuthority(planValue.authority, currentAuthority);
  const currentCatalogue = await loadCatalogueEvidence(d1Client, currentAuthority, mapping, manifest); if (stableJson(currentCatalogue) !== stableJson(planValue.catalogue)) throw new Error("catalogue_changed_since_plan");
  const previous = resume ? readJson(options.previousReceipt, "previous_receipt").value : null;
  if (resume && (previous?.planSha256 !== planValue.planSha256 || !Array.isArray(previous.results))) throw new Error("resume_receipt_invalid");
  if (resume) assertReceiptCoverage(previous.results, planValue.items, true);
  const items = planValue.items; const concurrency = Number(options.concurrency ?? DEFAULT_CONCURRENCY);
  const token = oauthToken(); const sourceRoot = assertApprovedSourceRoot(absolute(options.sourceRoot, "source_root"));
  const continuation = await mapBounded(items, concurrency, async (item) => {
    const safe = { creatorId: item.creatorId, assetId: item.assetId, byteCount: item.byteCount, status: "uncertain" };
    try {
      const source = await hashStableSource(sourceRoot, item.relativePath, item.identitySha256); if (source.sha256 !== item.sha256 || source.byteCount !== item.byteCount) throw new Error("source_changed_since_plan");
      const media = await validateMediaFile(source.bytes, item.mimeType); if (media.mimeType !== item.mimeType) throw new Error("source_media_type_mismatch");
      const d1Before = await existingD1Records(d1Client, currentAuthority, item);
      const existing = await withRetry(() => inspectR2(currentAuthority, item.objectKey, token, true));
      if (existing) {
        if (existing.byteCount !== item.byteCount || existing.sha256 !== item.sha256) throw new Error("r2_object_collision");
        if (!await identicalD1(d1Client, currentAuthority, item, existing)) {
          if (d1Before.length) throw new Error("r2_object_collision");
          register(currentAuthority, planValue, item, existing);
          if (!await identicalD1(d1Client, currentAuthority, item, existing)) throw Object.assign(new Error("d1_registration_uncertain"), { code: "UNCERTAIN" });
        }
        return { ...safe, status: "skipped", r2Version: existing.version, r2Etag: existing.etag };
      }
      if (d1Before.length) throw new Error("d1_object_collision_or_missing_r2");
      await withRetry(() => uploadOrReconcileR2(currentAuthority, item, source.bytes, token));
      const verified = await withRetry(() => inspectR2(currentAuthority, item.objectKey, token, true));
      if (!verified || verified.byteCount !== item.byteCount || verified.sha256 !== item.sha256) throw Object.assign(new Error("r2_verification_failed"), { code: "UNCERTAIN" });
      register(currentAuthority, planValue, item, verified);
      if (!await identicalD1(d1Client, currentAuthority, item, verified)) throw Object.assign(new Error("d1_registration_uncertain"), { code: "UNCERTAIN" });
      return { ...safe, status: "verified", r2Version: verified.version, r2Etag: verified.etag };
    } catch (error) { const message = String(error?.message ?? "migration_failed"); return { ...safe, status: error?.code === "UNCERTAIN" || error?.status >= 500 ? "uncertain" : "failed", failure: /^[a-z0-9_]{1,120}$/i.test(message) ? message : "migration_failed" }; }
  });
  const latest = new Map((previous?.results ?? []).map((item) => [`${item.creatorId}:${item.assetId}`, item])); for (const item of continuation) latest.set(`${item.creatorId}:${item.assetId}`, item);
  const results = planValue.items.map((item) => latest.get(`${item.creatorId}:${item.assetId}`)).filter(Boolean); const aggregate = aggregateResults(results);
  const receipt = { schemaVersion: 2, toolVersion: TOOL_VERSION, mode: resume ? "STAGING_R2_RESUME" : "STAGING_R2_APPLY", environment: "staging", planSha256: planValue.planSha256, previousReceiptSha256: previous ? fileDigest(absolute(options.previousReceipt, "previous_receipt")) : null, createdAt: new Date().toISOString(), results, ...aggregate };
  writeOwnerOnlyNew(options.receipt, receipt); console.log(JSON.stringify({ mode: receipt.mode, counts: receipt.counts }, null, 2));
  if (receipt.counts.failed || receipt.counts.uncertain) process.exitCode = 1;
}

async function verify(options) {
  const planValue = checkedPlan(readJson(options.plan, "plan").value); const receipt = readJson(options.receipt, "apply_receipt").value;
  if (receipt?.planSha256 !== planValue.planSha256 || !Array.isArray(receipt.results)) throw new Error("apply_receipt_invalid");
  assertReceiptCoverage(receipt.results, planValue.items, false);
  const d1Client = createActivationD1ReadClient(); const authority = await loadAuthority(d1Client); assertSameAuthority(planValue.authority, authority); const token = oauthToken(); const results = [];
  for (const planned of planValue.items) {
    const item = receipt.results.find((entry) => entry.creatorId === planned.creatorId && entry.assetId === planned.assetId); const observed = await inspectR2(authority, planned.objectKey, token, true);
    const valid = observed && observed.byteCount === planned.byteCount && observed.sha256 === planned.sha256 && observed.version === item.r2Version && observed.etag === item.r2Etag && await identicalD1(d1Client, authority, planned, observed);
    results.push({ creatorId: planned.creatorId, assetId: planned.assetId, byteCount: planned.byteCount, status: valid ? "verified" : "failed" });
  }
  const output = { schemaVersion: 2, toolVersion: TOOL_VERSION, mode: "STAGING_R2_VERIFY", environment: "staging", planSha256: planValue.planSha256, createdAt: new Date().toISOString(), results, ...aggregateResults(results) };
  writeOwnerOnlyNew(options.output, output); console.log(JSON.stringify({ mode: output.mode, counts: output.counts }, null, 2)); if (output.counts.failed || output.counts.uncertain) process.exitCode = 1;
}

function assertReceiptCoverage(results, planItems, allowRetryable) {
  const planned = new Set(planItems.map((item) => `${item.creatorId}:${item.assetId}`)); const seen = new Set();
  for (const item of results) {
    const key = `${item?.creatorId}:${item?.assetId}`;
    if (!planned.has(key) || seen.has(key) || !Number.isSafeInteger(item?.byteCount) || !["verified", "skipped", ...(allowRetryable ? ["failed", "uncertain"] : [])].includes(item?.status)) throw new Error("apply_receipt_invalid");
    if (["verified", "skipped"].includes(item.status) && (typeof item.r2Version !== "string" || !item.r2Version || typeof item.r2Etag !== "string" || !item.r2Etag)) throw new Error("apply_receipt_invalid");
    seen.add(key);
  }
  if (!allowRetryable && seen.size !== planned.size) throw new Error("apply_receipt_incomplete");
}

function status(options) { const receipt = readJson(options.receipt, "receipt").value; if (!receipt?.counts || !Array.isArray(receipt.results)) throw new Error("receipt_invalid"); console.log(JSON.stringify({ mode: "STATUS", counts: receipt.counts, creators: receipt.creators }, null, 2)); }

try {
  const options = parse(process.argv.slice(2));
  if (options.help || !options.command) console.log(usage());
  else if (options.command === "inventory") await inventory(options);
  else if (options.command === "plan") await plan(options);
  else if (options.command === "export") exportPlan(options);
  else if (options.command === "apply") await apply(options, false);
  else if (options.command === "resume") await apply(options, true);
  else if (options.command === "verify") await verify(options);
  else if (options.command === "status") status(options);
  else throw new Error("unknown_command");
} catch (error) {
  const raw = error instanceof Error ? error.message : "unknown_error";
  const safe = /^[a-z0-9_]{1,120}$/i.test(raw) ? raw : "operation_failed";
  console.error(`Source-media migration failed: ${safe}`); process.exitCode = 1;
}
