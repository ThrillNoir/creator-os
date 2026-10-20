import "server-only";

import { cloudflareEnv } from "./cloudflare";
import { creatorPrepare } from "./creator-db";

export type PortfolioLabel = { id: string; name: string; sort_order: number };
export type PortfolioDraftItem = {
  asset_id: string;
  basename: string;
  extension: string;
  safety: "sfw" | "nsfw" | null;
  category_id: string | null;
  genre_id: string | null;
  preview_asset_id: string | null;
  preview_confirmed: number;
  full_length_asset_id: string | null;
  full_length_basename: string | null;
  preview_basename: string | null;
  preview_poster_r2_key: string | null;
  title: string;
  description: string;
  sort_order: number;
  source_available: number;
  preview_r2_key: string | null;
  video_state: string | null;
};
export async function getPortfolioDraft(creatorId: string) {
  const DB = cloudflareEnv().DB;
  const [categories, items, state, fullVideos] = await DB.batch([
    creatorPrepare(DB, creatorId, "SELECT id,name,sort_order FROM creator_portfolio_categories WHERE creator_id=@creator ORDER BY sort_order,name,id").bind(),
    creatorPrepare(DB, creatorId, `SELECT p.asset_id,a.basename,a.extension,c.safety,p.category_id,p.genre_id,p.preview_asset_id,p.preview_confirmed,p.full_length_asset_id,
      full.basename AS full_length_basename,
      preview.basename AS preview_basename,preview.preview_r2_key AS preview_poster_r2_key,
      p.title,p.description,p.sort_order,a.source_available,a.preview_r2_key,
      vp.state AS video_state
      FROM creator_portfolio_items p JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
      LEFT JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
      LEFT JOIN assets preview ON preview.id=p.preview_asset_id AND preview.creator_id=p.creator_id
      LEFT JOIN assets full ON full.id=p.full_length_asset_id AND full.creator_id=p.creator_id
      LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
      WHERE p.creator_id=@creator ORDER BY p.sort_order,p.created_at,p.asset_id`).bind(),
    creatorPrepare(DB, creatorId, "SELECT revision FROM creator_portfolio_draft_state WHERE creator_id=@creator").bind(),
    creatorPrepare(DB, creatorId, `SELECT a.id,a.basename FROM assets a
      JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
      WHERE a.creator_id=@creator AND a.source_available=1 AND lower(a.extension)='mp4'
        AND ma.state IN ('canonical_verified','preview_ready','preview_failed') ORDER BY a.basename,a.id LIMIT 200`).bind(),
  ]);
  const draftItems = items.results as PortfolioDraftItem[];
  const choices = [...fullVideos.results] as { id: string; basename: string }[];
  const choiceIds = new Set(choices.map((video) => video.id));
  // A linked video must remain visible in its selector even when it falls
  // outside the first page of catalog choices or later becomes unavailable.
  for (const item of draftItems) {
    if (item.full_length_asset_id && !choiceIds.has(item.full_length_asset_id)) {
      choices.push({ id: item.full_length_asset_id, basename: item.full_length_basename ?? "Previously linked private video" });
      choiceIds.add(item.full_length_asset_id);
    }
  }
  return {
    categories: categories.results as PortfolioLabel[],
    items: draftItems,
    revision: (state.results[0] as { revision: number } | undefined)?.revision ?? 0,
    fullVideos: choices,
  };
}

export async function getPortfolioItem(creatorId: string, assetId: string) {
  return creatorPrepare(cloudflareEnv().DB, creatorId,
    "SELECT asset_id,category_id,genre_id,preview_asset_id,full_length_asset_id,title,description,sort_order FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id=?")
    .bind(assetId).first<Pick<PortfolioDraftItem, "asset_id" | "category_id" | "genre_id" | "preview_asset_id" | "full_length_asset_id" | "title" | "description" | "sort_order">>();
}
