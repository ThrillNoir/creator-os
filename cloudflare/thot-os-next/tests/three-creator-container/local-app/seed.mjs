import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const sharp = createRequire("/app/cloudflare/thot-os-next/package.json")("sharp");

const profiles = [
  { id: "amber", name: "Synthetic Amber", color: "#e9a8c0" },
  { id: "birch", name: "Synthetic Birch", color: "#a8dcc8" },
  { id: "coral", name: "Synthetic Coral", color: "#ffca91" },
];
const socialProfiles = {
  amber: [
    { platform: "instagram", handle: "amber.main", label: "Amber main", active: true, posted: true },
    { platform: "instagram", handle: "amber.studio", label: "Amber studio", active: true, posted: true },
    { platform: "tiktok", handle: "amberclips", label: "Amber clips", active: false },
    { platform: "reddit", handle: "amber_test", label: "Amber Reddit", active: true },
  ],
  birch: [
    { platform: "instagram", handle: "birch.main", label: "Birch main", active: true },
    { platform: "instagram", handle: "birch.backup", label: "Birch backup", active: false },
  ],
  coral: [
    { platform: "reddit", handle: "coral_test", label: "Coral Reddit", active: true },
    { platform: "tiktok", handle: "coralclips", label: "Coral clips", active: true },
  ],
};
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
  sql.push(`INSERT INTO creator_onboarding_profiles(creator_id,stage_name) VALUES (${quote(creatorId)},${quote(profile.name)});`);
  for (const social of socialProfiles[profile.id]) {
    const accountId = randomUUID();
    sql.push(`INSERT INTO operational_accounts(id,creator_id,platform,label,handle,connection_status,publishing_mode,publishing_authority,is_active,creator_visible,account_kind)
      VALUES (${quote(accountId)},${quote(creatorId)},${quote(social.platform)},${quote(social.label)},${quote(social.handle)},'not_connected','not_configured','not_configured',${social.active ? 1 : 0},1,'social');`);
    if (!social.active) sql.push(`INSERT INTO creator_access_audit_events(id,creator_id,actor_email,actor_role,event_type,subject,detail)
      VALUES (${quote(randomUUID())},${quote(creatorId)},${quote(email)},'creator','onboarding_operational_account_created',${quote(accountId)},'{}');`);
    if (social.posted) sql.push(`INSERT INTO social_posts(id,creator_id,platform,account_id,asset_id,status,published_at,external_post_id,external_url)
      VALUES (${quote(randomUUID())},${quote(creatorId)},'instagram',${quote(accountId)},${quote(sha)},'published',CURRENT_TIMESTAMP,${quote(`synthetic-${profile.id}-${social.handle}`)},${quote(`https://www.instagram.com/p/synthetic-${profile.id}-${social.handle}/`)});`);
  }
  const clientId = randomUUID();
  sql.push(`INSERT INTO creator_clients(id,creator_id,display_name,contact_channel,notes) VALUES (${quote(clientId)},${quote(creatorId)},${quote(`${profile.name} client`)},'none','Invented offline CRM fixture.');`);
  sql.push(`INSERT INTO creator_client_bookings(id,creator_id,client_id,booked_on,status,description) VALUES (${quote(randomUUID())},${quote(creatorId)},${quote(clientId)},'2026-10-30','requested','Invented private appointment');`);
  if (profile.id !== "coral") sql.push(`INSERT INTO creator_client_payments(id,creator_id,client_id,received_on,amount_minor,currency,reference,reported_by)
    VALUES (${quote(randomUUID())},${quote(creatorId)},${quote(clientId)},'2026-10-23',${profile.id === "amber" ? 12500 : 5000},'AUD','synthetic manual report',${quote(email)});`);
}
writeFileSync("/tmp/fixture-seed.sql", sql.join("\n") + "\n");
