import Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const creatorId = "adelaide";
const sourcePath = path.resolve(".creator-os/creator-os.sqlite");
const outputDirectory = path.resolve("output/cloudflare");
const sqlPath = path.join(outputDirectory, "adelaide-d1-import.sql");
const manifestPath = path.join(outputDirectory, "adelaide-manifest.json");
const db = new Database(sourcePath, { readonly: true });

function quote(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function values(table, columns, rows) {
  return rows.map((row) => `INSERT OR REPLACE INTO ${table} (${columns.join(",")}) VALUES (${columns.map((column) => quote(row[column])).join(",")});`);
}

const creator = db.prepare("SELECT * FROM creators WHERE id=?").get(creatorId);
if (!creator) throw new Error("Adelaide creator record was not found.");

const dropboxMarker = `${path.sep}Dropbox${path.sep}`;
const dropboxRoot = creator.media_source?.includes(dropboxMarker)
  ? `/${creator.media_source.split(dropboxMarker)[1].split(path.sep).join("/")}`
  : null;

const assets = db.prepare("SELECT * FROM assets WHERE creator_id=? AND source_available=1 ORDER BY id").all(creatorId);
const classifications = db.prepare("SELECT * FROM asset_classifications WHERE creator_id=? ORDER BY asset_id").all(creatorId);
const destinations = db.prepare("SELECT * FROM asset_destinations WHERE creator_id=? ORDER BY asset_id,destination").all(creatorId);
const people = db.prepare("SELECT * FROM people WHERE creator_id=? ORDER BY id").all(creatorId);
const assetPeople = db.prepare("SELECT * FROM asset_people WHERE creator_id=? ORDER BY asset_id,person_id").all(creatorId);
const attestations = db.prepare("SELECT * FROM asset_paid_consent_attestations WHERE creator_id=? ORDER BY asset_id,person_id").all(creatorId);
db.close();

const exportedAt = new Date().toISOString();
const lines = [
  "PRAGMA foreign_keys = ON;",
  ...values("creators", ["id","name","slug","initials","accent","status","dropbox_root","created_at"], [{ ...creator, dropbox_root: dropboxRoot }]),
  ...values("assets", ["id","creator_id","relative_path","basename","extension","bytes","modified_at","filename_class","repeated_basename","source_available","creator_notes","safety_level","workflow_status","indexed_at"], assets),
  ...values("asset_classifications", ["asset_id","creator_id","safety","is_teaser","is_multi","teaser_for_asset_id","notes","reviewed_by","reviewed_at","updated_at"], classifications),
  ...values("asset_destinations", ["asset_id","creator_id","destination","created_at"], destinations),
  ...values("people", ["id","creator_id","display_name","stage_name","consent_status","tagging_preference","private_notes","created_at"], people),
  ...values("asset_people", ["asset_id","creator_id","person_id","role","created_at"], assetPeople),
  ...values("asset_paid_consent_attestations", ["asset_id","creator_id","person_id","evidence_platform","confirmed_by","confirmed_at","note","revoked_at"], attestations),
  `INSERT OR REPLACE INTO migration_runs (id,source,creator_id,exported_at,detail) VALUES (${quote(`local-sqlite:${creatorId}:${exportedAt}`)},'local-sqlite',${quote(creatorId)},${quote(exportedAt)},${quote(JSON.stringify({ assets: assets.length, classifications: classifications.length, destinations: destinations.length, people: people.length, assetPeople: assetPeople.length, attestations: attestations.length }))});`,
  "",
];

const manifest = {
  version: 1,
  product: "THOT OS",
  source: sourcePath,
  creatorId,
  exportedAt,
  dropboxRoot,
  counts: {
    creators: 1,
    assets: assets.length,
    classifications: classifications.length,
    destinations: destinations.length,
    people: people.length,
    assetPeople: assetPeople.length,
    attestations: attestations.length,
  },
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(sqlPath, lines.join("\n"), "utf8");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${sqlPath}`);
console.log(`Wrote ${manifestPath}`);
console.log(JSON.stringify(manifest.counts));
