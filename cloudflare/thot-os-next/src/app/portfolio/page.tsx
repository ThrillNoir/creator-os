import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AdultWorkspaceTabs } from "@/components/adult-workspace-tabs";
import { PortfolioEditor } from "@/components/portfolio-editor";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";
import { getPortfolioDraft } from "@/lib/portfolio-authoring";
import { portfolioReleaseFailure } from "@/lib/portfolio-blockers";
import { privatePortfolioImageObjectId } from "@/lib/portfolio-preview";
import { getPortfolioReleaseFacts } from "@/lib/portfolio-release-facts";
import { isVideoPortfolioItem } from "@/lib/portfolio-video";
import { createPortfolioCategoryAction, renamePortfolioCategoryAction, savePortfolioDraftAction,
  publishPortfolioAction, withdrawPortfolioAction } from "./actions";

type Release = { id: string; status: string; approved_at: string; failure_code: string | null; slug: string; manifest_json: string };

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const env = cloudflareEnv();
  if (String((env as { PORTFOLIO_AUTHORING_ENABLED?: string }).PORTFOLIO_AUTHORING_ENABLED) !== "1") notFound();
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  const creatorId = context.creator.creator_id;
  const publishingEnabled = String((env as { PORTFOLIO_PUBLISHING_ENABLED?: string }).PORTFOLIO_PUBLISHING_ENABLED) === "1";
  const [draft, recent, profile] = await Promise.all([
    getPortfolioDraft(creatorId),
    publishingEnabled ? creatorPrepare(env.DB, creatorId, `SELECT r.id,r.status,r.approved_at,r.failure_code,r.manifest_json,c.slug
      FROM creator_portfolio_release_versions r JOIN creators c ON c.id=r.creator_id
      WHERE r.creator_id=@creator ORDER BY r.approved_at DESC,r.id DESC LIMIT 10`).all<Release>().then((rows) => rows.results) : Promise.resolve([] as Release[]),
    publishingEnabled ? creatorPrepare(env.DB, creatorId, `SELECT p.published_version_id FROM creator_adult_profiles p
      JOIN creator_adult_profile_versions v ON v.id=p.published_version_id AND v.creator_id=p.creator_id AND v.status='published'
      WHERE p.creator_id=@creator AND p.status='active'`).first() : Promise.resolve(null),
  ]);
  const live = recent.find((release) => release.status === "published" || release.status === "withdrawing");
  const latest = recent[0];
  const failureEvent = latest?.status === "failed" ? await creatorPrepare(env.DB, creatorId,
    `SELECT detail FROM creator_portfolio_release_events WHERE creator_id=@creator AND release_version_id=? AND event_type='publish_failed' ORDER BY created_at DESC,id DESC LIMIT 1`)
    .bind(latest.id).first<{ detail: string }>() : null;
  const latestFailure = latest?.status === "failed" ? portfolioReleaseFailure(latest.failure_code,
    { detail: failureEvent?.detail ?? null, manifest: latest.manifest_json }) : null;
  const mediaFacts = await getPortfolioReleaseFacts(creatorId, [...draft.items.map((item) => item.asset_id), ...draft.fullVideos.map((video) => video.id)]);
  const cards = draft.items.map((item) => {
    const privateImageId = privatePortfolioImageObjectId(item.preview_r2_key);
    return { assetId: item.asset_id, basename: item.basename, title: item.title, description: item.description,
      categoryId: item.category_id, fullLengthAssetId: item.full_length_asset_id,
      video: isVideoPortfolioItem(item), legacy: item.preview_confirmed !== 1, visible: item.is_visible === 1, sourceAvailable: Boolean(item.source_available),
      mediaReady: Boolean(item.preview_r2_key), previewKey: item.preview_r2_key,
      imageUrl: privateImageId ? `/api/preview/${privateImageId}` : null };
  });
  return <AppShell active="18+ profile">
    <PageHeader title="Portfolio" eyebrow="18+ WORKSPACE" subtitle="Arrange the previews for your age-gated More page. Editing this draft never changes the live page." />
    <AdultWorkspaceTabs current="portfolio" />
    {query.notice === "draft_saved" && <p className="success" role="status">Private draft saved. Your More page is unchanged.</p>}
    {query.notice === "publication_started" && <p className="success" role="status">Publication started. The current layout is being checked before it goes live.</p>}
    {query.notice === "withdrawal_started" && <p className="success" role="status">Withdrawal started. Refresh to confirm removal from your More page.</p>}
    <div className="panel portfolio-workspace-intro"><h2>Build your More page</h2>
      <p>Open a photo or short clip in the Content Library, choose <strong>Add to Portfolio</strong>, set its category and optionally link a private full-length video, then save once. Return here to arrange cards or approve publication. The full video is never shown on More.</p>
      <Link className="secondary-action" href="/library">Open Content Library →</Link></div>
    <PortfolioEditor key={JSON.stringify([draft.revision, ...draft.items.map((item) => item.preview_r2_key)])} creatorName={context.creator.creator_name} revision={draft.revision} cards={cards} initialContact={draft.contact}
      categories={draft.categories} fullVideos={draft.fullVideos} canEdit={roleCan(context.creator.role, "mutate")}
      publishingEnabled={publishingEnabled} profileReady={Boolean(profile)} mediaFacts={mediaFacts}
      latestFailure={latestFailure}
      saveAction={savePortfolioDraftAction} publishAction={publishPortfolioAction}
      createCategoryAction={createPortfolioCategoryAction} renameCategoryAction={renamePortfolioCategoryAction} />
    <section className="panel portfolio-publish" aria-labelledby="portfolio-live-title">
      <div className="section-heading"><div><h2 id="portfolio-live-title">Live on More</h2><p>The last approved release is separate from the private draft above.</p></div><span className={live?.status === "published" ? "portfolio-public-state is-live" : "portfolio-public-state"}>{live?.status === "published" ? "Live" : live?.status === "withdrawing" ? "Withdrawing" : "No live portfolio"}</span></div>
      {latestFailure && <p className="portfolio-publish-attention">The latest publication did not complete: {latestFailure.message}. Your saved draft is still private.</p>}
      {live && <div className="portfolio-live-actions"><a href={`https://more.thathuboverthere.com/age/${live.slug}`} target="_blank" rel="noreferrer">Open age-gated More page ↗</a>
        {roleCan(context.creator.role, "mutate") && <form action={withdrawPortfolioAction}><input type="hidden" name="versionId" value={live.id} /><button className="danger-action" type="submit">Withdraw live Portfolio now</button></form>}
      </div>}
      {!live && <p>No public Portfolio is active. Saving a draft does not publish it.</p>}
    </section>
  </AppShell>;
}
