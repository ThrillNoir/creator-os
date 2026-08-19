import { AppShell, PageHeader } from "@/components/app-shell";
import { requireCreatorContext } from "@/lib/identity";
import { getCreatorLaunchReadiness, type ReadinessStatus } from "@/lib/launch-readiness";

export const dynamic = "force-dynamic";

function date(value: string | null) {
  if (!value) return "Not observed";
  const normalized = value.replace(" ", "T");
  const parsed = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

function label(status: ReadinessStatus) {
  return status === "ready" ? "Ready" : status === "attention" ? "Needs attention" : "Blocked";
}

export default async function LaunchReadinessPage() {
  const context = await requireCreatorContext("manage_identity");
  const readiness = await getCreatorLaunchReadiness(context.creator.creator_id);
  return <AppShell active="Launch readiness">
    <PageHeader eyebrow="STAGING RELEASE GATE" title="Launch readiness" subtitle="Current creator-scoped evidence for a controlled release. This page is read-only and cannot deploy, publish, refresh a provider or change a public profile." />
    <section className="launch-summary" aria-label="Launch readiness summary">
      <article><span>Ready</span><strong>{readiness.summary.ready}</strong><small>Evidence checks currently clear</small></article>
      <article className="attention"><span>Attention</span><strong>{readiness.summary.attention}</strong><small>Review before relying on the result</small></article>
      <article className="blocked"><span>Blocked</span><strong>{readiness.summary.blocked}</strong><small>Production remains intentionally unavailable</small></article>
      <article><span>Evidence scope</span><strong>Staging</strong><small>Generated {date(readiness.generatedAt)}</small></article>
    </section>
    <section className="connection-banner attention"><div><strong>Staging evidence only</strong><span>Passing checks here is not production authorization. Production resources, a custom domain and any real creator route remain out of scope until you explicitly approve the cutover.</span></div></section>
    <section className="panel launch-checks">
      <div className="section-heading"><div><span className="eyebrow">CONTROLLED RELEASE EVIDENCE</span><h2>What needs to be true</h2><p>Every blocker and attention item is intentionally visible. Missing provider values are retained as unavailable rather than converted to performance data.</p></div></div>
      <div className="post-list">{readiness.checks.map((check) => <article className="post-row" key={check.id}>
        <span className={`account-status ${check.status}`}>{label(check.status)}</span>
        <div><strong>{check.title}</strong><small>{check.summary}</small></div>
        <div className="post-time"><small>{date(check.observedAt)}</small></div>
      </article>)}</div>
    </section>
  </AppShell>;
}
