import Link from "next/link";
import { notFound } from "next/navigation";
import { importFinanceCsvAction, saveAgencySplitAction } from "@/app/money-actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { roleCan } from "@/lib/authorization";
import { getMoneyDashboard } from "@/lib/finance";
import { requireCreatorContext } from "@/lib/identity";

export const dynamic = "force-dynamic";

function moneyMinor(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function date(value: string) {
  const parsed = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" });
}

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [query, context] = await Promise.all([searchParams, requireCreatorContext()]);
  if (context.creator.role === "viewer") notFound();
  const dashboard = await getMoneyDashboard(context.creator.creator_id);
  const canSetSplit = roleCan(context.creator.role, "manage_identity");
  const split = dashboard.settings.agency_split_bps / 10000;
  return <AppShell active="Money & health">
    <PageHeader eyebrow="MONEY AND RELIABILITY" title="Money & health" subtitle="Imported earnings, verified delivery receipts and the work most likely to protect or grow revenue." />
    {query.notice === "imported" && <div className="success">The reviewed finance CSV was imported. Matching platform, date and currency rows were updated instead of counted twice.</div>}
    {query.notice === "duplicate_import" && <div className="success">That exact export was already imported, so THOT OS did not count it twice.</div>}
    {query.notice === "split_saved" && <div className="success">The agency split was saved and all imported net earnings were recalculated.</div>}

    <section className="money-kpis" aria-label="Money and reliability scorecard">
      <article><span>Verified delivery rate</span><strong>{dashboard.scorecard.deliverySuccessPercent === null ? "—" : `${dashboard.scorecard.deliverySuccessPercent}%`}</strong><small>{dashboard.scorecard.verifiedDeliveries} verified · {dashboard.scorecard.failedDeliveries} failed</small></article>
      <article className={dashboard.scorecard.needsReview ? "attention" : ""}><span>Needs review</span><strong>{dashboard.scorecard.needsReview}</strong><small>Failed or stalled deliveries</small></article>
      <article><span>Waiting on device</span><strong>{dashboard.scorecard.awaitingDevice}</strong><small>Approved, claimed or staged vault jobs</small></article>
      <article><span>Unread conversations</span><strong>{dashboard.scorecard.unreadConversations}</strong><small>Open threads that may need a reply</small></article>
    </section>

    <div className="money-layout">
      <section className="panel earnings-panel">
        <div className="section-heading"><div><span className="eyebrow">IMPORTED EARNINGS</span><h2>Premium revenue by currency</h2><p>Currencies stay separate. Net means the value in the reviewed export, not a tax or accounting determination.</p></div></div>
        {dashboard.earnings.length ? <div className="money-table"><div className="money-row head"><span>Platform</span><span>Imported net</span><span>Agency share</span><span>Creator share</span><span>Period</span></div>{dashboard.earnings.map((row) => {
          const agencyMinor = Math.round(row.net_revenue_minor * split);
          return <div className="money-row" key={`${row.platform}-${row.currency}`}><strong>{row.platform}</strong><span>{moneyMinor(row.net_revenue_minor, row.currency)}</span><span>{moneyMinor(agencyMinor, row.currency)}</span><span>{moneyMinor(row.net_revenue_minor - agencyMinor, row.currency)}</span><small>{row.first_date} → {row.latest_date}</small></div>;
        })}</div> : <div className="empty"><b>No earnings have been imported yet.</b><span>Import a reviewed OnlyFans, Fansly or Stripe CSV below. THOT OS will not estimate missing revenue.</span></div>}
      </section>

      <aside className="panel money-actions-panel">
        <div className="section-heading"><div><span className="eyebrow">REVENUE SETTINGS</span><h2>Agency split</h2><p>Applied only to imported net earnings.</p></div></div>
        {canSetSplit ? <form className="money-split-form" action={saveAgencySplitAction}><label>Agency percentage<div><input name="agencySplitPercent" type="number" min="0" max="100" step="0.01" defaultValue={(dashboard.settings.agency_split_bps / 100).toFixed(2)} /><span>%</span></div></label><button className="secondary-action" type="submit">Save split</button></form> : <p className="money-readonly">Agency administrators control the split. Current setting: {(dashboard.settings.agency_split_bps / 100).toFixed(2)}%.</p>}
        <dl className="money-definitions"><div><dt>Revenue basis</dt><dd>Imported net earnings</dd></div><div><dt>Approval coverage</dt><dd>{dashboard.scorecard.approvalCoveragePercent === null ? "No approved delivery history" : `${dashboard.scorecard.approvalCoveragePercent}%`}</dd></div></dl>
      </aside>
    </div>

    <div className="money-layout lower">
      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">REVIEWED DATA BRIDGE</span><h2>Import platform earnings</h2><p>Up to 1 MB and 400 daily rows. Re-importing a date updates that platform and currency instead of duplicating it.</p></div></div>
        <form className="finance-import-form" action={importFinanceCsvAction}>
          <label>Platform<select name="platform" required><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option><option value="stripe">Stripe</option></select></label>
          <label>CSV export<input name="file" type="file" accept=".csv,text/csv" required /></label>
          <button className="primary" type="submit">Import reviewed earnings</button>
        </form>
        <div className="finance-schema"><strong>Accepted columns</strong><code>date, revenue, currency, subscribers</code><span>Also supports gross_revenue, refunds and net_revenue.</span></div>
      </section>

      <aside className="panel opportunity-panel">
        <div className="section-heading"><div><span className="eyebrow">NEXT BEST WORK</span><h2>Revenue-protection queue</h2></div></div>
        <Link href="/operations"><strong>{dashboard.scorecard.needsReview}</strong><span>failed or stalled deliveries to review</span><b>Open Operations →</b></Link>
        <Link href="/operations?platform=fansly"><strong>{dashboard.scorecard.awaitingDevice}</strong><span>vault jobs waiting on the signed browser</span><b>Open Vault →</b></Link>
        <Link href="/messages"><strong>{dashboard.scorecard.unreadConversations}</strong><span>unread conversations</span><b>Open Messages →</b></Link>
      </aside>
    </div>

    <section className="panel import-history">
      <div className="section-heading"><div><span className="eyebrow">PROVENANCE</span><h2>Recent finance imports</h2><p>Every number remains traceable to a creator-scoped export and human operator.</p></div></div>
      {dashboard.imports.length ? <div>{dashboard.imports.map((item) => <article key={item.id}><div><strong>{item.platform} · {item.source_name}</strong><small>{item.row_count} rows · imported by {item.imported_by}</small></div><time>{date(item.imported_at)}</time></article>)}</div> : <div className="empty">No finance import receipts yet.</div>}
    </section>
  </AppShell>;
}
