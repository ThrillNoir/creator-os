import "server-only";

import { assetDisplayName } from "./asset-display-name";
import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";
import { escapeLibraryLikeQuery, normalizeLibraryQuery, parseLibraryPage } from "./library-pagination";
import { safePostUrl, summarizeConfirmedPosts, type AssetUseEvent, type PostedAssetRow } from "./asset-use-summary";
import { latestInstagramResultsSql, useEventsSql } from "./asset-use-query";

const PAGE_SIZE = 24;

export type UsedAsset = {
  id: string;
  name: string;
  extension: string;
  latest_at: string;
  activity_count: number;
  posts_with_receipt: number;
  posting_profiles: string[];
  verified_vault_uploads: number;
  sent_messages: number;
  current_page_placements: number;
  latest_result: { views: number | null; likes: number | null; collected_at: string; account_label: string | null } | null;
};

type AssetRecord = { id: string; basename: string; display_stem: string | null; extension: string; source_available: number };
type UsedAssetRow = AssetRecord & Omit<UsedAsset, "name" | "posts_with_receipt" | "latest_result">;
type RawUseEvent = Omit<AssetUseEvent, "metrics">;
type MetricRow = {
  account_id: string | null;
  media_id: string;
  view_count: number | null;
  like_count: number | null;
  comments_count: number | null;
  saved_count: number | null;
  shares_count: number | null;
  collected_at: string;
};


export async function getUsedAssetsPage(creatorId: string, queryValue?: string, pageValue?: string) {
  const query = normalizeLibraryQuery(queryValue);
  const page = parseLibraryPage(pageValue);
  const filter = query ? "AND (a.basename LIKE ? ESCAPE '\\' OR COALESCE(a.display_stem,'') LIKE ? ESCAPE '\\')" : "";
  const like = `%${escapeLibraryLikeQuery(query)}%`;
  const result = await creatorPrepare(cloudflareEnv().DB, creatorId, `
    WITH use_events AS (${useEventsSql}), used AS (
      SELECT asset_id,MAX(datetime(occurred_at)) AS latest_at,COUNT(*) AS activity_count,
        SUM(CASE WHEN kind='vault' AND status='verified' THEN 1 ELSE 0 END) AS verified_vault_uploads,
        SUM(CASE WHEN kind='message' AND status='sent' THEN 1 ELSE 0 END) AS sent_messages,
        SUM(CASE WHEN kind IN ('public_profile','adult_profile') OR (kind='portfolio' AND status='published' AND role='Public preview') THEN 1 ELSE 0 END) AS current_page_placements
      FROM use_events GROUP BY asset_id
    )
    SELECT a.id,a.basename,a.display_stem,a.extension,a.source_available,u.latest_at,u.activity_count,
      u.verified_vault_uploads,u.sent_messages,u.current_page_placements
    FROM used u JOIN assets a ON a.id=u.asset_id AND a.creator_id=@creator
    WHERE a.creator_id=@creator ${filter}
    ORDER BY u.latest_at DESC,a.id DESC LIMIT ? OFFSET ?
  `).bind(...(query ? [like, like] : []), PAGE_SIZE + 1, (page - 1) * PAGE_SIZE).all<UsedAssetRow>();
  const rows = result.results.slice(0, PAGE_SIZE);
  const ids = rows.map((row) => row.id);
  const postRows = ids.length ? await creatorPrepare(cloudflareEnv().DB, creatorId, `
    SELECT p.asset_id,p.platform,p.account_id,oa.label AS account_label,p.external_post_id,p.external_url
    FROM social_posts p LEFT JOIN operational_accounts oa ON oa.id=p.account_id AND oa.creator_id=p.creator_id
    WHERE p.creator_id=@creator AND p.status='published' AND p.asset_id IN (${ids.map(() => "?").join(",")})
  `).bind(...ids).all<PostedAssetRow>() : null;
  const confirmedPosts = summarizeConfirmedPosts(postRows?.results ?? []);
  const latestResults = ids.length ? await creatorPrepare(cloudflareEnv().DB, creatorId, latestInstagramResultsSql(ids.length))
    .bind(...ids).all<{ asset_id: string; view_count: number | null; like_count: number | null; collected_at: string; account_label: string | null }>() : null;
  const resultsByAsset = new Map(latestResults?.results.map((row) => [row.asset_id, { views: row.view_count, likes: row.like_count, collected_at: row.collected_at, account_label: row.account_label }]) ?? []);
  return {
    assets: rows.map((row): UsedAsset => ({
      id: row.id, name: assetDisplayName(row), extension: row.extension,
      latest_at: row.latest_at, activity_count: row.activity_count,
      posts_with_receipt: confirmedPosts.get(row.id)?.count ?? 0, verified_vault_uploads: row.verified_vault_uploads,
      posting_profiles: [...(confirmedPosts.get(row.id)?.profiles.values() ?? [])].sort((a, b) => a.localeCompare(b)),
      sent_messages: row.sent_messages,
      current_page_placements: row.current_page_placements,
      latest_result: resultsByAsset.get(row.id) ?? null,
    })),
    page, query, hasNextPage: result.results.length > PAGE_SIZE,
  };
}

