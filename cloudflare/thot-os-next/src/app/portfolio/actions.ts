"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";
import { getPortfolioDraft } from "@/lib/portfolio-authoring";
import { fetchInternalService } from "@/lib/internal-service";
import { portfolioAddFields } from "@/lib/portfolio-add-fields";

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
  if (!name || name.length > 50 || /[\u0000-\u001f\u007f<>]/.test(name)) throw new Error("Enter a category or genre name of at most 50 characters without angle brackets.");
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
  const intent = field(form, "intent");
  if (intent !== "add" && intent !== "remove") throw new Error("Choose whether to add or remove this Library item.");
  const DB = portfolioDb();
  const existing = await creatorPrepare(DB, creatorId,
    "SELECT asset_id FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id=?")
    .bind(assetId).first<{ asset_id: string }>();
  if (intent === "remove") {
    if (!existing) throw new Error("This preview is no longer in the private Portfolio draft. Refresh the Library item.");
    await DB.batch([
      creatorPrepare(DB, creatorId, "DELETE FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id=?").bind(assetId),
      creatorPrepare(DB, creatorId, "UPDATE creator_portfolio_draft_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator").bind(),
      audit(DB, creatorId, context.email, "item_removed", assetId, {}),
    ]);
  } else {
    if (existing) throw new Error("This preview is already in the private Portfolio draft. Refresh the Library item.");
    const fields = portfolioAddFields(form, assetId);
    const categoryId = fields.categoryId ?? crypto.randomUUID();
    if (fields.categoryId) {
      const category = await creatorPrepare(DB, creatorId, "SELECT id FROM creator_portfolio_categories WHERE creator_id=@creator AND id=?")
        .bind(fields.categoryId).first<{ id: string }>();
      if (!category) throw new Error("Choose this creator's category.");
    } else {
      const count = await creatorPrepare(DB, creatorId, "SELECT COUNT(*) AS count FROM creator_portfolio_categories WHERE creator_id=@creator")
        .first<{ count: number }>();
      if ((count?.count ?? 0) >= 24) throw new Error("This Portfolio already has 24 categories. Choose an existing one.");
      const duplicate = await creatorPrepare(DB, creatorId, "SELECT id FROM creator_portfolio_categories WHERE creator_id=@creator AND name=? COLLATE NOCASE")
        .bind(fields.newCategoryName).first<{ id: string }>();
      if (duplicate) throw new Error("This category already exists. Choose it from the list.");
    }
    if (fields.fullLengthAssetId) {
      const full = await creatorPrepare(DB, creatorId, `SELECT a.id FROM assets a
        JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
        WHERE a.creator_id=@creator AND a.id=? AND a.source_available=1 AND lower(a.extension)='mp4'
          AND ma.state IN ('canonical_verified','preview_ready','preview_failed')`)
        .bind(fields.fullLengthAssetId).first<{ id: string }>();
      if (!full) throw new Error("Choose this creator's verified private full-length video.");
    }
    const asset = await creatorPrepare(DB, creatorId, `SELECT a.basename FROM assets a
      JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id AND c.safety='nsfw'
      LEFT JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id
      WHERE a.creator_id=@creator AND a.id=? AND a.source_available=1
      AND (lower(a.extension) IN ('jpg','jpeg','png','webp') OR (lower(a.extension)='mp4' AND vp.source_codec='h264'
        AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')))
      AND EXISTS (SELECT 1 FROM asset_media_authorities ma WHERE ma.creator_id=a.creator_id AND ma.asset_id=a.id
        AND ma.authority_kind='r2_native' AND ma.state IN ('canonical_verified','preview_ready','preview_failed'))`)
      .bind(assetId).first<{ basename: string }>();
    if (!asset) throw new Error("This creator's verified Library item is unavailable.");
    const title = asset.basename.replace(/\.[^.]+$/, "").trim().slice(0, 100) || "Untitled preview";
    await DB.batch([
      ...(fields.newCategoryName ? [creatorPrepare(DB, creatorId, `INSERT INTO creator_portfolio_categories
        (id,creator_id,name,sort_order) VALUES (?,@creator,?,
        COALESCE((SELECT MAX(sort_order)+1 FROM creator_portfolio_categories WHERE creator_id=@creator),0))`)
        .bind(categoryId, fields.newCategoryName),
        audit(DB, creatorId, context.email, "category_created", null, { id: categoryId, name: fields.newCategoryName })] : []),
      creatorPrepare(DB, creatorId, `INSERT INTO creator_portfolio_items
        (asset_id,creator_id,title,category_id,full_length_asset_id,preview_confirmed,sort_order,updated_by) VALUES (?,@creator,?,?,?,1,
        COALESCE((SELECT MAX(sort_order)+1 FROM creator_portfolio_items WHERE creator_id=@creator),0),?)`)
        .bind(assetId, title, categoryId, fields.fullLengthAssetId, context.email),
      creatorPrepare(DB, creatorId, "UPDATE creator_portfolio_draft_state SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator").bind(),
      audit(DB, creatorId, context.email, "item_added", assetId, { categoryId, fullLengthLinked: Boolean(fields.fullLengthAssetId) }),
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
      creatorPrepare(DB, creatorId, "UPDATE creator_portfolio_draft_state SET revision=revision+1 WHERE creator_id=@creator").bind(),
      audit(DB, creatorId, context.email, eventType, null, { id, name }),
    ]);
  } else {
    const count = await creatorPrepare(DB, creatorId, `SELECT COUNT(*) AS count FROM ${table} WHERE creator_id=@creator`).first<{ count: number }>();
    if ((count?.count ?? 0) >= 24) throw new Error("A portfolio can have at most 24 categories or genres.");
    const id = crypto.randomUUID();
    await DB.batch([
      creatorPrepare(DB, creatorId, `INSERT INTO ${table} (id,creator_id,name,sort_order) VALUES (?,@creator,?,
        COALESCE((SELECT MAX(sort_order)+1 FROM ${table} WHERE creator_id=@creator),0))`).bind(id, name),
      creatorPrepare(DB, creatorId, "UPDATE creator_portfolio_draft_state SET revision=revision+1 WHERE creator_id=@creator").bind(),
      audit(DB, creatorId, context.email, eventType, null, { id, name }),
    ]);
  }
  revalidatePath("/portfolio");
  redirect("/portfolio");
}

