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
  media_origin: "r2_native" | "dropbox_legacy";
  media_state: string;
  video_state: string | null;
  video_codec: "h264" | "h265" | null;
  playback_provider: "none" | "stream" | null;
  playback_failure_code: string | null;
}

export interface LibraryFilters { safety?: string; destination?: string; type?: string; query?: string; source?: string }
export interface CreatorFriend { id: number; display_name: string; stage_name: string | null; consent_status: string }
export interface AttachedFriend extends CreatorFriend { evidence_platform: string | null; confirmed_at: string | null }
export interface AssetEvent { id: string; actor: string; event_type: string; snapshot: string; created_at: string }
export interface PreviewProgress { total: number; ready: number; queued: number; processing: number; failed: number }
export interface VideoPlaybackProgress { total: number; ready: number; queued: number; processing: number; failed: number }
export interface LibrarySummary { assets: number; sfw: number; nsfw: number; needs_review: number; previews: number }
export interface LibraryPageData { summary: LibrarySummary | null; previewProgress: PreviewProgress; videoPlaybackProgress: VideoPlaybackProgress; assets: AssetRow[] }

function sourceCondition(source: string | undefined) {
  if (source === "legacy") return "NOT EXISTS (SELECT 1 FROM asset_media_authorities native_authority WHERE native_authority.asset_id=a.id AND native_authority.creator_id=a.creator_id AND native_authority.authority_kind='r2_native')";
  if (source === "native") return "EXISTS (SELECT 1 FROM asset_media_authorities native_authority WHERE native_authority.asset_id=a.id AND native_authority.creator_id=a.creator_id AND native_authority.authority_kind='r2_native')";
  return "1=1";
}

export async function getLibrarySummary(creatorId: string, source?: string) {
  const { DB } = cloudflareEnv();
  return librarySummaryStatement(DB, creatorId, source).first<LibrarySummary>();
}

function librarySummaryStatement(DB: D1Database, creatorId: string, source?: string) {
  return DB.prepare(`
    SELECT COUNT(*) AS assets,
      SUM(CASE WHEN c.safety='sfw' THEN 1 ELSE 0 END) AS sfw,
      SUM(CASE WHEN c.safety='nsfw' THEN 1 ELSE 0 END) AS nsfw,
      SUM(CASE WHEN c.safety IS NULL THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN a.preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS previews
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
    WHERE a.creator_id=? AND a.source_available=1 AND ${sourceCondition(source)}
  `).bind(creatorId);
}

export async function getPreviewProgress(creatorId: string, source?: string): Promise<PreviewProgress> {
  const result = await previewProgressStatement(cloudflareEnv().DB, creatorId, source).first<PreviewProgressRow>();
  return toPreviewProgress(result);
}

type PreviewProgressRow = { total: number; ready: number | null; queued: number | null; processing: number | null; failed: number | null };

function previewProgressStatement(DB: D1Database, creatorId: string, source?: string) {
  return DB.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN a.preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN a.preview_r2_key IS NULL AND ma.state='ingesting' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN a.preview_r2_key IS NULL AND ma.state='canonical_verified' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN a.preview_r2_key IS NULL AND (ma.state='preview_failed' OR j.status='failed') THEN 1 ELSE 0 END) AS failed
    FROM assets a LEFT JOIN asset_preview_jobs j ON j.creator_id=a.creator_id AND j.asset_id=a.id
      LEFT JOIN asset_media_authorities ma ON ma.creator_id=a.creator_id AND ma.asset_id=a.id
    WHERE a.creator_id=? AND a.source_available=1
      AND lower(a.extension) IN ('jpg','jpeg','png','webp','heic')
      AND ${sourceCondition(source)}`).bind(creatorId);
}

function toPreviewProgress(result: PreviewProgressRow | null | undefined): PreviewProgress {
  return { total: result?.total ?? 0, ready: result?.ready ?? 0, queued: result?.queued ?? 0, processing: result?.processing ?? 0, failed: result?.failed ?? 0 };
}

type VideoPlaybackProgressRow = { total: number; ready: number | null; queued: number | null; processing: number | null; failed: number | null };

function videoPlaybackProgressStatement(DB: D1Database, creatorId: string) {
  return DB.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN state='playback_ready' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN state='processing_queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN state='processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN state='processing_failed' THEN 1 ELSE 0 END) AS failed
    FROM asset_video_playback_states
    WHERE creator_id=? AND state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')`).bind(creatorId);
}

function toVideoPlaybackProgress(result: VideoPlaybackProgressRow | null | undefined): VideoPlaybackProgress {
  return { total: result?.total ?? 0, ready: result?.ready ?? 0, queued: result?.queued ?? 0, processing: result?.processing ?? 0, failed: result?.failed ?? 0 };
}

export async function getVideoPlaybackProgress(creatorId: string): Promise<VideoPlaybackProgress> {
  const result = await videoPlaybackProgressStatement(cloudflareEnv().DB, creatorId).first<VideoPlaybackProgressRow>();
  return toVideoPlaybackProgress(result);
}

export async function getLibraryAssets(creatorId: string, filters: LibraryFilters = {}) {
  const { DB } = cloudflareEnv();
  const result = await libraryAssetsStatement(DB, creatorId, filters).all<AssetRow>();
  return result.results;
}

