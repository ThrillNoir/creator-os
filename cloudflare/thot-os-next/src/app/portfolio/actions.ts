"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";
import { isVideoPortfolioItem } from "@/lib/portfolio-video";
import { portfolioBulkAssetIds } from "@/lib/portfolio-bulk";
import { getPortfolioDraft } from "@/lib/portfolio-authoring";
import { fetchInternalService } from "@/lib/internal-service";

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

export async function assignPortfolioCategoryAction(form: FormData) {
  const context = await requireCreatorContext("mutate");
  const creatorId = context.creator.creator_id;
  const assetIds = portfolioBulkAssetIds(form.getAll("assetIds"));
  const categoryId = field(form, "categoryId");
  if (!LABEL_ID.test(categoryId)) throw new Error("Choose a category.");
  const DB = portfolioDb();
  const category = await creatorPrepare(DB, creatorId,
    "SELECT id FROM creator_portfolio_categories WHERE creator_id=@creator AND id=?").bind(categoryId).first<{ id: string }>();
  if (!category) throw new Error("Choose this creator's category.");
  const placeholders = assetIds.map(() => "?").join(",");
  const owned = await creatorPrepare(DB, creatorId,
    `SELECT asset_id FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id IN (${placeholders})`)
    .bind(...assetIds).all<{ asset_id: string }>();
  if (owned.results.length !== assetIds.length) throw new Error("One or more selected items are unavailable in this creator's portfolio.");
  await DB.batch(assetIds.flatMap((assetId) => [
    creatorPrepare(DB, creatorId, "UPDATE creator_portfolio_items SET category_id=?,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE creator_id=@creator AND asset_id=?")
      .bind(categoryId, context.email, assetId),
    audit(DB, creatorId, context.email, "item_saved", assetId, { categoryId, bulk: true }),
  ]));
  revalidatePath("/portfolio");
  redirect("/portfolio#portfolio-preview-title");
}

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

