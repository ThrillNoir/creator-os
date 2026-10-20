import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AdultWorkspaceTabs } from "@/components/adult-workspace-tabs";
import { VerifiedVideoPreview } from "@/components/verified-video-preview";
import { PortfolioBulkCategory } from "@/components/portfolio-bulk-category";
import { PortfolioEditLink } from "@/components/portfolio-edit-link";
import { PortfolioPublishForm, type PortfolioPublishChoice } from "@/components/portfolio-publish-form";
import { VideoPosterEditor } from "@/components/video-poster-editor";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";
import { getPortfolioDraft } from "@/lib/portfolio-authoring";
import { portfolioPublicationReadiness } from "@/lib/portfolio-publication-readiness";
import { privatePortfolioImageObjectId } from "@/lib/portfolio-preview";
import { isVideoPortfolioItem, suggestedLinkedPreviewAssetId } from "@/lib/portfolio-video";
import {
  createPortfolioCategoryAction, createPortfolioGenreAction,
  renamePortfolioCategoryAction, renamePortfolioGenreAction,
  savePortfolioItemAction, assignPortfolioCategoryAction,
  publishPortfolioAction, withdrawPortfolioAction,
} from "./actions";

type Release = {
  id: string;
  status: string;
  approved_at: string;
  published_at: string | null;
  withdrawn_at: string | null;
  failure_code: string | null;
  slug: string;
};

const notices: Record<string, string> = {
  publication_started: "Publication started. Your selection stays private while final checks run. Refresh to see its status.",
  withdrawal_started: "Withdrawal started. Refresh to confirm the public Portfolio has been removed.",
};

