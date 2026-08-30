import { createHash, randomUUID } from "node:crypto";
import { chmodSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, closeSync, fstatSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createActivationD1ReadClient, mutationWranglerEnvironment } from "./service-auth-activate.mjs";
import { readDeploymentRegistry, readJsoncFile } from "./deployment-preflight.mjs";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TOOL_VERSION = "creatoros-source-media-migration/2";
export const MANIFEST_SCHEMA = 2;
// The offline adapter uses one conditional R2 Object API PUT. Keep its ceiling
// at the single-request limit; direct ingestion uses bounded multipart uploads.
// The offline adapter deliberately supports only fully decoded still images.
// Keeping the complete, descriptor-pinned payload in memory lets validation,
// hashing, and upload operate on the exact same bytes with no pathname reopen.
export const MAX_MEDIA_BYTES = 64 * 1024 ** 2;
export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 4;
export const STAGING_BUCKET = "thot-os-library-media-staging";
export const APPROVED_SOURCE_ROOT = path.join(homedir(), "Library/CloudStorage/Dropbox/1 THRILL NOIR/# PHOTOS OPTIMISED");
export const canonicalConfigPath = path.join(projectRoot, "cloudflare/thot-os-next/wrangler.jsonc");
export const registryPath = path.join(projectRoot, "config/deployments.json");
export const stagingLedgerPath = path.join(projectRoot, "config/staging-d1-migration-ledger.json");

export const sourceExtensions = new Map([["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"], ["heic", "image/heic"]]);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function digest(value) { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
export function fileDigest(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
export function safeRelative(value) { return typeof value === "string" && value.length > 0 && value.length <= 1024 && !path.isAbsolute(value) && !value.split(/[\\/]+/).some((part) => part === "" || part === "." || part === ".."); }

export function assertApprovedSourceRoot(rootInput, approvedRoot = APPROVED_SOURCE_ROOT) {
  if (!path.isAbsolute(rootInput) || path.resolve(rootInput) !== path.resolve(approvedRoot)) throw new Error("source_root_not_authorized");
  return path.resolve(rootInput);
}

function strictBelow(rootPath, candidate) {
  const relative = path.relative(rootPath, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function identity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtimeNs: String(stat.mtimeNs) };
}

export function secureSourcePath(rootInput, relativePath) {
  if (!path.isAbsolute(rootInput) || !safeRelative(relativePath)) throw new Error("source_path_invalid");
  const rootLexical = path.resolve(rootInput);
  const rootLstat = lstatSync(rootLexical, { bigint: true });
  if (!rootLstat.isDirectory() || rootLstat.isSymbolicLink()) throw new Error("source_root_invalid");
  const rootReal = realpathSync.native(rootLexical);
  let lexical = rootLexical;
  for (const component of relativePath.split(/[\\/]+/)) {
    lexical = path.join(lexical, component);
    const item = lstatSync(lexical, { bigint: true });
    if (item.isSymbolicLink()) throw new Error("source_symlink_rejected");
    if (item.dev !== rootLstat.dev) throw new Error("source_mount_rejected");
  }
  const real = realpathSync.native(lexical);
  if (!strictBelow(rootReal, real)) throw new Error("source_path_outside_root");
  const descriptor = openSync(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.size <= 0n || opened.size > BigInt(MAX_MEDIA_BYTES)) throw new Error("source_file_invalid");
    const finalLstat = lstatSync(lexical, { bigint: true });
    if (finalLstat.isSymbolicLink() || finalLstat.dev !== opened.dev || finalLstat.ino !== opened.ino) throw new Error("source_replaced_during_open");
    return { rootReal, real, identity: identity(opened), identitySha256: digest({ relativePath: relativePath.split(path.sep).join("/"), ...identity(opened) }) };
  } finally { closeSync(descriptor); }
}

export async function hashStableSource(rootInput, relativePath, expectedIdentitySha256 = null) {
  const opened = secureSourcePath(rootInput, relativePath);
  if (expectedIdentitySha256 && opened.identitySha256 !== expectedIdentitySha256) throw new Error("source_changed_since_inventory");
  const handle = await open(opened.real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    const beforeIdentity = digest({ relativePath: relativePath.split(path.sep).join("/"), ...identity(before) });
    if (beforeIdentity !== opened.identitySha256) throw new Error("source_replaced_during_open");
    const hash = createHash("sha256"); const chunks = [];
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) { hash.update(chunk); chunks.push(chunk); }
    const after = await handle.stat({ bigint: true });
    if (digest({ relativePath: relativePath.split(path.sep).join("/"), ...identity(after) }) !== beforeIdentity) throw new Error("source_changed_during_read");
    return { ...opened, sha256: hash.digest("hex"), byteCount: Number(after.size), bytes: Buffer.concat(chunks, Number(after.size)) };
  } finally { await handle.close(); }
}

function isoBrand(bytes) {
  if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") return "";
  const brands = [];
  for (let i = 8; i + 4 <= Math.min(bytes.length, 64); i += 4) brands.push(bytes.toString("ascii", i, i + 4).toLowerCase());
  if (brands.includes("qt  ")) return "video/quicktime";
  if (brands.some((brand) => ["isom", "iso2", "avc1", "mp41", "mp42", "mp4v"].includes(brand))) return "video/mp4";
  if (brands.some((brand) => ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand))) return "image/heic";
  return "";
}

