import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const creatorId = process.argv[2]?.trim() || "adelaide";
const sourcePath = path.resolve(".creator-os/creator-os.sqlite");
const outputDirectory = path.resolve("output/cloudflare/previews", creatorId);
const manifestPath = path.resolve("output/cloudflare", `${creatorId}-previews.json`);
const sqlPath = path.resolve("output/cloudflare", `${creatorId}-preview-keys.sql`);
const concurrency = 4;

const db = new Database(sourcePath, { readonly: true });
const creator = db.prepare("SELECT media_source FROM creators WHERE id=?").get(creatorId);
if (!creator?.media_source) throw new Error(`Creator ${creatorId} has no local media source.`);
const assets = db.prepare(`
  SELECT id,relative_path,extension,modified_at
  FROM assets
  WHERE creator_id=? AND source_available=1
  ORDER BY id
`).all(creatorId);
db.close();

function opaqueId(value) {
  return createHash("sha256").update(`${creatorId}\0${value}`).digest("hex");
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runFfmpeg(source, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y", "-loglevel", "error", "-i", source,
      "-vf", "scale=min(960\\,iw):-2", "-frames:v", "1", "-q:v", "5", destination,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `ffmpeg exited ${code}`)));
  });
}

await mkdir(outputDirectory, { recursive: true });
const entries = [];
const missing = [];
const failed = [];
let cursor = 0;

async function worker() {
  while (cursor < assets.length) {
    const asset = assets[cursor++];
    const source = path.resolve(creator.media_source, asset.relative_path);
    if (!existsSync(source)) {
      missing.push(asset.id);
      continue;
    }

    const objectId = opaqueId(asset.id);
    const destination = path.join(outputDirectory, `${objectId}.jpg`);
    try {
      const [sourceInfo, destinationInfo] = await Promise.all([
        stat(source),
        stat(destination).catch(() => null),
      ]);
      if (!destinationInfo || destinationInfo.mtimeMs < sourceInfo.mtimeMs) {
        await runFfmpeg(source, destination);
      }
      const previewInfo = await stat(destination);
      entries.push({
        assetId: asset.id,
        objectId,
        creatorId,
        key: `creators/${creatorId}/assets/${objectId}/preview.jpg`,
        file: path.relative(process.cwd(), destination),
        bytes: previewInfo.size,
        contentType: "image/jpeg",
      });
    } catch (error) {
      failed.push({ assetId: asset.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
entries.sort((a, b) => a.assetId.localeCompare(b.assetId));

const manifest = {
  version: 1,
  product: "THOT OS",
  creatorId,
  generatedAt: new Date().toISOString(),
  counts: { indexed: assets.length, ready: entries.length, missing: missing.length, failed: failed.length },
  entries,
  missingAssetIds: missing,
  failures: failed,
};
const sql = [
  "PRAGMA foreign_keys = ON;",
  ...entries.map((entry) => `UPDATE assets SET preview_r2_key=${quote(entry.key)} WHERE id=${quote(entry.assetId)} AND creator_id=${quote(creatorId)};`),
  "",
].join("\n");

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(sqlPath, sql, "utf8");
console.log(JSON.stringify({ manifestPath, sqlPath, counts: manifest.counts }));
if (failed.length) process.exitCode = 1;
