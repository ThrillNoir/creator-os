import { cloudflareEnv } from "./cloudflare";

export const destinations = ["instagram", "facebook", "tiktok", "threads", "x", "reddit", "subscription", "ppv"] as const;
export type Destination = (typeof destinations)[number];

export interface AssetRow {
  id: string;
  creator_id: string;
  basename: string;
  extension: string;
  bytes: number;
  modified_at: string;
  creator_notes: string;
  preview_r2_key: string | null;
  safety: "sfw" | "nsfw" | null;
  is_teaser: number;
  is_multi: number;
  notes: string;
  destinations: string;
}

export interface LibraryFilters { safety?: string; destination?: string; type?: string; query?: string }
export interface CreatorFriend { id: number; display_name: string; stage_name: string | null; consent_status: string }
export interface AttachedFriend extends CreatorFriend { evidence_platform: string | null; confirmed_at: string | null }
export interface AssetEvent { id: string; actor: string; event_type: string; snapshot: string; created_at: string }

export async function getLibrarySummary() {
  const { DB } = cloudflareEnv();
  return DB.prepare(`
    SELECT COUNT(*) AS assets,
      SUM(CASE WHEN c.safety='sfw' THEN 1 ELSE 0 END) AS sfw,
      SUM(CASE WHEN c.safety='nsfw' THEN 1 ELSE 0 END) AS nsfw,
      SUM(CASE WHEN c.safety IS NULL THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN a.preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS previews
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
    WHERE a.creator_id='adelaide' AND a.source_available=1
  `).first<{ assets: number; sfw: number; nsfw: number; needs_review: number; previews: number }>();
}

export async function getLibraryAssets(filters: LibraryFilters = {}) {
  const { DB } = cloudflareEnv();
  const conditions = ["a.creator_id=?", "a.source_available=1"];
  const values: unknown[] = ["adelaide"];
  if (filters.safety === "review") conditions.push("c.safety IS NULL");
  if (filters.safety === "sfw" || filters.safety === "nsfw") { conditions.push("c.safety=?"); values.push(filters.safety); }
  if (destinations.includes(filters.destination as Destination)) {
    conditions.push("EXISTS (SELECT 1 FROM asset_destinations fd WHERE fd.asset_id=a.id AND fd.destination=?)");
    values.push(filters.destination);
  }
  if (filters.type === "photos") conditions.push("a.extension IN ('jpg','jpeg','png','webp')");
  if (filters.type === "videos") conditions.push("a.extension IN ('mp4','mov','m4v','webm')");
  if (filters.query?.trim()) { conditions.push("(a.basename LIKE ? OR a.relative_path LIKE ?)"); values.push(`%${filters.query.trim()}%`, `%${filters.query.trim()}%`); }
  const result = await DB.prepare(`
    SELECT a.id,a.creator_id,a.basename,a.extension,a.bytes,a.modified_at,a.creator_notes,a.preview_r2_key,
      c.safety,c.is_teaser,c.is_multi,c.notes,
      COALESCE((SELECT GROUP_CONCAT(d.destination,'|') FROM asset_destinations d WHERE d.asset_id=a.id),'') AS destinations
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY (a.preview_r2_key IS NULL) ASC,a.modified_at DESC LIMIT 120
  `).bind(...values).all<AssetRow>();
  return result.results;
}

export async function getAssetByObjectId(objectId: string) {
  const key = `creators/adelaide/assets/${objectId}/preview.jpg`;
  return cloudflareEnv().DB.prepare(`
    SELECT a.id,a.creator_id,a.basename,a.extension,a.bytes,a.modified_at,a.creator_notes,a.preview_r2_key,
      c.safety,c.is_teaser,c.is_multi,c.notes,
      COALESCE((SELECT GROUP_CONCAT(d.destination,'|') FROM asset_destinations d WHERE d.asset_id=a.id),'') AS destinations
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
    WHERE a.creator_id='adelaide' AND a.preview_r2_key=? AND a.source_available=1
  `).bind(key).first<AssetRow>();
}

export function objectIdFor(asset: AssetRow) {
  return asset.preview_r2_key?.match(/\/([a-f0-9]{64})\/preview\.jpg$/)?.[1] ?? null;
}

export async function getCreatorFriends() {
  return (await cloudflareEnv().DB.prepare("SELECT id,display_name,stage_name,consent_status FROM people WHERE creator_id='adelaide' ORDER BY display_name").all<CreatorFriend>()).results;
}

export async function getAttachedFriends(assetId: string) {
  return (await cloudflareEnv().DB.prepare(`
    SELECT p.id,p.display_name,p.stage_name,p.consent_status,att.evidence_platform,att.confirmed_at
    FROM asset_people ap JOIN people p ON p.id=ap.person_id AND p.creator_id=ap.creator_id
    LEFT JOIN asset_paid_consent_attestations att ON att.asset_id=ap.asset_id AND att.person_id=ap.person_id AND att.revoked_at IS NULL
    WHERE ap.creator_id='adelaide' AND ap.asset_id=? ORDER BY p.display_name
  `).bind(assetId).all<AttachedFriend>()).results;
}

export async function getAssetEvents(assetId: string) {
  return (await cloudflareEnv().DB.prepare(`SELECT id,actor,event_type,snapshot,created_at FROM asset_classification_events WHERE creator_id='adelaide' AND asset_id=? ORDER BY created_at DESC LIMIT 30`).bind(assetId).all<AssetEvent>()).results;
}