export async function validateVideoContainer(file, expectedMime) {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    let offset = 0; let boxes = 0; let sawFtyp = false; let sawMoov = false; let sawMeta = false; let sawMdat = false;
    const header = Buffer.alloc(16);
    while (offset < stat.size) {
      const first = await handle.read(header, 0, 8, offset);
      if (first.bytesRead !== 8) throw new Error("source_media_container_invalid");
      const size32 = header.readUInt32BE(0); const type = header.toString("ascii", 4, 8);
      const headerBytes = size32 === 1 ? 16 : 8;
      if (headerBytes === 16 && (await handle.read(header, 8, 8, offset + 8)).bytesRead !== 8) throw new Error("source_media_container_invalid");
      const size = size32 === 1 ? Number(header.readBigUInt64BE(8)) : size32 === 0 ? stat.size - offset : size32;
      if (!Number.isSafeInteger(size) || size < headerBytes || offset + size > stat.size || !/^[\x20-\x7e]{4}$/.test(type)) throw new Error("source_media_container_invalid");
      if (boxes === 0 && type !== "ftyp") throw new Error("source_media_container_invalid");
      if (type === "ftyp") { sawFtyp = true; const probe = Buffer.alloc(Math.min(size, 64)); await handle.read(probe, 0, probe.length, offset); if (isoBrand(probe) !== expectedMime) throw new Error("source_media_type_mismatch"); }
      if (type === "moov") { if (size > 256 * 1024 * 1024) throw new Error("source_media_metadata_too_large"); sawMoov = true; }
      if (type === "meta") { if (size > 256 * 1024 * 1024) throw new Error("source_media_metadata_too_large"); sawMeta = true; }
      if (type === "mdat") sawMdat = true;
      boxes += 1; if (boxes > 100_000) throw new Error("source_media_container_invalid");
      offset += size;
    }
    if (offset !== stat.size || !sawFtyp || !sawMdat || (expectedMime.startsWith("video/") ? !sawMoov : !sawMeta)) throw new Error("source_media_container_invalid");
    return { mimeType: expectedMime, boxes };
  } finally { await handle.close(); }
}

export async function validateMediaFile(fileOrBytes, expectedMime, loadSharp = async () => (await import(path.join(projectRoot, "cloudflare/thot-os-next/node_modules/sharp/dist/index.mjs"))).default) {
  if (!expectedMime.startsWith("image/")) throw new Error("source_media_decoder_required");
  if (expectedMime === "image/heic" && typeof fileOrBytes === "string") await validateVideoContainer(fileOrBytes, expectedMime);
  const sharp = await loadSharp();
  let metadata;
  try { metadata = await sharp(fileOrBytes, { failOn: "error", limitInputPixels: 100_000_000, sequentialRead: true }).metadata(); }
  catch { throw new Error("source_media_image_invalid"); }
  const formatMime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heif: "image/heic" }[metadata.format];
  if (formatMime !== expectedMime || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 || metadata.width > 12_000 || metadata.height > 12_000 || metadata.width * metadata.height > 100_000_000 || (metadata.pages ?? 1) !== 1) throw new Error("source_media_image_invalid");
  if (expectedMime !== "image/heic") {
    const handle = typeof fileOrBytes === "string" ? await open(fileOrBytes, "r") : null;
    try {
      const statSize = handle ? Number((await handle.stat()).size) : fileOrBytes.length;
      const first = handle ? Buffer.alloc(Math.min(16, statSize)) : fileOrBytes.subarray(0, Math.min(16, statSize));
      const last = handle ? Buffer.alloc(Math.min(32, statSize)) : fileOrBytes.subarray(Math.max(0, statSize - 32));
      if (handle) { await handle.read(first, 0, first.length, 0); await handle.read(last, 0, last.length, statSize - last.length); }
      if (expectedMime === "image/jpeg" && !(last.at(-2) === 0xff && last.at(-1) === 0xd9)) throw new Error("source_media_image_invalid");
      const pngEnd = Buffer.from("0000000049454e44ae426082", "hex"); if (expectedMime === "image/png" && !last.subarray(last.length - pngEnd.length).equals(pngEnd)) throw new Error("source_media_image_invalid");
      if (expectedMime === "image/webp" && (first.length < 12 || first.readUInt32LE(4) + 8 !== statSize)) throw new Error("source_media_image_invalid");
    } finally { if (handle) await handle.close(); }
  }
  return { mimeType: formatMime, width: metadata.width, height: metadata.height };
}

