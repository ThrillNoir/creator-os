import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getUsedAssetsPage } from "@/lib/asset-use";
import { formatUseDate } from "@/lib/asset-use-summary";
import { requireCreatorContext } from "@/lib/identity";

export const dynamic = "force-dynamic";

function pageHref(query: string, page: number) {
  const params = new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page) });
  return `/growth/where-used?${params}`;
}

export default async function WhereUsedPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const context = await requireCreatorContext();
  const params = await searchParams;
  const result = await getUsedAssetsPage(context.creator.creator_id, params.q, params.page);
  return <AppShell active="Growth insights">
    <PageHeader eyebrow="CONTENT ANALYTICS" title="Where used" subtitle="A quick record of where your Library content was posted, uploaded or shown. Open an asset for its evidence and results." />
    <nav className="view-links growth-tabs" aria-label="Analytics sections"><Link href="/growth">Overview</Link><Link className="active" href="/growth/where-used">Where used</Link></nav>
    <section className="panel growth-used-list">
      <div className="section-heading"><div><h2>Content with recorded use</h2><p>Confirmed actions, drafts and earlier releases have different labels. Library destination tags alone do not count as use.</p></div><Link className="secondary-action" href="/library">Open Content Library →</Link></div>
      <form className="growth-used-search" method="get"><label>Find an asset<input type="search" name="q" maxLength={120} defaultValue={result.query} placeholder="Search your Library names" /></label><button className="secondary-action" type="submit">Search</button>{result.query && <Link href="/growth/where-used">Clear</Link>}</form>
      {result.assets.length ? <div className="growth-used-grid">{result.assets.map((asset) => <article className="growth-used-card" key={asset.id}>
        <div><span className="eyebrow">{asset.extension.toUpperCase()} · LAST RECORDED {formatUseDate(asset.latest_at)}</span><h3><Link href={`/growth/assets/${encodeURIComponent(asset.id)}`}>{asset.name}</Link></h3></div>
        <p>{[
          asset.posts_with_receipt ? `${asset.posts_with_receipt} post${asset.posts_with_receipt === 1 ? "" : "s"} with external receipt${asset.posts_with_receipt === 1 ? "" : "s"}` : "",
          asset.verified_vault_uploads ? `${asset.verified_vault_uploads} verified vault upload${asset.verified_vault_uploads === 1 ? "" : "s"}` : "",
          asset.sent_messages ? `${asset.sent_messages} sent message${asset.sent_messages === 1 ? "" : "s"}` : "",
          asset.current_page_placements ? `${asset.current_page_placements} current profile or More placement${asset.current_page_placements === 1 ? "" : "s"}` : "",
        ].filter(Boolean).join(" · ") || "Activity recorded; no confirmed placement yet."}</p>
        {asset.latest_result && <p className="growth-use-result">Latest official Instagram observation: {asset.latest_result.views === null ? "views unavailable" : `${asset.latest_result.views.toLocaleString("en-AU")} views`}{asset.latest_result.likes === null ? "" : ` · ${asset.latest_result.likes.toLocaleString("en-AU")} likes`}. Collected {formatUseDate(asset.latest_result.collected_at)}.</p>}
        <Link className="secondary-action" href={`/growth/assets/${encodeURIComponent(asset.id)}`}>View summary and results →</Link>
      </article>)}</div> : <div className="empty"><strong>No tracked use found.</strong><span>{result.query ? "Try another Library name." : "Your Library can contain assets before any post, vault upload or page release is recorded."}</span></div>}
      {(result.page > 1 || result.hasNextPage) && <nav className="view-links" aria-label="Content use pages">{result.page > 1 ? <Link href={pageHref(result.query, result.page - 1)}>Previous</Link> : null}<span>Page {result.page}</span>{result.hasNextPage ? <Link href={pageHref(result.query, result.page + 1)}>Next</Link> : null}</nav>}
    </section>
    <p className="growth-used-boundary">This view uses records THOT OS can link to an asset. It cannot discover posts made outside THOT OS or infer sales from views, clicks or messages.</p>
  </AppShell>;
}