export async function publishPortfolioAction(form: FormData) {
  const context = await requireCreatorContext("mutate");
  const creatorId = context.creator.creator_id;
  if (field(form, "publicRightsApproved") !== "yes") throw new Error("Confirm public preview rights and consent before publishing.");
  const telegramUsername = field(form, "telegramUsername").replace(/^@/, "");
  const email = field(form, "email");
  if ((telegramUsername && !/^[A-Za-z0-9_]{5,32}$/.test(telegramUsername)) ||
      (email && !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/.test(email))) throw new Error("Check the Telegram username or contact email.");
  const selectedIds = portfolioBulkAssetIds(form.getAll("assetIds"));
  const env = cloudflareEnv();
  const releaseEnv = env as CloudflareEnv & { PORTFOLIO_PUBLISHING_ENABLED?: string };
  if (releaseEnv.PORTFOLIO_PUBLISHING_ENABLED !== "1") throw new Error("Portfolio publishing is not enabled in this environment.");
  const profile = await creatorPrepare(env.DB, creatorId, `SELECT p.published_version_id,c.slug
    FROM creator_adult_profiles p JOIN creators c ON c.id=p.creator_id
    JOIN creator_adult_profile_versions v ON v.id=p.published_version_id AND v.creator_id=p.creator_id AND v.status='published'
    WHERE p.creator_id=@creator AND p.status='active'`).first<{ published_version_id: string; slug: string }>();
  if (!profile) throw new Error("Publish this creator's 18+ profile before publishing a portfolio.");
  const draft = await getPortfolioDraft(creatorId);
  const selected = selectedIds.map((id) => draft.items.find((item) => item.asset_id === id));
  if (selected.length < 1 || selected.length > 24 || selected.some((item) => !item)) throw new Error("Select 1 to 24 items from this creator's portfolio.");
  const cards = selected.map((item) => {
    if (!item || item.safety !== "nsfw" || !item.source_available || !item.category_id || !item.title.trim()) throw new Error("Classify each selected item as NSFW and assign a category before publishing.");
    const section = draft.categories.find((label) => label.id === item.category_id)?.name;
    const genre = item.genre_id ? draft.genres.find((label) => label.id === item.genre_id)?.name : "";
    if (!section || genre === undefined) throw new Error("A selected category or genre is unavailable.");
    const video = isVideoPortfolioItem(item);
    if (video && !draft.teasers.some((teaser) => teaser.id === item.preview_asset_id && teaser.is_teaser === 1 && teaser.teaser_for_asset_id === item.asset_id)) {
      throw new Error("Mark the selected short preview as a teaser linked to this full video in the Library before publishing.");
    }
    const previewKey = video ? null : item.preview_r2_key;
    const posterKey = video ? item.preview_poster_r2_key : null;
    if ((video && (!item.preview_asset_id || !posterKey)) || (!video && !previewKey)) throw new Error("Choose a separate short video and thumbnail, or wait for the image preview, before publishing.");
    return { id: crypto.randomUUID(), assetId: item.asset_id, previewAssetId: video ? item.preview_asset_id : null,
      kind: video ? "video" as const : "image" as const, title: item.title, description: item.description,
      section, genre, previewKey: video ? "" : previewKey!, posterKey };
  });
  if (cards.some((card) => card.kind === "video") && !telegramUsername && !email) {
    throw new Error("Add a Telegram username or contact email so visitors can request a full-length video.");
  }
  const versionId = crypto.randomUUID();
  const manifest = { schemaVersion: 1, contact: { ...(telegramUsername ? { telegramUsername } : {}), ...(email ? { email } : {}) }, cards };
  const inserted = await creatorPrepare(env.DB, creatorId, `INSERT INTO creator_portfolio_release_versions
    (id,creator_id,adult_profile_version_id,status,manifest_json,approved_by) VALUES (?,@creator,?,'approved',?,?)`)
    .bind(versionId, profile.published_version_id, JSON.stringify(manifest), context.email).run();
  if (!inserted.meta?.changes) throw new Error("The portfolio release approval could not be recorded.");
  await creatorPrepare(env.DB, creatorId, `INSERT INTO creator_portfolio_release_events
    (id,creator_id,release_version_id,actor,event_type,detail) VALUES (?,@creator,?,?,'approved',?)`)
    .bind(crypto.randomUUID(), versionId, context.email, JSON.stringify({ cardCount: cards.length, publicRightsApproved: true })).run();
  const response = await fetchInternalService(env, "public_links_control", "adult.portfolio.publish", env.PUBLIC_LINKS_CONTROL,
    "https://public-links-control/adult/portfolio/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId, versionId }) });
  if (response.status !== 202) throw new Error(`Portfolio publication control did not accept this request (${response.status}). The approved release remains private.`);
  revalidatePath("/portfolio");
  redirect("/portfolio?notice=publication_started");
}

export async function withdrawPortfolioAction(form: FormData) {
  const context = await requireCreatorContext("mutate");
  const creatorId = context.creator.creator_id;
  const versionId = field(form, "versionId");
  if (!LABEL_ID.test(versionId)) throw new Error("Choose a published portfolio release.");
  const env = cloudflareEnv();
  const release = await creatorPrepare(env.DB, creatorId, "SELECT id FROM creator_portfolio_release_versions WHERE creator_id=@creator AND id=? AND status IN ('published','withdrawing')")
    .bind(versionId).first<{ id: string }>();
  if (!release) throw new Error("This creator has no matching published portfolio release.");
  const response = await fetchInternalService(env, "public_links_control", "adult.portfolio.withdraw", env.PUBLIC_LINKS_CONTROL,
    "https://public-links-control/adult/portfolio/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorId, versionId }) });
  if (response.status !== 202) throw new Error(`Portfolio withdrawal control did not accept this request (${response.status}).`);
  revalidatePath("/portfolio");
  redirect("/portfolio?notice=withdrawal_started");
}