export async function getAssetUseDetail(creatorId: string, assetId: string) {
  const DB = cloudflareEnv().DB;
  const [asset, useResult] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id,basename,display_stem,extension,source_available FROM assets WHERE creator_id=@creator AND id=?")
      .bind(assetId).first<AssetRecord>(),
    creatorPrepare(DB, creatorId, `WITH use_events AS (${useEventsSql})
      SELECT id,asset_id,kind,status,destination,account_label,role,occurred_at,external_id,external_url
      FROM use_events WHERE asset_id=? ORDER BY datetime(occurred_at) DESC,id DESC LIMIT 101`)
      .bind(assetId).all<RawUseEvent>(),
  ]);
  if (!asset) return null;
  const truncated = useResult.results.length > 100;
  const events: AssetUseEvent[] = useResult.results.slice(0, 100).map((row) => ({
    ...row, external_url: row.kind === "social" ? safePostUrl(row.destination, row.external_url) : null,
  }));
  const instagram = events.filter((row) => row.kind === "social" && row.destination === "instagram" && row.external_id);
  if (instagram.length) {
    const ids = [...new Set(instagram.map((row) => row.external_id!))];
    const metrics = await creatorPrepare(DB, creatorId, `
      WITH ranked AS (
        SELECT account_id,media_id,view_count,like_count,comments_count,saved_count,shares_count,collected_at,
          ROW_NUMBER() OVER (PARTITION BY account_id,media_id ORDER BY collected_at DESC,id DESC) AS position
        FROM instagram_media_metric_observations
        WHERE creator_id=@creator AND source='instagram_api' AND media_id IN (${ids.map(() => "?").join(",")})
      ) SELECT account_id,media_id,view_count,like_count,comments_count,saved_count,shares_count,collected_at
      FROM ranked WHERE position=1
    `).bind(...ids).all<MetricRow>();
    const byPost = new Map(metrics.results.map((metric) => [`${metric.account_id ?? ""}:${metric.media_id}`, metric]));
    const accountRows = await creatorPrepare(DB, creatorId, `SELECT id FROM operational_accounts WHERE creator_id=@creator AND id IN (
      SELECT DISTINCT account_id FROM social_posts WHERE creator_id=@creator AND asset_id=? AND platform='instagram' AND account_id IS NOT NULL
    )`).bind(assetId).all<{ id: string }>();
    const ownedAccounts = new Set(accountRows.results.map((row) => row.id));
    const postAccounts = await creatorPrepare(DB, creatorId, "SELECT id,account_id FROM social_posts WHERE creator_id=@creator AND asset_id=? AND platform='instagram'")
      .bind(assetId).all<{ id: string; account_id: string | null }>();
    const accountByPost = new Map(postAccounts.results.map((row) => [row.id, row.account_id]));
    for (const event of events) {
      if (event.kind !== "social" || event.destination !== "instagram" || !event.external_id) continue;
      const accountId = accountByPost.get(event.id);
      if (!accountId || !ownedAccounts.has(accountId)) continue;
      const metric = byPost.get(`${accountId}:${event.external_id}`);
      if (metric) event.metrics = {
        views: metric.view_count, likes: metric.like_count, comments: metric.comments_count,
        saves: metric.saved_count, shares: metric.shares_count, collected_at: metric.collected_at,
      };
    }
  }
  return { asset: { ...asset, name: assetDisplayName(asset) }, events, truncated };
}
