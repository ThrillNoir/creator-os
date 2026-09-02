import { cloudflareEnv } from "./cloudflare";
import { fetchInternalService } from "./internal-service";
import type { AssetRow, Destination } from "./library";

export const operationPlatforms = [
  { id: "instagram", label: "Instagram", short: "IG", destination: "instagram" },
  { id: "reddit", label: "Reddit", short: "R", destination: "reddit" },
  { id: "fansly", label: "Vault", short: "V", destination: "subscription" },
] as const;

export type OperationPlatform = (typeof operationPlatforms)[number]["id"];

export interface OperationalAccount {
  id: string;
  is_active: number;
  creator_id: string;
  platform: OperationPlatform;
  label: string;
  handle: string;
  connection_status: "connected" | "needs_reconnection" | "needs_check" | "not_connected";
  publishing_mode: "direct_api" | "scheduled_api" | "finish_on_device" | "local_bridge" | "not_configured";
  publishing_authority: "confirmed" | "blocked" | "device_only" | "not_configured";
  warning_level: "none" | "attention" | "blocked";
  warning_message: string;
  external_identity_confirmed_at: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
}

export interface SocialPost {
  id: string;
  account_id: string | null;
  asset_id: string | null;
  community_id: number | null;
  reddit_flair_id: string | null;
  reddit_flair_text: string | null;
  platform: OperationPlatform;
  title: string;
  caption: string;
  content_rating: "sfw" | "nsfw" | null;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  scheduled_at: string | null;
  published_at: string | null;
  external_post_id: string | null;
  external_url: string | null;
  error: string | null;
  failure_reviewed_at: string | null;
  failure_reviewed_by: string | null;
  provider_container_id: string | null;
  provider_container_type: string | null;
  created_at: string;
  basename: string | null;
  community_name: string | null;
}

export interface RedditCommunity {
  id: number;
  name: string;
  rules_url: string;
  status: string;
  allows_nsfw: number;
  creator_verified: number;
  verification_required: number;
  flair_required: number;
  allowed_post_types: string;
  minimum_account_age_days: number;
  minimum_karma: number;
  cooldown_hours: number;
  title_guidance: string;
  notes: string;
  last_verified_at: string;
  flairs_checked_at: string | null;
}

export interface RedditCommunityFlair {
  creator_id: string;
  community_id: number;
  flair_id: string;
  flair_text: string;
  text_editable: number;
  fetched_at: string;
}

