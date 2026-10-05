import Link from "next/link";
import { notFound } from "next/navigation";
import { recordCommissionPaymentAction, saveAgencySplitAction } from "@/app/money-actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { FinanceCsvImportForm } from "@/components/finance-csv-import-form";
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
  const latestProposal = dashboard.agencySplitProposals[0] ?? null;
  const splitSet = dashboard.settings !== null || latestProposal !== null;
  const savedPercentage = latestProposal?.agency_split_bps ?? dashboard.settings?.agency_split_bps ?? null;
  return <AppShell active="Money & health">
    <PageHeader eyebrow="MONEY AND RELIABILITY" title="Money & health" subtitle="Platforms pay creators directly. THOT OS shows imported earnings and records commission proposals without inferring eligible sales or amounts due." />
    {query.notice === "imported" && <div className="success">The reviewed finance CSV was imported. Matching platform, date and currency rows were updated instead of counted twice.</div>}
    {query.notice === "duplicate_import" && <div className="success">That exact export was already imported, so THOT OS did not count it twice.</div>}
    {query.notice === "split_saved" && <div className="success">The commission percentage proposal was saved as an immutable version. Its calculation base and cadence remain unresolved.</div>}
    {query.notice === "commission_payment_reported" && <div className="success">The agency-reported payment evidence was recorded.</div>}

    <section className="money-kpis" aria-label="Money and reliability scorecard">
      <article><span>Verified delivery rate</span><strong>{dashboard.scorecard.deliverySuccessPercent === null ? "—" : `${dashboard.scorecard.deliverySuccessPercent}%`}</strong><small>{dashboard.scorecard.verifiedDeliveries} verified · {dashboard.scorecard.failedDeliveries} failed</small></article>
      <article className={dashboard.scorecard.needsReview ? "attention" : ""}><span>Needs review</span><strong>{dashboard.scorecard.needsReview}</strong><small>Failed or stalled deliveries</small></article>
      <article><span>Waiting on device</span><strong>{dashboard.scorecard.awaitingDevice}</strong><small>Approved, claimed or staged vault jobs</small></article>
      <article><span>Unread conversations</span><strong>{dashboard.scorecard.unreadConversations}</strong><small>Open threads that may need a reply</small></article>
    </section>

    <div className="money-layout">
      <section className="panel earnings-panel">
        <div className="section-heading"><div><span className="eyebrow">IMPORTED EARNINGS</span><h2>Premium revenue by currency</h2><p>Currencies stay separate. Net means the value in the reviewed export, not a tax or accounting determination. The calculation base and cadence are unresolved, so commission allocations are unavailable.</p></div></div>
        {dashboard.earnings.length ? <div className="money-table"><div className="money-row head"><span>Platform</span><span>Imported net</span><span>Commission allocation</span><span>Creator allocation</span><span>Period</span></div>{dashboard.earnings.map((row) => {
          return <div className="money-row" key={`${row.platform}-${row.currency}`}><strong>{row.platform}</strong><span>{moneyMinor(row.net_revenue_minor, row.currency)}</span><span>—</span><span>—</span><small>{row.first_date} → {row.latest_date}</small></div>;
        })}</div> : <div className="empty"><b>No earnings have been imported yet.</b><span>Import a reviewed OnlyFans, Fansly or Stripe CSV below. THOT OS will not estimate missing revenue.</span></div>}
      </section>

      <aside className="panel money-actions-panel">
        <div className="section-heading"><div><span className="eyebrow">REVENUE SETTINGS</span><h2>Commission split proposal</h2><p>Platforms pay creators directly. The proposal covers only paid-site sales generated through THOT OS; evidence identifying those sales is unresolved. The calculation base and cadence still need agreement. THOT OS currently charges no software or subscription fee; future fees are undecided, and platform deductions are unknown.</p></div></div>
        {canSetSplit ? <form className="money-split-form" action={saveAgencySplitAction}>
          <input type="hidden" name="requestId" value={crypto.randomUUID()} />
          <label>THOT OS commission proposal<div><input name="agencySplitPercent" type="number" min="0" max="100" step="0.01" required defaultValue={savedPercentage === null ? "50.00" : (savedPercentage / 100).toFixed(2)} /><span>%</span></div></label>
          <label>Effective date<input name="effectiveOn" type="date" required /></label>
          <button className="secondary-action" type="submit">Save proposal version</button>
        </form> : <p className="money-readonly">Agency administrators control the commission proposal. Current saved percentage: {savedPercentage === null ? "Split rules not set" : `${(savedPercentage / 100).toFixed(2)}%`}. This is a proposal or legacy saved percentage; eligibility evidence, base and cadence remain unresolved.</p>}
        {!splitSet && <p className="money-readonly">Split rules not set. The 50% starting proposal is only a form default and has not been saved. Commission allocations remain unavailable.</p>}
        {dashboard.agencySplitProposals.length > 0 && <section aria-label="Commission proposal history"><h3>Recent proposal versions</h3><p>Append-only proposals with effective dates. They cover THOT OS-generated paid-site sales only and do not establish eligibility evidence, a calculation base, cadence, invoice, or amount due.</p><div className="money-table">{dashboard.agencySplitProposals.map((item) => <article className="money-row" key={item.id}><strong>{(item.agency_split_bps / 100).toFixed(2)}% proposal</strong><span>Effective {item.effective_on}</span><span>Eligibility, base and cadence unresolved · no current THOT OS software fee</span><small>Recorded by {item.actor} · {date(item.created_at)}</small></article>)}</div></section>}
        {context.creator.role === "agency_admin" && splitSet ? <>
          <div className="section-heading"><div><span className="eyebrow">MANUAL EVIDENCE</span><h2>Commission payment reported</h2><p>Record an amount reported received by the agency. This is human-reported evidence only, not bank-verified and not reconciled against an amount due.</p></div></div>
          <form className="money-split-form" action={recordCommissionPaymentAction}>
            <input type="hidden" name="requestId" value={crypto.randomUUID()} />
            <label>Reported received date<input name="receivedOn" type="date" required /></label>
            <label>Amount reported<input name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" inputMode="decimal" required /></label>
            <label>Currency code<input name="currency" type="text" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" autoComplete="off" placeholder="AUD" required /></label>
            <label>Non-sensitive payment reference<input name="reference" type="text" maxLength={160} autoComplete="off" required /></label>
            <button className="secondary-action" type="submit">Record reported payment</button>
          </form>
        </> : context.creator.role === "agency_admin" ? <p className="money-readonly">Save a commission percentage proposal before recording payment evidence. A saved 0% remains an explicit setting.</p> : null}
        <section aria-label="Agency-reported commission payment evidence">
          <h3>Recent agency-reported evidence</h3>
          <p>These entries record what an agency administrator reported; they do not verify a bank transfer or state an amount due.</p>
          {dashboard.commissionPaymentEvidence.length ? <div className="money-table">{dashboard.commissionPaymentEvidence.map((item) => <article className="money-row" key={item.id}>
            <strong>{moneyMinor(item.amount_minor, item.currency)} reported</strong>
            <span>Received date: {item.received_on}</span>
            <span>Reference: {item.reference}</span>
            <small>Recorded by {item.actor} · {date(item.created_at)}</small>
          </article>)}</div> : <div className="empty">No commission payment evidence has been recorded.</div>}
        </section>
        <dl className="money-definitions"><div><dt>Commission allocation</dt><dd>Unavailable while eligible sales, base and cadence remain unresolved</dd></div><div><dt>Approval coverage</dt><dd>{dashboard.scorecard.approvalCoveragePercent === null ? "No approved delivery history" : `${dashboard.scorecard.approvalCoveragePercent}%`}</dd></div></dl>
      </aside>
    </div>

    <div className="money-layout lower">
      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">REVIEWED DATA BRIDGE</span><h2>Import platform earnings</h2><p>Up to 1 MB and 400 daily rows. Re-importing a date updates that platform and currency instead of duplicating it.</p></div></div>
        <FinanceCsvImportForm />
        <div className="finance-schema"><strong>Manual import of a reviewed platform CSV</strong><code>date, revenue, currency, subscribers</code><span>THOT OS reads the normalized CSV only; it does not connect to platform earnings APIs. Also supports gross_revenue, refunds and net_revenue.</span></div>
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