function releaseStatus(status: string) {
  return ({
    approved: "Approval recorded",
    publishing: "Publishing in progress",
    published: "Published",
    withdrawing: "Withdrawal in progress",
    withdrawn: "Withdrawn",
    failed: "Release failed",
  } as Record<string, string>)[status] ?? "Status unavailable";
}

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const env = cloudflareEnv();
  if (String((env as { PORTFOLIO_AUTHORING_ENABLED?: string }).PORTFOLIO_AUTHORING_ENABLED) !== "1") notFound();
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  const creatorId = context.creator.creator_id;
  const publishingEnabled = String((env as { PORTFOLIO_PUBLISHING_ENABLED?: string }).PORTFOLIO_PUBLISHING_ENABLED) === "1";
  const [draft, releases, adultProfile, publishedRelease] = await Promise.all([
    getPortfolioDraft(creatorId),
    publishingEnabled
      ? env.DB.prepare("SELECT r.id,r.status,r.approved_at,r.published_at,r.withdrawn_at,r.failure_code,c.slug FROM creator_portfolio_release_versions r JOIN creators c ON c.id=r.creator_id WHERE r.creator_id=? ORDER BY r.approved_at DESC,r.id DESC LIMIT 10").bind(creatorId).all<Release>().then((result) => result.results)
      : Promise.resolve([] as Release[]),
    publishingEnabled
      ? creatorPrepare(env.DB, creatorId, "SELECT p.published_version_id FROM creator_adult_profiles p JOIN creator_adult_profile_versions v ON v.id=p.published_version_id AND v.creator_id=p.creator_id AND v.status='published' WHERE p.creator_id=@creator AND p.status='active'").first<{ published_version_id: string }>()
      : Promise.resolve(null),
    publishingEnabled
      ? creatorPrepare(env.DB, creatorId, "SELECT r.id,r.status,r.approved_at,r.published_at,r.withdrawn_at,r.failure_code,c.slug FROM creator_portfolio_release_versions r JOIN creators c ON c.id=r.creator_id WHERE r.creator_id=@creator AND r.status IN ('published','withdrawing') ORDER BY r.approved_at DESC,r.id DESC LIMIT 1").first<Release>()
      : Promise.resolve(null),
  ]);
  const canEdit = roleCan(context.creator.role, "mutate");
  const profileReady = Boolean(adultProfile);
  const latestRelease = releases[0];
  const publicState = publishedRelease?.status === "published" ? "Live page" : publishedRelease?.status === "withdrawing" ? "Removing public page" : "Private draft";
  const notice = query.notice ? notices[query.notice] : null;
  const choices: PortfolioPublishChoice[] = draft.items.map((item) => ({
    id: item.asset_id,
    title: item.title,
    video: isVideoPortfolioItem(item),
    ...portfolioPublicationReadiness(item, draft.teasers),
  }));
  const choiceById = new Map(choices.map((choice) => [choice.id, choice]));
  const readyCount = choices.filter((choice) => choice.ready).length;

  const previewCards = draft.items.map((item) => {
    const category = draft.categories.find((label) => label.id === item.category_id)?.name;
    const genre = draft.genres.find((label) => label.id === item.genre_id)?.name;
    const video = isVideoPortfolioItem(item);
    const imageId = !video ? privatePortfolioImageObjectId(item.preview_r2_key) : null;
    const posterId = video ? privatePortfolioImageObjectId(item.preview_poster_r2_key) : null;
    const posterUrl = posterId ? "/api/preview/" + posterId : null;
    const choice = choiceById.get(item.asset_id);
    return <article className="portfolio-preview-card" key={item.asset_id}>
      {canEdit && <label className="portfolio-preview-select"><input aria-label={"Select " + item.title + " for category update"} name="assetIds" type="checkbox" value={item.asset_id} /><span>Select</span></label>}
      <div className="portfolio-preview-image">
        {video && item.preview_asset_id
          ? <VerifiedVideoPreview assetId={item.preview_asset_id} basename={item.preview_basename ?? item.title} className="portfolio-preview-media" poster={posterUrl} />
          : imageId
            ? <img src={"/api/preview/" + imageId} alt={"Private draft preview for " + item.title} loading="lazy" />
            : <span>{video ? "Short preview needed" : "Image preview preparing"}</span>}
      </div>
      <div className="portfolio-preview-card-body">
        <div className="portfolio-preview-labels"><span>{category ?? "Category needed"}</span>{genre && <span>{genre}</span>}</div>
        <h3>{item.title}</h3>
        <p className={"portfolio-card-status" + (choice?.ready ? " is-ready" : "")}>{choice?.message}</p>
        {canEdit && <PortfolioEditLink id={"portfolio-item-" + encodeURIComponent(item.asset_id)}>Edit this item ↓</PortfolioEditLink>}
      </div>
    </article>;
  });

  return <AppShell active="18+ profile">
    <PageHeader title="Portfolio" subtitle="Choose what belongs on your age-gated More page. Your draft stays private until you approve a release." eyebrow="18+ WORKSPACE" />
    <AdultWorkspaceTabs current="portfolio" />
    {notice && <div className="success" role="status">{notice}</div>}

    <section className="panel portfolio-workspace-intro" aria-labelledby="portfolio-start-title">
      <div className="section-heading"><div><h2 id="portfolio-start-title">Build your private draft</h2><p>Add Library items, choose how their cards look, then approve exactly what goes public.</p></div><span className="portfolio-preview-state">Private draft</span></div>
      <ol className="portfolio-steps">
        <li><strong>1. Add content</strong><span>{draft.items.length} item{draft.items.length === 1 ? "" : "s"} in your draft</span></li>
        <li><strong>2. Prepare cards</strong><span>{readyCount} ready for final checks</span></li>
        <li><strong>3. Publish</strong><span>You select and approve the public previews</span></li>
      </ol>
      <div className="portfolio-intro-actions"><Link className="secondary-action" href="/library">Add from Content Library</Link><a href="#portfolio-publish">Go to publish options ↓</a></div>
    </section>

    <section className="panel portfolio-visual-preview" aria-labelledby="portfolio-preview-title">
      <div className="section-heading"><div><h2 id="portfolio-preview-title">Preview your cards</h2><p>Only you can see this draft preview. Save an item to update its card. The public More page does not change.</p></div><span>{readyCount} of {draft.items.length} ready for checks</span></div>
      <div className="portfolio-preview-frame">
        <div className="portfolio-preview-frame-heading"><span>18+ PORTFOLIO</span><strong>{context.creator.creator_name}</strong><small>Private preview</small></div>
        {draft.items.length
          ? canEdit
            ? <PortfolioBulkCategory action={assignPortfolioCategoryAction} categories={draft.categories} itemCount={draft.items.length}><div className="portfolio-preview-grid">{previewCards}</div></PortfolioBulkCategory>
            : <div className="portfolio-preview-grid">{previewCards}</div>
          : <div className="empty"><b>Your preview starts here.</b><span>Add content from the Library to see how its cards will look.</span></div>}
      </div>
    </section>

    <section className="panel portfolio-taxonomy" id="portfolio-categories">
      <details className="portfolio-labels-details" open={draft.categories.length === 0}>
        <summary><span><strong>Manage categories and genres</strong><small>Categories group your cards. Genres are optional visitor filters.</small></span><span className="portfolio-summary-action">Manage labels</span></summary>
        <div className="portfolio-taxonomy-grid">
          <div><h3>Categories</h3>
            {draft.categories.length ? draft.categories.map((label) => <div className="portfolio-label-row" key={label.id}>
              {canEdit ? <form action={renamePortfolioCategoryAction}><input type="hidden" name="id" value={label.id} /><label><span className="sr-only">Rename category</span><input name="name" maxLength={50} required defaultValue={label.name} /></label><button className="secondary-action" type="submit">Rename</button></form> : <span>{label.name}</span>}
            </div>) : <p>No categories yet. Create one before assigning cards.</p>}
            {canEdit && <form action={createPortfolioCategoryAction} className="portfolio-label-create"><label>New category<input name="name" maxLength={50} required placeholder="e.g. Clips" /></label><button type="submit">Add category</button></form>}
          </div>
          <div><h3>Genres</h3>
            {draft.genres.length ? draft.genres.map((label) => <div className="portfolio-label-row" key={label.id}>
              {canEdit ? <form action={renamePortfolioGenreAction}><input type="hidden" name="id" value={label.id} /><label><span className="sr-only">Rename genre</span><input name="name" maxLength={50} required defaultValue={label.name} /></label><button className="secondary-action" type="submit">Rename</button></form> : <span>{label.name}</span>}
            </div>) : <p>No genres yet. You can leave this empty.</p>}
            {canEdit && <form action={createPortfolioGenreAction} className="portfolio-label-create"><label>New genre<input name="name" maxLength={50} required placeholder="e.g. Performance" /></label><button type="submit">Add genre</button></form>}
          </div>
        </div>
      </details>
    </section>

    <section className="panel portfolio-draft-list" aria-labelledby="portfolio-items-title">
      <div className="section-heading"><div><h2 id="portfolio-items-title">Edit your items</h2><p>Open only the card you want to change. Category is required; genre and description are optional.</p></div><span>{draft.items.length} in draft</span></div>
      {draft.items.length ? draft.items.map((item) => {
        const choice = choiceById.get(item.asset_id);
        const category = draft.categories.find((label) => label.id === item.category_id)?.name;
        const teasers = draft.teasers.filter((teaser) => teaser.id !== item.asset_id);
        const linkedTeasers = teasers.filter((teaser) => teaser.teaser_for_asset_id === item.asset_id);
        const suggestedPreviewId = suggestedLinkedPreviewAssetId(item.asset_id, teasers);
        const orderedTeasers = [...linkedTeasers, ...teasers.filter((teaser) => teaser.teaser_for_asset_id !== item.asset_id)];
        const itemId = "portfolio-item-" + encodeURIComponent(item.asset_id);
        return <article className="portfolio-draft-item" id={itemId} key={item.asset_id}>
          {canEdit ? <details className="portfolio-item-details">
            <summary><span className="portfolio-item-summary-text"><strong>{item.title}</strong><small>{item.basename} · {category ?? "No category"}</small></span><span className={"portfolio-readiness" + (choice?.ready ? " is-ready" : "")}>{choice?.message}</span><span className="portfolio-summary-action">Edit details</span></summary>
            <div className="portfolio-item-body">
              <form action={savePortfolioItemAction} className="portfolio-item-form">
                <input type="hidden" name="assetId" value={item.asset_id} />
                <label>Card title<input name="title" maxLength={100} required defaultValue={item.title} /></label>
                <label>Category<select name="categoryId" defaultValue={item.category_id ?? ""}><option value="">Choose category</option>{draft.categories.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label>
                <label>Genre <span>(optional)</span><select name="genreId" defaultValue={item.genre_id ?? ""}><option value="">No genre</option>{draft.genres.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label>
                <label>Display order<input name="sortOrder" type="number" min={0} max={9999} required defaultValue={item.sort_order} /><small>Lower numbers appear first.</small></label>
                <label className="portfolio-wide">Description <span>(optional)</span><textarea name="description" maxLength={280} defaultValue={item.description} /></label>
                {isVideoPortfolioItem(item) ? <label className="portfolio-wide">Short preview for this full video
                  <select name="previewAssetId" defaultValue={item.preview_asset_id ?? suggestedPreviewId}>
                    <option value="">Choose a separate short video</option>
                    {item.preview_asset_id && !teasers.some((candidate) => candidate.id === item.preview_asset_id) && <option value={item.preview_asset_id}>Previous candidate unavailable · recheck before publishing</option>}
                    {orderedTeasers.map((teaser) => <option value={teaser.id} key={teaser.id}>{teaser.basename}{teaser.teaser_for_asset_id === item.asset_id ? " · linked to this full video" : ""}</option>)}
                  </select>
                  <small>{!item.preview_asset_id && suggestedPreviewId ? "A Library-linked clip is suggested; save to confirm it. " : ""}Use a separate H.264 MP4 teaser. Mark and link it in the Library. It must be no longer than 60 seconds or 64 MB.</small>
                </label> : <input type="hidden" name="previewAssetId" value="" />}
                <div className="portfolio-form-actions"><button type="submit">Save changes to private draft</button><Link href={"/library/" + encodeURIComponent(item.asset_id)}>Review Library item →</Link></div>
              </form>
              {isVideoPortfolioItem(item) && item.preview_asset_id && <div className="portfolio-poster-step" id={"poster-" + encodeURIComponent(item.asset_id)}>
                <h4>Short preview thumbnail</h4><p>This image appears on the Portfolio card before the preview plays.</p>
                <VideoPosterEditor assetId={item.preview_asset_id} label="Short preview thumbnail" posterUrl={(() => { const id = privatePortfolioImageObjectId(item.preview_poster_r2_key); return id ? "/api/preview/" + id : null; })()} />
              </div>}
              {isVideoPortfolioItem(item) && !item.preview_asset_id && <p className="portfolio-poster-hint">Save a short preview choice above, then you can choose its thumbnail here.</p>}
            </div>
          </details> : <div className="portfolio-item-view"><strong>{item.title}</strong><span>{category ?? "No category"} · {choice?.message}</span></div>}
        </article>;
      }) : <div className="empty"><b>No items yet.</b><span>Add an item from the Content Library to start your private draft.</span></div>}
    </section>

    <section className="panel portfolio-publish" id="portfolio-publish" aria-labelledby="portfolio-publish-title">
      <div className="section-heading"><div><h2 id="portfolio-publish-title">Publish to your 18+ More page</h2><p>Choose the cards visitors may see, then give your explicit approval. Full-length files stay private.</p></div><span className={"portfolio-public-state" + (publishedRelease?.status === "published" ? " is-live" : "")}>{publicState}</span></div>
      <div className="portfolio-publish-overview"><div><strong>{readyCount}</strong><span>of {draft.items.length} draft cards ready for final checks</span></div><div><strong>{profileReady ? "Ready" : "Needed"}</strong><span>Published 18+ profile</span></div><div><strong>{latestRelease ? releaseStatus(latestRelease.status) : "No release yet"}</strong><span>Latest Portfolio release</span></div></div>
      {!profileReady && publishingEnabled && <p className="portfolio-publish-attention">Your Portfolio needs a published 18+ profile first. <Link href="/adult-profile">Open 18+ profile →</Link></p>}
      {latestRelease?.status === "failed" && <p className="portfolio-publish-attention">The last release did not go live. {latestRelease.failure_code === "preview_duration_failed" ? "At least one short preview was over 60 seconds or had an unreadable timeline." : "Check the selected media, rights and consent before trying again."}</p>}
      {latestRelease && <p className="portfolio-release-latest">Latest release: {releaseStatus(latestRelease.status)} · approved {latestRelease.approved_at}</p>}
      {publishedRelease && <div className="portfolio-live-actions"><div><strong>{publishedRelease.status === "withdrawing" ? "Removing public Portfolio" : "Your Portfolio is live"}</strong><p>{publishedRelease.status === "withdrawing" ? "The public selection is being removed." : "Visitors see your approved selection after the age gate."}</p></div><a href={"https://more.thathuboverthere.com/age/" + publishedRelease.slug} target="_blank" rel="noreferrer">Open age-gated More page ↗</a>{canEdit && <form action={withdrawPortfolioAction}><input type="hidden" name="versionId" value={publishedRelease.id} /><button className="danger-action" type="submit">{publishedRelease.status === "withdrawing" ? "Retry withdrawal" : "Withdraw public Portfolio"}</button></form>}</div>}
      {canEdit && publishingEnabled
        ? <PortfolioPublishForm action={publishPortfolioAction} items={choices} profileReady={profileReady} />
        : <p>{publishingEnabled ? "Your role cannot publish a Portfolio." : "Public Portfolio publishing is unavailable. Your draft stays private."}</p>}
    </section>
  </AppShell>;
}
