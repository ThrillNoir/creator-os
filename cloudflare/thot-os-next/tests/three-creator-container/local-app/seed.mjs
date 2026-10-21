import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const sharp = createRequire("/app/cloudflare/thot-os-next/package.json")("sharp");

const profiles = [
  { id: "amber", name: "Synthetic Amber", color: "#e9a8c0" },
  { id: "birch", name: "Synthetic Birch", color: "#a8dcc8" },
  { id: "coral", name: "Synthetic Coral", color: "#ffca91" },
];
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = ["PRAGMA foreign_keys = ON;"];
for (const profile of profiles) {
  const creatorId = `synthetic-${profile.id}`;
  const email = `${profile.id}@synthetic.invalid`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${profile.color}"/><text x="320" y="260" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#241b24">${profile.name}</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  const sha = createHash("sha256").update(bytes).digest("hex");
  const etag = createHash("md5").update(bytes).digest("hex");
  writeFileSync(`/tmp/fixture-${profile.id}.jpg`, bytes);
  writeFileSync(`/tmp/fixture-${profile.id}-id`, sha);
  const objectId = randomUUID();
  const categoryId = randomUUID();
  const sourceKey = `creators/${creatorId}/assets/${sha}/original.jpg`;
  const previewKey = `creators/${creatorId}/assets/${sha}/previews/${sha}.jpg`;
  sql.push(`INSERT INTO creators(id,name,slug,initials) VALUES (${quote(creatorId)},${quote(profile.name)},${quote(creatorId)},${quote(profile.id.slice(0,1).toUpperCase())});`);
  sql.push(`INSERT INTO users(email,display_name) VALUES (${quote(email)},${quote(profile.name)});`);
  sql.push(`INSERT INTO creator_memberships(creator_id,user_email,role) VALUES (${quote(creatorId)},${quote(email)},'creator');`);
  sql.push(`INSERT INTO assets(id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at,preview_r2_key) VALUES (${quote(sha)},${quote(creatorId)},${quote(`synthetic/${profile.id}.jpg`)},${quote(`${profile.name}.jpg`)},'jpg',${bytes.length},CURRENT_TIMESTAMP,'synthetic',CURRENT_TIMESTAMP,${quote(previewKey)});`);
  sql.push(`INSERT INTO asset_classifications(asset_id,creator_id,safety,is_teaser) VALUES (${quote(sha)},${quote(creatorId)},'nsfw',1);`);
  sql.push(`INSERT INTO asset_storage_objects(id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status,verified_at,r2_version,r2_etag) VALUES (${quote(objectId)},${quote(creatorId)},${quote(sha)},'r2','canonical_original','library_media',${quote(sourceKey)},${quote(`${profile.name}.jpg`)},${bytes.length},'image/jpeg',${quote(sha)},'m1_direct','verified',CURRENT_TIMESTAMP,'synthetic-v1',${quote(etag)});`);
  sql.push(`INSERT INTO asset_media_authorities(asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state) VALUES (${quote(sha)},${quote(creatorId)},'r2_native','cloudflare_direct',${quote(objectId)},'preview_ready');`);
  sql.push(`INSERT INTO creator_portfolio_categories(id,creator_id,name) VALUES (${quote(categoryId)},${quote(creatorId)},'Samples');`);
  sql.push(`INSERT INTO creator_portfolio_items(asset_id,creator_id,category_id,title,description,updated_by,preview_confirmed,is_visible) VALUES (${quote(sha)},${quote(creatorId)},${quote(categoryId)},${quote(`${profile.name} sample`)},'Invented local fixture image.',${quote(email)},1,1);`);
}
writeFileSync("/tmp/fixture-seed.sql", sql.join("\n") + "\n");
