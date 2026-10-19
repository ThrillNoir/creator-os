import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";
import { isVideoPortfolioItem } from "./portfolio-video";

export type PortfolioLabel = { id: string; name: string; sort_order: number };
export type PortfolioDraftItem = {
  asset_id: string;
  basename: string;
  extension: string;
  safety: "sfw" | "nsfw" | null;
  category_id: string | null;
  genre_id: string | null;
  preview_asset_id: string | null;
  preview_basename: string | null;
  title: string;
  description: string;
  sort_order: number;
  source_available: number;
  preview_r2_key: string | null;
  video_state: string | null;
};
export type PortfolioTeaser = { id: string; basename: string; video_state: string; teaser_for_asset_id: string | null };

export function portfolioItemReadiness(item: PortfolioDraftItem) {
  if (!item.source_available) return "Original unavailable";
  if (!item.safety) return "Classify content first";
  if (item.category_id === null) return "Choose a category";
  if (isVideoPortfolioItem(item)) {
    if (!item.preview_asset_id) return "Choose a short preview";
    return "Candidate video chosen · publishing checks pending";
  }
  if (!item.preview_r2_key) return "Private image preview is preparing";
  return "Private draft · public approval pending";
}

export async function getPortfolioDraft(creatorId: string) {
  const DB = cloudflareEnv().DB;
  const [categories, genres, items, teasers] = await DB.batch([
    creatorPrepare(DB, creatorId, "SELECT id,name,sort_order FROM creator_portfolio_categories WHERE creator_id=@creator ORDER BY sort_order,name,id").bind(),
    creatorPrepare(DB, creatorId, "SELECT id,name,sort_order FROM creator_portfolio_genres WHERE creator_id=@creator ORDER BY sort_order,name,id").bind(),
    creatorPrepare(DB, creatorId, `SELECT p.asset_id,a.basename,a.extension,c.safety,p.category_id,p.genre_id,p.preview_asset_id,
      preview.basename AS preview_basename,p.title,p.description,p.sort_order,a.source_available,a.preview_r2_key,
      vp.state AS video_state
      FROM creator_portfolio_items p JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
      LEFT JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
      LEFT JOIN assets preview ON preview.id=p.preview_asset_id AND preview.creator_id=p.creator_id
      LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
      WHERE p.creator_id=@creator ORDER BY p.sort_order,p.created_at,p.asset_id`).bind(),
    creatorPrepare(DB, creatorId, `SELECT a.id,a.basename,vp.state AS video_state,c.teaser_for_asset_id
      FROM assets a JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
      JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
      LEFT JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
      WHERE a.creator_id=@creator AND a.source_available=1 AND lower(a.extension)='mp4'
        AND vp.source_codec='h264' AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')
        AND ma.state='canonical_verified'
      ORDER BY CASE WHEN c.teaser_for_asset_id IS NOT NULL THEN 0 ELSE 1 END,a.basename,a.id LIMIT 200`).bind(),
  ]);
  return {
    categories: categories.results as PortfolioLabel[],
    genres: genres.results as PortfolioLabel[],
    items: items.results as PortfolioDraftItem[],
    teasers: teasers.results as PortfolioTeaser[],
  };
}

export async function getPortfolioItem(creatorId: string, assetId: string) {
  return creatorPrepare(cloudflareEnv().DB, creatorId,
    "SELECT asset_id,category_id,genre_id,preview_asset_id,title,description,sort_order FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id=?")
    .bind(assetId).first<Pick<PortfolioDraftItem, "asset_id" | "category_id" | "genre_id" | "preview_asset_id" | "title" | "description" | "sort_order">>();
}