export interface VaultUploadJob {
  id: string;
  platform: "fansly" | "myroomz";
  status: "approved" | "claimed" | "staged" | "verified" | "failed" | "cancelled";
  asset_id: string;
  basename: string;
  bytes: number;
  error: string | null;
  receipt: string;
  approved_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface RedditSchedulerStatus {
  ok: boolean;
  connections?: { account_id: string; status: string; display_name: string; identity_confirmed_at: string | null; last_error: string | null; updated_at: string }[];
  lastRun?: { status: string; started_at: string; completed_at: string | null; claimed_count: number; published_count: number; failed_count: number; error: string | null } | null;
  due?: number;
}

export type PlatformSchedulerStatus = RedditSchedulerStatus;

export interface InstagramAnalyticsSnapshot {
  account_id: string | null;
  reach: number | null;
  follower_count: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
  profile_views: number | null;
  website_clicks: number | null;
  collected_at: string;
}

export interface InstagramMediaMetric {
  account_id: string | null;
  media_id: string;
  permalink: string | null;
  media_type: string | null;
  media_product_type: string | null;
  published_at: string | null;
  like_count: number | null;
  comments_count: number | null;
  view_count: number | null;
  saved_count: number | null;
  shares_count: number | null;
  collected_at: string;
}

export interface InstagramSyncState {
  account_id?: string | null;
  last_messages_sync_at: string | null;
  last_analytics_sync_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface InstagramAnalyticsCollectionRun {
  account_id: string | null;
  status: "running" | "completed" | "skipped" | "failed";
  trigger_type: "manual" | "cron";
  media_count: number;
  media_insights_attempted: number;
  media_insights_succeeded: number;
  complete_metric_media: number;
  missing_view_media: number;
  missing_save_media: number;
  missing_share_media: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

type EligibleCount = { destination: Destination; assets: number };
type PostCount = { platform: OperationPlatform; upcoming: number; past: number };

export async function getOperationsOverview(creatorId: string) {
  const { DB } = cloudflareEnv();
  const [accountResult, eligibleResult, countResult, activityResult] = await Promise.all([
    DB.prepare("SELECT * FROM operational_accounts WHERE creator_id=? AND is_active=1 ORDER BY platform,label").bind(creatorId).all<OperationalAccount>(),
    DB.prepare(`SELECT destination,COUNT(*) AS assets FROM asset_destinations d JOIN assets a ON a.id=d.asset_id WHERE d.creator_id=? AND a.source_available=1 GROUP BY destination`).bind(creatorId).all<EligibleCount>(),
    DB.prepare(`SELECT platform,SUM(CASE WHEN status IN ('draft','scheduled','publishing') THEN 1 ELSE 0 END) AS upcoming,SUM(CASE WHEN status IN ('published','failed') THEN 1 ELSE 0 END) AS past FROM social_posts WHERE creator_id=? GROUP BY platform`).bind(creatorId).all<PostCount>(),
    DB.prepare(`SELECT p.id,p.account_id,p.asset_id,p.community_id,p.reddit_flair_id,p.reddit_flair_text,p.platform,p.title,p.caption,p.content_rating,p.status,p.scheduled_at,p.published_at,p.external_post_id,p.external_url,p.error,p.failure_reviewed_at,p.failure_reviewed_by,p.provider_container_id,p.provider_container_type,p.created_at,a.basename,c.name AS community_name FROM social_posts p LEFT JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id LEFT JOIN reddit_communities c ON c.id=p.community_id AND c.creator_id=p.creator_id WHERE p.creator_id=? ORDER BY COALESCE(p.published_at,p.scheduled_at,p.created_at) DESC LIMIT 8`).bind(creatorId).all<SocialPost>(),
  ]);
  const accounts = new Map(accountResult.results.map((account) => [account.platform, account]));
  const eligible = new Map(eligibleResult.results.map((row) => [row.destination, row.assets]));
  const postCounts = new Map(countResult.results.map((row) => [row.platform, row]));
  const platforms = operationPlatforms.map((platform) => ({
    ...platform,
    account: accounts.get(platform.id) ?? null,
    eligibleAssets: platform.destination ? eligible.get(platform.destination) ?? 0 : 0,
    upcoming: postCounts.get(platform.id)?.upcoming ?? 0,
    past: postCounts.get(platform.id)?.past ?? 0,
  }));
  return { platforms, accounts: accountResult.results, activity: activityResult.results, warnings: accountResult.results.filter((account) => account.warning_level !== "none") };
}

export async function getPlatformOperations(creatorId: string, platform: OperationPlatform, accountId?: string) {
  const definition = operationPlatforms.find((item) => item.id === platform)!;
  const { DB } = cloudflareEnv();
  const assetQuery = definition.destination ? DB.prepare(`
    SELECT a.id,a.creator_id,a.basename,a.extension,a.bytes,a.modified_at,a.creator_notes,a.preview_r2_key,
      c.safety,c.is_teaser,c.is_multi,c.notes,
      COALESCE((SELECT GROUP_CONCAT(ad.destination,'|') FROM asset_destinations ad WHERE ad.asset_id=a.id),'') AS destinations
    FROM assets a JOIN asset_destinations d ON d.asset_id=a.id AND d.creator_id=a.creator_id
    LEFT JOIN asset_classifications c ON c.asset_id=a.id
    WHERE a.creator_id=? AND a.source_available=1 AND d.destination=?
    ORDER BY (a.preview_r2_key IS NULL),a.modified_at DESC LIMIT 120
  `).bind(creatorId, definition.destination).all<AssetRow>() : Promise.resolve({ results: [] as AssetRow[], success: true, meta: {} });
  const [accountResult, posts, assets, communities, flairs] = await Promise.all([
    DB.prepare("SELECT * FROM operational_accounts WHERE creator_id=? AND platform=? AND is_active=1 ORDER BY label").bind(creatorId, platform).all<OperationalAccount>(),
    DB.prepare(`SELECT p.id,p.account_id,p.asset_id,p.community_id,p.reddit_flair_id,p.reddit_flair_text,p.platform,p.title,p.caption,p.content_rating,p.status,p.scheduled_at,p.published_at,p.external_post_id,p.external_url,p.error,p.failure_reviewed_at,p.failure_reviewed_by,p.provider_container_id,p.provider_container_type,p.created_at,a.basename,c.name AS community_name FROM social_posts p LEFT JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id LEFT JOIN reddit_communities c ON c.id=p.community_id AND c.creator_id=p.creator_id WHERE p.creator_id=? AND p.platform=? ORDER BY COALESCE(p.scheduled_at,p.published_at,p.created_at) DESC`).bind(creatorId, platform).all<SocialPost>(),
    assetQuery,
    platform === "reddit" ? DB.prepare("SELECT * FROM reddit_communities WHERE creator_id=? ORDER BY status,name").bind(creatorId).all<RedditCommunity>() : Promise.resolve({ results: [] as RedditCommunity[], success: true, meta: {} }),
    platform === "reddit" ? DB.prepare("SELECT creator_id,community_id,flair_id,flair_text,text_editable,fetched_at FROM reddit_community_flairs WHERE creator_id=? AND active=1 ORDER BY community_id,flair_text").bind(creatorId).all<RedditCommunityFlair>() : Promise.resolve({ results: [] as RedditCommunityFlair[], success: true, meta: {} }),
  ]);
  const accounts = accountResult.results;
  const account = (accountId ? accounts.find((item) => item.id === accountId) : accounts.find((item) => item.is_active === 1) ?? accounts[0]) ?? null;
  return { definition, account, accounts, posts: posts.results, assets: assets.results, communities: communities.results, flairs: flairs.results };
}

export async function getInstagramSchedulerStatus(creatorId: string, accountId?: string): Promise<PlatformSchedulerStatus | null> {
  try {
    const env = cloudflareEnv();
    const accountQuery = accountId ? `&accountId=${encodeURIComponent(accountId)}` : "";
    const response = await fetchInternalService(env, "instagram", "instagram.status.read", env.INSTAGRAM_SCHEDULER, `https://instagram-scheduler/status?creator=${encodeURIComponent(creatorId)}${accountQuery}`);
    if (!response.ok) return null;
    return await response.json() as PlatformSchedulerStatus;
  } catch {
    return null;
  }
}

export async function getInstagramAnalytics(creatorId: string, accountId?: string) {
  const { DB } = cloudflareEnv();
  const scoped = Boolean(accountId);
  const scope = scoped ? " AND account_id=?" : "";
  const bind = <T>(statement: D1PreparedStatement) => scoped ? statement.bind(creatorId, accountId) : statement.bind(creatorId);
  const [snapshot, media, syncState, collection] = await Promise.all([
    bind(DB.prepare(`SELECT account_id,reach,follower_count,accounts_engaged,total_interactions,profile_views,website_clicks,collected_at FROM instagram_analytics_snapshots WHERE creator_id=?${scope} ORDER BY collected_at DESC LIMIT 1`)).first<InstagramAnalyticsSnapshot>(),
    bind(DB.prepare(`SELECT account_id,media_id,permalink,media_type,media_product_type,published_at,like_count,comments_count,view_count,saved_count,shares_count,collected_at FROM instagram_media_metrics WHERE creator_id=?${scope} ORDER BY COALESCE(published_at,collected_at) DESC LIMIT 50`)).all<InstagramMediaMetric>(),
    scoped ? DB.prepare("SELECT account_id,last_messages_sync_at,last_analytics_sync_at,last_error,updated_at FROM instagram_account_sync_state WHERE creator_id=? AND account_id=?").bind(creatorId, accountId).first<InstagramSyncState>() : DB.prepare("SELECT last_messages_sync_at,last_analytics_sync_at,last_error,updated_at FROM instagram_sync_state WHERE creator_id=?").bind(creatorId).first<InstagramSyncState>(),
    bind(DB.prepare(`SELECT account_id,status,trigger_type,media_count,media_insights_attempted,media_insights_succeeded,complete_metric_media,missing_view_media,missing_save_media,missing_share_media,started_at,completed_at,error FROM instagram_analytics_collection_runs WHERE creator_id=?${scope} ORDER BY started_at DESC LIMIT 1`)).first<InstagramAnalyticsCollectionRun>(),
  ]);
  return { snapshot, media: media.results, syncState, collection };
}

export async function getVaultOperations(creatorId: string) {
  const base = await getPlatformOperations(creatorId, "fansly");
  const { DB } = cloudflareEnv();
  const [accounts, jobs, pairing, assets] = await Promise.all([
    DB.prepare("SELECT * FROM operational_accounts WHERE creator_id=? AND platform='fansly' AND is_active=1 ORDER BY label").bind(creatorId).all<OperationalAccount>(),
    DB.prepare(`
      SELECT j.id,j.platform,j.status,j.asset_id,a.basename,a.bytes,j.error,j.receipt,j.approved_at,j.claimed_at,j.completed_at,j.created_at
      FROM vault_upload_jobs j JOIN assets a ON a.id=j.asset_id AND a.creator_id=j.creator_id
      WHERE j.creator_id=? ORDER BY j.created_at DESC LIMIT 120
    `).bind(creatorId).all<VaultUploadJob>(),
    DB.prepare("SELECT status,expires_at,last_seen_at,created_at FROM bridge_credentials WHERE creator_id=? AND platform='fansly' ORDER BY created_at DESC LIMIT 1").bind(creatorId).first<{ status: string; expires_at: string; last_seen_at: string | null; created_at: string }>(),
    DB.prepare(`
      SELECT a.id,a.creator_id,a.basename,a.extension,a.bytes,a.modified_at,a.creator_notes,a.preview_r2_key,
        c.safety,c.is_teaser,c.is_multi,c.notes,
        COALESCE((SELECT GROUP_CONCAT(ad.destination,'|') FROM asset_destinations ad WHERE ad.asset_id=a.id),'') AS destinations
      FROM assets a LEFT JOIN asset_classifications c ON c.asset_id=a.id
      WHERE a.creator_id=? AND a.source_available=1
        AND EXISTS (SELECT 1 FROM asset_destinations d WHERE d.asset_id=a.id AND d.creator_id=a.creator_id AND d.destination IN ('subscription','ppv'))
      ORDER BY (a.preview_r2_key IS NULL),a.modified_at DESC LIMIT 120
    `).bind(creatorId).all<AssetRow>(),
  ]);
  return { ...base, assets: assets.results, accounts: accounts.results, jobs: jobs.results, pairing };
}

export async function getRedditSchedulerStatus(creatorId: string): Promise<RedditSchedulerStatus | null> {
  try {
    const env = cloudflareEnv();
    const response = await fetchInternalService(env, "reddit", "reddit.status.read", env.REDDIT_SCHEDULER, `https://reddit-scheduler/status?creator=${encodeURIComponent(creatorId)}`);
    if (!response.ok) return null;
    return await response.json() as RedditSchedulerStatus;
  } catch {
    return null;
  }
}

export function isOperationPlatform(value: string | undefined): value is OperationPlatform {
  return operationPlatforms.some((platform) => platform.id === value);
}