export async function createPortfolioCategoryAction(form: FormData) { return saveLabel(form, "category", false); }
export async function renamePortfolioCategoryAction(form: FormData) { return saveLabel(form, "category", true); }
type CompositionCard = { assetId: string; title: string; description: string; categoryId: string | null; fullLengthAssetId: string | null; previewKey: string | null; visible?: boolean };
type CompositionContact = { telegramUsername: string; email: string; message: string };
type Composition = { revision: number; cards: CompositionCard[]; contact: CompositionContact };

function parseComposition(form: FormData): Composition {
  const raw = field(form, "composition");
  if (!raw || raw.length > 50000) throw new Error("Portfolio draft is too large.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Portfolio draft could not be read."); }
  if (!value || typeof value !== "object") throw new Error("Portfolio draft could not be read.");
  const data = value as Partial<Composition>;
  if (typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) || !Array.isArray(data.cards) || data.cards.length > 24) throw new Error("Portfolio draft must contain at most 24 cards.");
  const contact = data.contact ?? { telegramUsername: "", email: "", message: "" };
  if (!contact || typeof contact !== "object" || typeof contact.telegramUsername !== "string" ||
      typeof contact.email !== "string" || typeof contact.message !== "string") throw new Error("Check your creator contact details.");
  const telegramUsername = contact.telegramUsername.trim().replace(/^@/, "");
  const email = contact.email.trim();
  const message = contact.message.trim().replace(/\r\n/g, "\n");
  if ((telegramUsername && !/^[A-Za-z0-9_]{5,32}$/.test(telegramUsername)) ||
      (email && (email.length > 254 || !/^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email))) ||
      message.length > 500 || /[\u0000-\u0009\u000b-\u001f\u007f<>]/.test(message)) {
    throw new Error("Check your Telegram username, contact email or custom message.");
  }
  const ids = new Set<string>();
  for (const card of data.cards) {
    if (!card || typeof card !== "object" || !ASSET_ID.test(card.assetId) || ids.has(card.assetId) ||
      typeof card.title !== "string" || !card.title.trim() || card.title.length > 100 ||
      typeof card.description !== "string" || card.description.length > 280 ||
      (card.visible !== undefined && typeof card.visible !== "boolean") ||
      (card.previewKey !== null && (typeof card.previewKey !== "string" || card.previewKey.length > 1024)) ||
      (card.categoryId !== null && (typeof card.categoryId !== "string" || !LABEL_ID.test(card.categoryId))) ||
      (card.fullLengthAssetId !== null && (typeof card.fullLengthAssetId !== "string" || !ASSET_ID.test(card.fullLengthAssetId) || card.fullLengthAssetId === card.assetId))) {
      throw new Error("Check each card's title, category and full-length link.");
    }
    ids.add(card.assetId);
  }
  return { revision: data.revision, cards: data.cards, contact: { telegramUsername, email, message } };
}

