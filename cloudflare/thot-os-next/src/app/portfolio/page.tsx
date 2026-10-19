import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AdultWorkspaceTabs } from "@/components/adult-workspace-tabs";
import { VerifiedVideoPreview } from "@/components/verified-video-preview";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { requireCreatorContext } from "@/lib/identity";
import { getPortfolioDraft, portfolioItemReadiness } from "@/lib/portfolio-authoring";
import { privatePortfolioImageObjectId } from "@/lib/portfolio-preview";
import { isVideoPortfolioItem, suggestedLinkedPreviewAssetId } from "@/lib/portfolio-video";
import {
  createPortfolioCategoryAction, createPortfolioGenreAction,
  renamePortfolioCategoryAction, renamePortfolioGenreAction,
  savePortfolioItemAction,
} from "./actions";

export default async function PortfolioPage() {
  if (String((cloudflareEnv() as { PORTFOLIO_AUTHORING_ENABLED?: string }).PORTFOLIO_AUTHORING_ENABLED) !== "1") notFound();
  const context = await requireCreatorContext();
  const draft = await getPortfolioDraft(context.creator.creator_id);
  const canEdit = roleCan(context.creator.role, "mutate");
  return <AppShell active="18+ profile"><PageHeader title="Portfolio" subtitle="Arrange the content for your age-gated More page. Changes here stay private until a separate release." eyebrow="18+ WORKSPACE" />
    <AdultWorkspaceTabs current="portfolio" />
    <section className="panel portfolio-workspace-intro"><div className="section-heading"><div><h2>Private selection</h2><p>In the <Link href="/library">Content Library</Link>, open an item and choose Select for portfolio. Here, give it a category, optional genre, and display details. Link a short preview to each full video.</p></div><span>{draft.items.length} selected</span></div><p>Only an approved preview can be published. A private original or a Library playback link is never a public preview.</p></section>
    <section className="panel portfolio-visual-preview" aria-labelledby="portfolio-preview-title"><div className="section-heading"><div><h2 id="portfolio-preview-title">Visual preview</h2><p>This shows your saved private draft. Save an item to update its card. The public More page is not changed.</p></div><span className="portfolio-preview-state">Private draft</span></div>
      <div className="portfolio-preview-frame"><div className="portfolio-preview-frame-heading"><span>18+ PORTFOLIO</span><strong>{context.creator.creator_name}</strong><small>{draft.items.length} selected item{draft.items.length === 1 ? "" : "s"}</small></div>
        {draft.items.length ? <div className="portfolio-preview-grid">{draft.items.map((item) => {
          const category = draft.categories.find((label) => label.id === item.category_id)?.name;
          const genre = draft.genres.find((label) => label.id === item.genre_id)?.name;
          const video = isVideoPortfolioItem(item);
          const privateImageObjectId = !video ? privatePortfolioImageObjectId(item.preview_r2_key) : null;
          return <article className="portfolio-preview-card" key={item.asset_id}>
            <div className="portfolio-preview-image">{video && item.preview_asset_id ? <VerifiedVideoPreview assetId={item.preview_asset_id} basename={item.preview_basename ?? item.title} className="portfolio-preview-media" /> : privateImageObjectId ? <img src={`/api/preview/${privateImageObjectId}`} alt={`Private draft preview for ${item.title}`} loading="lazy" /> : <span>{video ? "Choose a short preview video" : "Image preview preparing"}</span>}</div>
            <div className="portfolio-preview-card-body"><div className="portfolio-preview-labels"><span>{category ?? "Category needed"}</span>{genre && <span>{genre}</span>}</div><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}<small>{video ? item.preview_asset_id ? "Private preview candidate · approval pending" : "Short preview needed" : "Private image preview · approval pending"}</small></div>
          </article>;
        })}</div> : <div className="empty"><b>Your portfolio preview starts here.</b><span>Add content from the Library to see how your cards will look.</span></div>}
      </div>
    </section>
    <section className="panel portfolio-taxonomy"><div className="section-heading"><div><h2>Categories and genres</h2><p>These labels belong to {context.creator.creator_name}&apos;s portfolio and become visitor filters only after publication.</p></div></div>
      <div className="portfolio-taxonomy-grid"><div><h3>Categories</h3>{draft.categories.length ? draft.categories.map((label) => <div className="portfolio-label-row" key={label.id}>{canEdit ? <form action={renamePortfolioCategoryAction}><input type="hidden" name="id" value={label.id} /><label><span className="sr-only">Rename category</span><input name="name" maxLength={50} required defaultValue={label.name} /></label><button className="secondary-action" type="submit">Rename</button></form> : <span>{label.name}</span>}</div>) : <p>No categories yet.</p>}{canEdit && <form action={createPortfolioCategoryAction} className="portfolio-label-create"><label>New category<input name="name" maxLength={50} required placeholder="e.g. Clips" /></label><button type="submit">Add category</button></form>}</div>
      <div><h3>Genres</h3>{draft.genres.length ? draft.genres.map((label) => <div className="portfolio-label-row" key={label.id}>{canEdit ? <form action={renamePortfolioGenreAction}><input type="hidden" name="id" value={label.id} /><label><span className="sr-only">Rename genre</span><input name="name" maxLength={50} required defaultValue={label.name} /></label><button className="secondary-action" type="submit">Rename</button></form> : <span>{label.name}</span>}</div>) : <p>No genres yet.</p>}{canEdit && <form action={createPortfolioGenreAction} className="portfolio-label-create"><label>New genre<input name="name" maxLength={50} required placeholder="e.g. Performance" /></label><button type="submit">Add genre</button></form>}</div></div>
    </section>
    <section className="panel portfolio-draft-list"><div className="section-heading"><div><h2>Selected content</h2><p>One category and an optional genre per item. Unassigned items remain private.</p></div></div>
      {draft.items.length ? draft.items.map((item) => {
        const teasers = draft.teasers.filter((teaser) => teaser.id !== item.asset_id);
        const linkedTeasers = teasers.filter((teaser) => teaser.teaser_for_asset_id === item.asset_id);
        const suggestedPreviewId = suggestedLinkedPreviewAssetId(item.asset_id, teasers);
        const orderedTeasers = [...linkedTeasers, ...teasers.filter((teaser) => teaser.teaser_for_asset_id !== item.asset_id)];
        return <article className="portfolio-draft-item" key={item.asset_id}><div className="portfolio-draft-heading"><div><h3>{item.basename}</h3><p>{item.extension.toUpperCase()} · {item.safety ?? "Needs classification"}</p></div><span className="portfolio-readiness">{portfolioItemReadiness(item)}</span></div>
          {canEdit ? <form action={savePortfolioItemAction} className="portfolio-item-form"><input type="hidden" name="assetId" value={item.asset_id} /><label>Card title<input name="title" maxLength={100} required defaultValue={item.title} /></label><label>Category<select name="categoryId" defaultValue={item.category_id ?? ""}><option value="">Choose category</option>{draft.categories.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label><label>Genre <span>(optional)</span><select name="genreId" defaultValue={item.genre_id ?? ""}><option value="">No genre</option>{draft.genres.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label><label>Order<input name="sortOrder" type="number" min={0} max={9999} required defaultValue={item.sort_order} /></label><label className="portfolio-wide">Description <span>(optional)</span><textarea name="description" maxLength={280} defaultValue={item.description} /></label>{isVideoPortfolioItem(item) && <label className="portfolio-wide">Candidate preview video for this full clip<select name="previewAssetId" defaultValue={item.preview_asset_id ?? suggestedPreviewId}><option value="">Choose a separate video candidate</option>{item.preview_asset_id && !teasers.some((candidate) => candidate.id === item.preview_asset_id) && <option value={item.preview_asset_id}>Previous candidate unavailable · recheck before publishing</option>}{orderedTeasers.map((teaser) => <option value={teaser.id} key={teaser.id}>{teaser.basename}{teaser.teaser_for_asset_id === item.asset_id ? " · linked to this full clip" : ""}</option>)}</select><small>{!item.preview_asset_id && suggestedPreviewId ? "The Library-linked preview is suggested; save this draft to confirm it. " : ""}Clip length, rights and consent must be checked before publishing. This draft link does not expose either file.</small></label>}{!isVideoPortfolioItem(item) && <input type="hidden" name="previewAssetId" value="" />}<div className="portfolio-form-actions"><button type="submit">Save private draft</button><Link href={`/library/${item.asset_id}`}>Review Library item →</Link></div></form> : <p>{item.title} · {draft.categories.find((label) => label.id === item.category_id)?.name ?? "No category"} · {draft.genres.find((label) => label.id === item.genre_id)?.name ?? "No genre"}</p>}</article>;
      }) : <div className="empty"><b>No portfolio items selected.</b><span>Add one from a Library item to start a private draft.</span></div>}
    </section>
    <section className="panel portfolio-publish-note"><h2>Publishing is not active yet</h2><p>This staging candidate saves private creator choices. The public release control will be enabled only when approved preview media, consent checks, isolated delivery and withdrawal have been verified. Nothing on this page is automatically posted to More.</p></section>
  </AppShell>;
}