export function checkedMap(input) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.creators) || !input.creators.length) throw new Error("creator_mapping_invalid");
  const seen = new Set();
  const creators = input.creators.map((creator) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(creator?.creatorId ?? "") || !safeRelative(creator?.sourceFolder) || !Array.isArray(creator.assets) || !creator.assets.length) throw new Error("creator_mapping_invalid");
    return { creatorId: creator.creatorId, sourceFolder: creator.sourceFolder, assets: creator.assets.map((asset) => {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(asset?.assetId ?? "") || !safeRelative(asset?.relativePath) || typeof asset?.sourceRevision !== "string" || !asset.sourceRevision || asset.sourceRevision.length > 240) throw new Error("creator_mapping_invalid");
      const key = `${creator.creatorId}:${asset.assetId}`; if (seen.has(key)) throw new Error("creator_mapping_duplicate_asset"); seen.add(key);
      return { assetId: asset.assetId, relativePath: asset.relativePath, sourceRevision: asset.sourceRevision };
    }) };
  });
  return { schemaVersion: 1, creators };
}

export function gitIdentity() {
  const git = (args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  return { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]) || "detached", clean: git(["status", "--porcelain"]) === "" };
}

export function writeOwnerOnlyNew(file, value) {
  if (!file || !path.isAbsolute(file) || existsSync(file)) throw new Error("refusing_to_overwrite_evidence");
  const directory = path.dirname(file); const created = mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (created) chmodSync(created, 0o700);
  const directoryInfo = lstatSync(directory); if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (statSync(directory).mode & 0o077) !== 0) throw new Error("evidence_directory_must_be_owner_only");
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

export async function loadAuthority(d1Client = createActivationD1ReadClient()) {
  const registry = readDeploymentRegistry(registryPath); const config = readJsoncFile(canonicalConfigPath);
  const environment = registry.environments?.staging; const d1 = config.d1_databases?.find((item) => item.binding === "DB");
  const library = config.r2_buckets?.find((item) => item.binding === "LIBRARY_MEDIA"); const registered = environment?.resources?.d1?.[d1?.database_name];
  if (!environment || config.account_id !== environment.accountId || !d1 || !registered || d1.database_id !== registered.id || library?.bucket_name !== STAGING_BUCKET || !environment.resources.r2.includes(STAGING_BUCKET)) throw new Error("staging_authority_inconsistent");
  const target = { accountId: environment.accountId, databaseId: d1.database_id, databaseName: d1.database_name };
  const verifiedTarget = await d1Client.verifyTarget(target);
  if (verifiedTarget.databaseId !== target.databaseId || verifiedTarget.databaseName !== target.databaseName || verifiedTarget.accountId !== target.accountId) throw new Error("staging_database_identity_changed");
  const remoteMigrations = await d1Client.readMigrationHistory(target);
  const ledger = JSON.parse(readFileSync(stagingLedgerPath, "utf8"));
  const ledgerNames = Array.isArray(ledger.migrations) ? ledger.migrations.map((entry) => entry.name) : [];
  const hardening = ledger.migrations?.find((entry) => entry.name === "0051_r2_source_media_hardening.sql");
  if (ledger.environment !== "staging" || ledger.databaseId !== target.databaseId || ledgerNames.length !== remoteMigrations.length || ledgerNames.some((name, index) => name !== remoteMigrations[index]) || !Number.isInteger(hardening?.remoteId)) throw new Error("source_media_schema_not_applied");
  return {
    toolVersion: TOOL_VERSION, accountId: target.accountId, databaseId: target.databaseId, databaseName: target.databaseName,
    bucket: STAGING_BUCKET, registrySha256: fileDigest(registryPath), configSha256: fileDigest(canonicalConfigPath),
    reviewedLedgerSha256: fileDigest(stagingLedgerPath), remoteMigrations, remoteMigrationSha256: digest(remoteMigrations),
    reviewedLedgerEnvironment: ledger.environment,
  };
}

export function assertSameAuthority(expected, actual) {
  if (stableJson(expected) !== stableJson(actual)) throw new Error("staging_authority_changed_since_plan");
  return true;
}

export function retryableError(error) {
  const code = error?.status ?? error?.code;
  return code === 429 || (Number.isInteger(code) && code >= 500 && code <= 599) || ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(code);
}

export async function withRetry(operation, { attempts = 4, baseDelayMs = 250, random = Math.random, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(attempt); } catch (error) {
      last = error; if (!retryableError(error) || attempt === attempts - 1) throw error;
      await wait(Math.round(baseDelayMs * 2 ** attempt * (0.75 + random() * 0.5)));
    }
  }
  throw last;
}

export async function mapBounded(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new Error("invalid_concurrency");
  const results = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; results[index] = await worker(items[index], index); }
  }));
  return results;
}

export function aggregateResults(results) {
  const counts = { total: results.length, bytes: 0, skipped: 0, uploaded: 0, verified: 0, failed: 0, uncertain: 0 };
  const creators = {};
  for (const item of results) {
    counts.bytes += item.byteCount ?? 0; if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
    const value = creators[item.creatorId] ??= { total: 0, bytes: 0, skipped: 0, uploaded: 0, verified: 0, failed: 0, uncertain: 0 };
    value.total += 1; value.bytes += item.byteCount ?? 0; if (Object.hasOwn(value, item.status)) value[item.status] += 1;
  }
  return { counts, creators };
}

export function newObjectKey() { return `originals/v2/${randomUUID()}`; }

export function wranglerMutationEnvironment(accountId) { return mutationWranglerEnvironment({ accountId }); }
