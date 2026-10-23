import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getAssetUseDetail } from "@/lib/asset-use";
import { assetUseSummary, formatUseDate, useLabel, verifiedSocialPost } from "@/lib/asset-use-summary";
import { requireCreatorContext } from "@/lib/identity";

export const dynamic = "force-dynamic";

function count(value: number | null) { return value === null ? "Not available" : value.toLocaleString("en-AU"); }

export default async function AssetUsePage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(assetId)) notFound();
  const context = await requireCreatorContext();
  const detail = await getAssetUseDetail(context.creator.creator_id, assetId);
  if (!detail) notFound();
  const summary = assetUseSummary(detail.events);
  return <AppShell active="Growth insights">
    <PageHeader eyebrow="CONTENT ANALYTICS" title={detail.asset.name} subtitle="Where this asset has been recorded, plus any results THOT OS can actually match to it." />
    <nav className="view-links growth-tabs" aria-label="Analytics sections"><Link href="/growth">Overview</Link><Link className="active" href="/growth/where-used">Where used</Link></nav>
    <div className="growth-used-actions"><Link className="secondary-action" href="/growth/where-used">← All used content</Link><Link className="secondary-action" href={`/library/${encodeURIComponent(detail.asset.id)}`}>Review in Content Library →</Link></div>
    <section className="growth-asset-facts" aria-label="Asset facts"><article><span>Where used</span><strong>{detail.truncated ? `In the latest 100 records: ${summary.headline}` : summary.headline}</strong></article><article><span>Results so far</span><strong>{summary.result}</strong><small>Results describe observed activity, not a claim that a post caused a sale.</small></article></section>
    <section className="panel growth-use-history"><div className="section-heading"><div><h2>Recorded activity</h2><p>Most recent first. A planned action or incomplete receipt is never presented as a confirmed send.</p></div><span>{detail.events.length} shown</span></div>
      {detail.events.length ? <div className="growth-use-events">{detail.events.map((event) => <article className="growth-use-event" key={`${event.kind}:${event.id}`}>
        <div className="growth-use-event-heading"><div><strong>{useLabel(event)}</strong><small>{formatUseDate(event.occurred_at)}{event.account_label ? ` · ${event.account_label}` : ""}{event.role && event.kind === "social" ? ` · ${event.role}` : ""}</small></div><span>{event.status}</span></div>
        {event.kind === "portfolio" && <p>{event.role === "Linked private full video" ? "This private full video was a reference for a public preview; the full video was not placed on More." : event.status === "published" ? "This preview was included in the live More layout." : event.status === "withdrawing" ? "Withdrawal has started; the live result is not yet confirmed here." : "This preview was included in an earlier More release."}</p>}
        {event.kind === "download_link" && <p>A private link record does not by itself prove a watch, purchase or post attribution.</p>}
        {event.kind === "message" && <p>This records an asset attached to an outbound message. Recipient and message contents stay in the private inbox.</p>}
        {event.kind === "vault" && <p>A verified vault upload records delivery to the creator&apos;s vault, not a public post or sale.</p>}
        {event.kind === "social" && !verifiedSocialPost(event) && event.status === "published" && <p>A published status exists, but its external receipt is incomplete or its link could not be validated.</p>}
        {event.kind === "social" && event.external_url && <a href={event.external_url} target="_blank" rel="noreferrer">Open recorded post ↗</a>}
        {event.metrics && <><p className="growth-use-result">Official Instagram observation: {event.metrics.views === null ? "views unavailable" : `${count(event.metrics.views)} views`}{event.metrics.likes === null ? "" : ` · ${count(event.metrics.likes)} likes`}. Collected {formatUseDate(event.metrics.collected_at)}.</p>
          <details className="growth-use-data"><summary>See recorded numbers</summary><dl><div><dt>Views</dt><dd>{count(event.metrics.views)}</dd></div><div><dt>Likes</dt><dd>{count(event.metrics.likes)}</dd></div><div><dt>Comments</dt><dd>{count(event.metrics.comments)}</dd></div><div><dt>Saves</dt><dd>{count(event.metrics.saves)}</dd></div><div><dt>Shares</dt><dd>{count(event.metrics.shares)}</dd></div><div><dt>Source</dt><dd>Official Instagram API observation</dd></div></dl></details></>}
        {event.kind === "social" && !event.metrics && verifiedSocialPost(event) && <small>No matching official post results collected yet.</small>}
      </article>)}</div> : <div className="empty"><strong>No tracked use yet.</strong><span>Library tags describe content; they do not mean it has been sent.</span></div>}
      {detail.truncated && <p>Showing the 100 most recent records for this asset.</p>}
    </section>
    <p className="growth-used-boundary">This page includes tracked social posts, asset-linked outbound messages, vault uploads, More releases, current profile photos and private download links. Manual posts or messages without an asset link cannot be attributed here. Open “See recorded numbers” for the latest matched metric snapshot; missing values are not zero.</p>
  </AppShell>;
}
