import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getGrowthInsights, type InsightConfidence } from "@/lib/growth-insights";
import { requireCreatorContext } from "@/lib/identity";

export const dynamic = "force-dynamic";

function date(value: string | null) {
  if (!value) return "Not collected";
  const normalized = value.replace(" ", "T");
  const parsed = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

function confidenceLabel(value: InsightConfidence) {
  return value === "insufficient" ? "Insufficient evidence" : value[0].toUpperCase() + value.slice(1) + " confidence";
}

function qualityLabel(value: "official" | "incomplete" | "stale" | "unavailable") {
  return value[0].toUpperCase() + value.slice(1);
}

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  const context = await requireCreatorContext();
  const query = await searchParams;
  const insights = await getGrowthInsights(context.creator.creator_id, query.accountId);
  return <AppShell active="Growth insights">
    <PageHeader eyebrow="OFFICIAL METRICS" title="Growth insights" subtitle="Creator-scoped Instagram evidence, metric coverage and recommendations that stay in human control." />
    <nav className="view-links growth-tabs" aria-label="Analytics sections"><Link className="active" href="/growth">Overview</Link><Link href="/growth/where-used">Where used</Link></nav>
    <section className="panel growth-where-intro"><div><h2>Where has my content been used?</h2><p>See a plain-English summary for each Library asset, then open its recorded placements and available results.</p></div><Link className="secondary-action" href="/growth/where-used">Explore content use →</Link></section>
    <section className="growth-summary" aria-label="Growth evidence summary">
      <article><span>Official media</span><strong>{insights.summary.officialMedia}</strong><small>Latest item per Instagram media ID</small></article>
      <article><span>Complete metric sets</span><strong>{insights.summary.completeMetricMedia}</strong><small>Views plus likes, comments, saves and shares</small></article>
      <article><span>Fresh comparable media</span><strong>{insights.summary.freshComparableMedia}</strong><small>Complete metrics collected within the last 14 days</small></article>
      <article><span>Metric coverage</span><strong>{insights.summary.metricCoveragePercent === null ? "—" : `${insights.summary.metricCoveragePercent}%`}</strong><small>Missing values are never converted to zero</small></article>
      <article><span>Evidence confidence</span><strong>{confidenceLabel(insights.summary.confidence)}</strong><small>Latest observation {date(insights.summary.latestObservedAt)}</small></article>
      <article><span>Data quality</span><strong>{insights.summary.dataQuality.map(qualityLabel).join(" · ")}</strong><small>Official provider data stays distinct from incomplete or stale evidence</small></article>
    </section>

    <section className="panel growth-method">
      <div className="section-heading"><div><span className="eyebrow">MEASUREMENT CONTRACT</span><h2>What this page can—and cannot—do</h2></div><Link className="secondary-action" href={`/operations?platform=instagram&section=analytics${query.accountId ? `&accountId=${encodeURIComponent(query.accountId)}` : ""}`}>Open Instagram analytics</Link></div>
      <p>{insights.metricDefinition}</p>
      <p>Only the creator&apos;s verified Instagram API observations enter this calculation. Recommendations are read-only: they cannot like, comment, follow, message, create, schedule, approve or publish anything.</p>
      <p>Instagram engagement observations and daily earnings have no exclusive link to individual posts, subscribers or spend. Subscriber and spender attribution is unavailable here, so THOT OS does not guess post revenue or claim a post caused earnings.</p>
    </section>

    <section className="panel growth-recommendations">
      <div className="section-heading"><div><span className="eyebrow">EVIDENCE-BASED NEXT STEPS</span><h2>Recommendations for review</h2><p>Every suggestion includes the observed source, sample size, confidence and next recheck point.</p></div><span>{insights.recommendations.length} current</span></div>
      <div className="growth-recommendation-list">
        {insights.recommendations.map((recommendation) => <article className="growth-recommendation" key={recommendation.id}>
          <div className="growth-recommendation-heading"><span className={`confidence ${recommendation.confidence}`}>{confidenceLabel(recommendation.confidence)}</span><strong>{recommendation.title}</strong></div>
          <p>{recommendation.summary}</p>
          <dl className="growth-evidence"><div><dt>Source</dt><dd>{recommendation.evidence.sourceLabel}{recommendation.evidence.sourceUrl && <> · <a href={recommendation.evidence.sourceUrl} target="_blank" rel="noreferrer">open observed media ↗</a></>}</dd></div><div><dt>Observed</dt><dd>{date(recommendation.evidence.observedAt)}</dd></div><div><dt>Sample</dt><dd>{recommendation.evidence.sampleSize} comparable · {recommendation.evidence.completeMetricMedia}/{recommendation.evidence.mediaCount} complete</dd></div><div><dt>Recheck</dt><dd>{date(recommendation.recheckAt)}</dd></div>{recommendation.evidence.weightedEngagementRatePercent !== null && <div><dt>Weighted rate</dt><dd>{recommendation.evidence.weightedEngagementRatePercent}%{recommendation.evidence.comparisonRatePercent !== null ? ` · baseline ${recommendation.evidence.comparisonRatePercent}%` : ""}</dd></div>}</dl>
          <small>Action boundary: human review only. No public action is created from this recommendation.</small>
        </article>)}
      </div>
    </section>
  </AppShell>;
}
