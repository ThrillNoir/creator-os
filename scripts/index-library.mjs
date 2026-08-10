import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const outputDirectory = path.resolve(".creator-os");
const outputFile = path.join(outputDirectory, "library-index.json");
const databasePath = path.join(outputDirectory, "creator-os.sqlite");
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".mov", ".mp4"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolutePath)));
    if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) files.push(absolutePath);
  }
  return files;
}

function filenameClass(filename) {
  const stem = path.basename(filename, path.extname(filename));
  if (/^_?(DSC|DIK|MG|ABC)[_-]?\d/i.test(stem)) return "camera";
  if (stem.length >= 75 && /[_-]/.test(stem)) return "descriptive";
  return "other";
}

await mkdir(outputDirectory, { recursive: true });
const db = new Database(databasePath, { readonly: true });
const creators = db.prepare("SELECT id, name, media_source FROM creators WHERE media_source IS NOT NULL ORDER BY name").all();
db.close();

const indexedAt = new Date().toISOString();
const indexes = [];
for (const creator of creators) {
  const source = path.resolve(creator.media_source);
  const absoluteFiles = await walk(source);
  const basenameCounts = new Map();
  for (const file of absoluteFiles) {
    const basename = path.basename(file).toLowerCase();
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  const assets = [];
  for (const absolutePath of absoluteFiles) {
    const fileStat = await stat(absolutePath);
    const relativePath = path.relative(source, absolutePath);
    const basename = path.basename(absolutePath);
    assets.push({
      id: creator.id === "thrill-noir" ? `local:${relativePath}` : `local:${creator.id}:${relativePath}`,
      relativePath,
      basename,
      extension: path.extname(basename).slice(1).toLowerCase(),
      bytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      filenameClass: filenameClass(basename),
      repeatedBasename: (basenameCounts.get(basename.toLowerCase()) ?? 0) > 1,
    });
  }
  assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  indexes.push({ creatorId: creator.id, creatorName: creator.name, source, assets });
  console.log(`Indexed ${assets.length} assets for ${creator.name} from ${source}`);
}

await writeFile(outputFile, `${JSON.stringify({ version: 2, indexedAt, readOnlySource: true, creators: indexes }, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputFile}`);