function libraryAssetsStatement(DB: D1Database, creatorId: string, filters: LibraryFilters = {}) {
  const conditions = ["a.creator_id=?", "a.source_available=1"];
  const values: unknown[] = [creatorId];
  conditions.push(sourceCondition(filters.source));
  if (filters.safety === "review") conditions.push("c.safety IS NULL");
  if (filters.safety === "sfw" || filters.safety === "nsfw") { conditions.push("c.safety=?"); values.push(filters.safety); }
  if (destinations.includes(filters.destination as Destination)) {
    conditions.push("EXISTS (SELECT 1 FROM asset_destinations fd WHERE fd.asset_id=a.id AND fd.destination=?)");
    values.push(filters.destination);
  }
  if (filters.type === "photos") conditions.push("a.extension IN ('jpg','jpeg','png','webp')");
  if (filters.type === "videos") conditions.push("a.extension IN ('mp4','mov','m4v','webm')");
  if (filters.query?.trim()) { conditions.push("(a.basename LIKE ? OR a.relative_path LIKE ?)"); values.push(`%${filters.query.trim()}%`, `%${filters.query.trim()}%`); }
  return DB.prepare(`
    SELECT a.id,a.creator_id,a.basename,a.extension,a.bytes,a.modified_at,a.creator_notes,a.preview_r2_key,
      c.safety,c.is_teaser,c.is_multi,c.notes,
      COALESCE((SELECT GROUP_CONCAT(d.destination,'|') FROM asset_destinations d WHERE d.asset_id=a.id),'') AS destinations,
      COALESCE(ma.authority_kind,'dropbox_legacy') AS media_origin,
      COALESCE(vp.state,ma.state,'legacy') AS media_state,
      vp.state AS video_state,vp.source_codec AS video_codec,vp.playback_provider,vp.failure_code AS playback_failure_code
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
      LEFT JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id
      LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY (a.preview_r2_key IS NULL) ASC,a.modified_at DESC LIMIT 120
  `).bind(...values);
}

/**
 * The Library's independent reads share one bounded D1 batch, rather than
 * three concurrent database subrequests during server-side rendering.
 */
export async function getLibraryPageData(creatorId: string, filters: LibraryFilters = {}): Promise<LibraryPageData> {
  const { DB } = cloudflareEnv();
  const [summaryResult, previewResult, videoPlaybackResult, assetsResult] = await DB.batch([
    librarySummaryStatement(DB, creatorId, filters.source),
    previewProgressStatement(DB, creatorId, filters.source),
    videoPlaybackProgressStatement(DB, creatorId),
    libraryAssetsStatement(DB, creatorId, filters),
  ]);
  return {
    summary: (summaryResult.results[0] as LibrarySummary | undefined) ?? null,
    previewProgress: toPreviewProgress(previewResult.results[0] as PreviewProgressRow | undefined),
    videoPlaybackProgress: toVideoPlaybackProgress(videoPlaybackResult.results[0] as VideoPlaybackProgressRow | undefined),
    assets: assetsResult.results as AssetRow[],
  };
}

export async function getAssetByObjectId(creatorId: string, objectId: string) {
  const legacyKey = `creators/${creatorId}/assets/${objectId}/preview.jpg`;
  const revisionedPrefix = `creators/${creatorId}/assets/${objectId}/previews/`;
  return cloudflareEnv().DB.prepare(`
    SELECT a.id,a.creator_id,a.basename,a.extension,a.bytes,a.modified_at,a.creator_notes,a.preview_r2_key,
      c.safety,c.is_teaser,c.is_multi,c.notes,
      COALESCE((SELECT GROUP_CONCAT(d.destination,'|') FROM asset_destinations d WHERE d.asset_id=a.id),'') AS destinations,
      COALESCE(ma.authority_kind,'dropbox_legacy') AS media_origin,
      COALESCE(vp.state,ma.state,'legacy') AS media_state,
      vp.state AS video_state,vp.source_codec AS video_codec,vp.playback_provider,vp.failure_code AS playback_failure_code
    FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
      LEFT JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id
      LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    WHERE a.creator_id=? AND (a.preview_r2_key=? OR (substr(a.preview_r2_key,1,?)=? AND substr(a.preview_r2_key,-4)='.jpg')) AND a.source_available=1
  `).bind(creatorId, legacyKey, revisionedPrefix.length, revisionedPrefix).first<AssetRow>();
}

export function objectIdFor(asset: AssetRow) {
  return asset.preview_r2_key?.match(/\/assets\/([a-f0-9]{64})\/(?:preview\.jpg|previews\/[a-f0-9]{64}\.jpg)$/)?.[1] ?? null;
}

export async function getCreatorFriends(creatorId: string) {
  return (await cloudflareEnv().DB.prepare("SELECT id,display_name,stage_name,consent_status FROM people WHERE creator_id=? ORDER BY display_name").bind(creatorId).all<CreatorFriend>()).results;
}

export async function getAttachedFriends(creatorId: string, assetId: string) {
  return (await cloudflareEnv().DB.prepare(`
    SELECT p.id,p.display_name,p.stage_name,p.consent_status,att.evidence_platform,att.confirmed_at
    FROM asset_people ap JOIN people p ON p.id=ap.person_id AND p.creator_id=ap.creator_id
    LEFT JOIN asset_paid_consent_attestations att ON att.asset_id=ap.asset_id AND att.person_id=ap.person_id AND att.revoked_at IS NULL
    WHERE ap.creator_id=? AND ap.asset_id=? ORDER BY p.display_name
  `).bind(creatorId, assetId).all<AttachedFriend>()).results;
}

export async function getAssetEvents(creatorId: string, assetId: string) {
  return (await cloudflareEnv().DB.prepare(`SELECT id,actor,event_type,snapshot,created_at FROM asset_classification_events WHERE creator_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 30`).bind(creatorId, assetId).all<AssetEvent>()).results;
}
