"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";
import { isVideoPortfolioItem } from "@/lib/portfolio-video";

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const LABEL_ID = /^[0-9a-f-]{36}$/i;

function field(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function portfolioDb() {
  const env = cloudflareEnv();
  if (String((env as { PORTFOLIO_AUTHORING_ENABLED?: string }).PORTFOLIO_AUTHORING_ENABLED) !== "1") throw new Error("Portfolio authoring is not enabled.");
  return env.DB;
}

function labelName(form: FormData) {
  const name = field(form, "name").normalize("NFKC").replace(/\s+/g, " ");
  if (!name || name.length > 50 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Enter a category or genre name of at most 50 characters.");
  return name;
}

function audit(DB: D1Database, creatorId: string, actor: string, eventType: string, assetId: string | null, detail: object) {
  return creatorPrepare(DB, creatorId, `INSERT INTO creator_portfolio_events
    (id,creator_id,asset_id,actor,event_type,detail) VALUES (?,@creator,?,?,?,?)`)
    .bind(crypto.randomUUID(), assetId, actor, eventType, JSON.stringify(detail));
}

export async function togglePortfolioItemAction(form: FormData) {
  const context = await requireCreatorContext("mutate");
  const creatorId = context.creator.creator_id;
  const assetId = field(form, "assetId");
  if (!ASSET_ID.test(assetId)) throw new Error("Choose a Library item.");
  const DB = portfolioDb();
  const existing = await creatorPrepare(DB, creatorId,
    "SELECT asset_id FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id=?")
    .bind(assetId).first<{ asset_id: string }>();
  if (existing) {
    await DB.batch([
      creatorPrepare(DB, creatorId, "DELETE FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id=?").bind(assetId),
      audit(DB, creatorId, context.email, "item_removed", assetId, {}),
    ]);
  } else {
    const asset = await creatorPrepare(DB, creatorId, `SELECT a.basename FROM assets a
      WHERE a.creator_id=@creator AND a.id=? AND a.source_available=1
      AND EXISTS (SELECT 1 FROM asset_media_authorities ma WHERE ma.creator_id=a.creator_id AND ma.asset_id=a.id
        AND ma.authority_kind='r2_native' AND ma.state IN ('canonical_verified','preview_ready','preview_failed'))`)
      .bind(assetId).first<{ basename: string }>();
    if (!asset) throw new Error("This creator's verified Library item is unavailable.");
    const title = asset.basename.replace(/\.[^.]+$/, "").trim().slice(0, 100) || "Untitled preview";
    await DB.batch([
      creatorPrepare(DB, creatorId, `INSERT INTO creator_portfolio_items
        (asset_id,creator_id,title,sort_order,updated_by) VALUES (?,@creator,?,
        COALESCE((SELECT MAX(sort_order)+1 FROM creator_portfolio_items WHERE creator_id=@creator),0),?)`)
        .bind(assetId, title, context.email),
      audit(DB, creatorId, context.email, "item_added", assetId, {}),
    ]);
  }
  revalidatePath("/library");
  revalidatePath(`/library/${assetId}`);
  revalidatePath("/portfolio");
  redirect(`/library/${assetId}`);
}

async function saveLabel(form: FormData, kind: "category" | "genre", rename: boolean) {
  const context = await requireCreatorContext("mutate");
  const creatorId = context.creator.creator_id;
  const DB = portfolioDb();
  const table = kind === "category" ? "creator_portfolio_categories" : "creator_portfolio_genres";
  const name = labelName(form);
  const eventType = `${kind}_${rename ? "renamed" : "created"}`;
  if (rename) {
    const id = field(form, "id");
    if (!LABEL_ID.test(id)) throw new Error("Choose an existing portfolio label.");
    const owned = await creatorPrepare(DB, creatorId, `SELECT id FROM ${table} WHERE creator_id=@creator AND id=?`).bind(id).first<{ id: string }>();
    if (!owned) throw new Error("That portfolio label is unavailable.");
    await DB.batch([
      creatorPrepare(DB, creatorId, `UPDATE ${table} SET name=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator AND id=?`).bind(name, id),
      audit(DB, creatorId, context.email, eventType, null, { id, name }),
    ]);
  } else {
    const count = await creatorPrepare(DB, creatorId, `SELECT COUNT(*) AS count FROM ${table} WHERE creator_id=@creator`).first<{ count: number }>();
    if ((count?.count ?? 0) >= 24) throw new Error("A portfolio can have at most 24 categories or genres.");
    const id = crypto.randomUUID();
    await DB.batch([
      creatorPrepare(DB, creatorId, `INSERT INTO ${table} (id,creator_id,name,sort_order) VALUES (?,@creator,?,
        COALESCE((SELECT MAX(sort_order)+1 FROM ${table} WHERE creator_id=@creator),0))`).bind(id, name),
      audit(DB, creatorId, context.email, eventType, null, { id, name }),
    ]);
  }
  revalidatePath("/portfolio");
  redirect("/portfolio");
}

export async function createPortfolioCategoryAction(form: FormData) { return saveLabel(form, "category", false); }
export async function renamePortfolioCategoryAction(form: FormData) { return saveLabel(form, "category", true); }
export async function createPortfolioGenreAction(form: FormData) { return saveLabel(form, "genre", false); }
export async function renamePortfolioGenreAction(form: FormData) { return saveLabel(form, "genre", true); }

export async function savePortfolioItemAction(form: FormData) {
  const context = await requireCreatorContext("mutate");
  const creatorId = context.creator.creator_id;
  const assetId = field(form, "assetId");
  if (!ASSET_ID.test(assetId)) throw new Error("Choose a portfolio item.");
  const title = field(form, "title");
  const description = field(form, "description");
  const categoryId = field(form, "categoryId") || null;
  const genreId = field(form, "genreId") || null;
  const previewAssetId = field(form, "previewAssetId") || null;
  const sortOrder = Number(field(form, "sortOrder"));
  if (!title || title.length > 100 || description.length > 280 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999 ||
    (categoryId !== null && !LABEL_ID.test(categoryId)) || (genreId !== null && !LABEL_ID.test(genreId)) ||
    (previewAssetId !== null && !ASSET_ID.test(previewAssetId))) throw new Error("Check this item's title, description, labels, preview and order.");
  const DB = portfolioDb();
  const item = await creatorPrepare(DB, creatorId, `SELECT p.asset_id,p.preview_asset_id AS current_preview_asset_id,a.extension,vp.state AS video_state
    FROM creator_portfolio_items p JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
    LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    WHERE p.creator_id=@creator AND p.asset_id=?`)
    .bind(assetId).first<{ asset_id: string; current_preview_asset_id: string | null; extension: string; video_state: string | null }>();
  if (!item) throw new Error("This portfolio draft item is unavailable.");
  if (previewAssetId && !isVideoPortfolioItem(item)) throw new Error("Only a video item can have a separate video preview candidate.");
  if (categoryId && !await creatorPrepare(DB, creatorId,
    "SELECT id FROM creator_portfolio_categories WHERE creator_id=@creator AND id=?").bind(categoryId).first()) throw new Error("Choose this creator's category.");
  if (genreId && !await creatorPrepare(DB, creatorId,
    "SELECT id FROM creator_portfolio_genres WHERE creator_id=@creator AND id=?").bind(genreId).first()) throw new Error("Choose this creator's genre.");
  if (previewAssetId && previewAssetId !== item.current_preview_asset_id && !await creatorPrepare(DB, creatorId, `SELECT a.id FROM assets a
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
    WHERE a.creator_id=@creator AND a.id=? AND a.id<>? AND a.source_available=1 AND lower(a.extension)='mp4'
      AND vp.source_codec='h264' AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')
      AND ma.state='canonical_verified'`)
    .bind(previewAssetId, assetId).first()) throw new Error("Choose this creator's separate verified H.264 MP4 preview.");
  await DB.batch([
    creatorPrepare(DB, creatorId, `UPDATE creator_portfolio_items
      SET category_id=?,genre_id=?,preview_asset_id=?,title=?,description=?,sort_order=?,updated_at=CURRENT_TIMESTAMP,updated_by=?
      WHERE creator_id=@creator AND asset_id=?`)
      .bind(categoryId, genreId, previewAssetId, title, description, sortOrder, context.email, assetId),
    audit(DB, creatorId, context.email, "item_saved", assetId, { categoryId, genreId, previewAssetId, title, sortOrder }),
  ]);
  revalidatePath("/portfolio");
  redirect("/portfolio");
}