async function saveComposition(form: FormData) {
  const context = await requireCreatorContext("mutate");
  const creatorId = context.creator.creator_id;
  const DB = portfolioDb();
  const composition = parseComposition(form);
  const draft = await getPortfolioDraft(creatorId);
  if (composition.revision !== draft.revision) throw new Error("This draft changed elsewhere. Refresh and review it before saving.");
  const existing = new Set(draft.items.map((item) => item.asset_id));
  if (composition.cards.some((card) => !existing.has(card.assetId))) throw new Error("A card no longer belongs to this draft.");
  if (composition.cards.some((card) => draft.items.find((item) => item.asset_id === card.assetId)?.preview_r2_key !== card.previewKey)) {
    throw new Error("A preview or thumbnail changed. Refresh and review it before saving or publishing.");
  }
  const categories = new Set(draft.categories.map((category) => category.id));
  if (composition.cards.some((card) => card.categoryId && !categories.has(card.categoryId))) throw new Error("Choose this creator's category.");
  const fullIds = [...new Set(composition.cards.filter((card) => card.visible !== false)
    .map((card) => card.fullLengthAssetId).filter((id): id is string => Boolean(id)))];
  if (fullIds.length) {
    const full = await creatorPrepare(DB, creatorId, `SELECT a.id FROM assets a
      JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
      WHERE a.creator_id=@creator AND a.id IN (${fullIds.map(() => "?").join(",")}) AND a.source_available=1
        AND lower(a.extension)='mp4' AND ma.state IN ('canonical_verified','preview_ready','preview_failed')`)
      .bind(...fullIds).all<{ id: string }>();
    if (full.results.length !== fullIds.length) throw new Error("A linked full-length video is unavailable for this creator.");
  }
  const chosen = new Set(composition.cards.map((card) => card.assetId));
  const statements = [
    creatorPrepare(DB, creatorId, `UPDATE creator_portfolio_draft_state
      SET revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END,contact_telegram=?,contact_email=?,contact_message=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=@creator`)
      .bind(composition.revision, composition.contact.telegramUsername, composition.contact.email, composition.contact.message),
    ...composition.cards.flatMap((card, order) => [
      creatorPrepare(DB, creatorId, `UPDATE creator_portfolio_items SET title=?,description=?,category_id=?,genre_id=NULL,
        full_length_asset_id=?,is_visible=?,sort_order=?,updated_at=CURRENT_TIMESTAMP,updated_by=?
        WHERE creator_id=@creator AND asset_id=?`).bind(card.title.trim(), card.description, card.categoryId, card.fullLengthAssetId, card.visible === false ? 0 : 1, order, context.email, card.assetId),
      audit(DB, creatorId, context.email, "item_saved", card.assetId, { categoryId: card.categoryId, fullLengthLinked: Boolean(card.fullLengthAssetId), visible: card.visible !== false, order }),
    ]),
    ...draft.items.filter((item) => !chosen.has(item.asset_id)).flatMap((item) => [
      creatorPrepare(DB, creatorId, "DELETE FROM creator_portfolio_items WHERE creator_id=@creator AND asset_id=?").bind(item.asset_id),
      audit(DB, creatorId, context.email, "item_removed", item.asset_id, { fromEditor: true }),
    ]),
  ];
  const result = await DB.batch(statements);
  if (result[0]?.meta?.changes !== 1) throw new Error("Draft changed elsewhere. Refresh and review it before saving.");
  return { context, composition };
}

export async function savePortfolioDraftAction(form: FormData) {
  await saveComposition(form);
  revalidatePath("/portfolio");
  redirect("/portfolio?notice=draft_saved");
}

export async function publishPortfolioAction(form: FormData) {
  if (field(form, "publicRightsApproved") !== "yes") throw new Error("Confirm public preview rights and consent before publishing.");
  const { context, composition } = await saveComposition(form);
  const { telegramUsername, email, message } = composition.contact;
  const creatorId = context.creator.creator_id;
  const env = cloudflareEnv();
  const releaseEnv = env as CloudflareEnv & { PORTFOLIO_PUBLISHING_ENABLED?: string };
  if (releaseEnv.PORTFOLIO_PUBLISHING_ENABLED !== "1") throw new Error("Portfolio publishing is not enabled in this environment.");
  const profile = await creatorPrepare(env.DB, creatorId, `SELECT p.published_version_id,c.slug
    FROM creator_adult_profiles p JOIN creators c ON c.id=p.creator_id
    JOIN creator_adult_profile_versions v ON v.id=p.published_version_id AND v.creator_id=p.creator_id AND v.status='published'
    WHERE p.creator_id=@creator AND p.status='active'`).first<{ published_version_id: string; slug: string }>();
  if (!profile) throw new Error("Publish this creator's 18+ profile before publishing a portfolio.");
  const draft = await getPortfolioDraft(creatorId);
  if (draft.revision !== composition.revision + 1) throw new Error("This draft changed elsewhere. Refresh and review it before publishing.");
  const visibleCards = composition.cards.filter((card) => card.visible !== false);
  if (visibleCards.length < 1 || visibleCards.length > 24) throw new Error("Show at least one card before publishing.");
  const cards = visibleCards.map((submitted) => {
    const item = draft.items.find((candidate) => candidate.asset_id === submitted.assetId);
    if (!item || item.preview_confirmed !== 1 || item.preview_asset_id || item.safety !== "nsfw" || !item.source_available || !submitted.categoryId || !submitted.title.trim()) throw new Error("Use a confirmed short preview card and assign its category before publishing.");
    const section = draft.categories.find((label) => label.id === submitted.categoryId)?.name;
    if (!section || /[<>]/.test(section)) throw new Error("Rename this category before publishing.");
    const video = item.video_state !== null && item.extension.toLowerCase() === "mp4";
    const previewKey = video ? null : item.preview_r2_key;
    const posterKey = video ? item.preview_r2_key : null;
    if ((video && !posterKey) || (!video && !previewKey)) throw new Error("A selected preview or thumbnail is not ready.");
    return { id: crypto.randomUUID(), assetId: item.asset_id, fullLengthAssetId: submitted.fullLengthAssetId,
      kind: video ? "video" as const : "image" as const, title: submitted.title.trim(), description: submitted.description,
      section, previewKey: video ? "" : previewKey!, posterKey };
  });
  if (cards.some((card) => card.fullLengthAssetId) && !telegramUsername && !email) {
    throw new Error("Add a Telegram username or contact email so visitors can request a full-length video.");
  }
  const versionId = crypto.randomUUID();
  const manifest = { schemaVersion: 2, contact: { ...(telegramUsername ? { telegramUsername } : {}), ...(email ? { email } : {}), ...(message ? { message } : {}) }, cards };
  const inserted = await creatorPrepare(env.DB, creatorId, `INSERT INTO creator_portfolio_release_versions
    (id,creator_id,adult_profile_version_id,status,manifest_json,approved_by)
    SELECT ?,@creator,?,'approved',?,? FROM creator_portfolio_draft_state
    WHERE creator_id=@creator AND revision=?`)
    .bind(versionId, profile.published_version_id, JSON.stringify(manifest), context.email, composition.revision + 1).run();
  if (!inserted.meta?.changes) throw new Error("This draft changed elsewhere. Refresh and review it before publishing.");
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
