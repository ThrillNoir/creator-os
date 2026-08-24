import { AppShell } from "@/components/app-shell";
import { getActiveCreator } from "@/lib/current-creator";
import { getAnalyticsSummary, getAssetCount, getCreatorFinancialSettings, getCreatorReport, getInstagramAnalyticsData, getPremiumEarningsSummary } from "@/lib/db";
import { saveCreatorFinancialSettingsAction } from "@/app/actions";
import "./reporting.css";

export const dynamic = "force-dynamic";

function money(value:number,currency:string){
  try{return new Intl.NumberFormat("en-AU",{style:"currency",currency,maximumFractionDigits:2}).format(value);}
  catch{return `${currency} ${value.toLocaleString("en-AU",{maximumFractionDigits:2})}`;}
}

export default async function ReportingPage({searchParams}:{searchParams:Promise<{notice?:string}>}) {
  const query=await searchParams;
  const creator = await getActiveCreator();
  const report = getCreatorReport(creator.id);
  const libraryAssets = getAssetCount(creator.id);
  const analytics = getAnalyticsSummary(creator.id);
  const instagram = getInstagramAnalyticsData(creator.id);
  const financialSettings=getCreatorFinancialSettings(creator.id);
  const premiumEarnings=getPremiumEarningsSummary(creator.id);
  const agencySplit=financialSettings.agency_split_bps/10000;
  const instagramTotals = instagram.media.reduce((sum, item) => ({
    reach: sum.reach + (item.reach || 0),
    views: sum.views + (item.views || 0),
    interactions: sum.interactions + (item.total_interactions ?? ((item.likes || 0) + (item.comments || 0) + (item.saves || 0) + (item.shares || 0))),
  }), { reach: 0, views: 0, interactions: 0 });
  const usage = libraryAssets ? Math.round((report.uniqueAssets / libraryAssets) * 100) : 0;
  return (
    <AppShell active="Reporting">
      <section className="workspace library-workspace">
        <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · LOCAL OPERATIONS</span><h1>Performance and earnings</h1><p className="page-subtitle">Creator-scoped operational metrics, imported platform earnings and an explainable agency split.</p></div></header>
        {query.notice==="split_saved"&&<div className="connection-alert success">The agency split was saved for {creator.name}. Existing imported earnings have been recalculated.</div>}
        <section className="status-strip">
          <div><span className="metric-icon violet">▦</span><p><strong>{report.totals.variants ?? 0}</strong><small>Post variants</small></p></div>
          <div><span className="metric-icon amber">◷</span><p><strong>{report.totals.needs_approval ?? 0}</strong><small>Need approval</small></p></div>
          <div><span className="metric-icon green">✓</span><p><strong>{report.totals.published ?? 0}</strong><small>Confirmed published</small></p></div>
          <div><span className="metric-icon rose">↗</span><p><strong>{usage}%</strong><small>Library assets used</small></p></div>
        </section>
        <section className="panel reporting-panel">
          <div className="panel-heading"><div><h2>By platform</h2><p>Variants and confirmed publication</p></div></div>
          <div className="report-table"><div className="report-row head"><span>Platform</span><span>Prepared</span><span>Published</span><span>Last confirmed</span></div>{report.byPlatform.map((row) => <div className="report-row" key={row.platform}><strong>{row.platform}</strong><span>{row.variants}</span><span>{row.published}</span><span>{row.last_published_at ? new Date(row.last_published_at).toLocaleDateString("en-AU") : "—"}</span></div>)}</div>
        </section>
        <section className="panel reporting-panel imported-report">
          <div className="panel-heading"><div><h2>Live Instagram evidence</h2><p>Read-only API insights for this creator&apos;s verified account</p></div></div>
          <div className="report-table"><div className="report-row head"><span>Posts</span><span>Reach</span><span>Views</span><span>Interactions</span></div><div className="report-row"><strong>{instagram.media.length}</strong><span>{instagramTotals.reach.toLocaleString()}</span><span>{instagramTotals.views.toLocaleString()}</span><span>{instagramTotals.interactions.toLocaleString()}</span></div></div>
          {!instagram.media.length && <div className="mini-empty">Sync Instagram from Analytics to populate live reporting.</div>}
        </section>
        <section className="panel reporting-panel earnings-panel">
          <div className="panel-heading"><div><h2>OnlyFans and Fansly earnings split</h2><p>Calculated from imported platform earnings. Currencies remain separate and are never added together.</p></div><form action={saveCreatorFinancialSettingsAction} className="split-form"><label>Agency percentage<input type="number" name="agencySplitPercent" min="0" max="100" step="0.01" defaultValue={(financialSettings.agency_split_bps/100).toFixed(2)}/><span>%</span></label><button className="secondary-button" type="submit">Save split</button></form></div>
          <div className="earnings-table"><div className="earnings-row head"><span>Platform</span><span>Imported earnings</span><span>Agency share</span><span>Creator share</span><span>Period</span></div>{premiumEarnings.map((row)=>{const agency=row.imported_earnings*agencySplit;const creatorShare=row.imported_earnings-agency;return <div className="earnings-row" key={`${row.platform}-${row.currency}`}><strong>{row.platform}</strong><span>{money(row.imported_earnings,row.currency)}</span><span>{money(agency,row.currency)}</span><span>{money(creatorShare,row.currency)}</span><small>{row.first_date} to {row.latest_date}</small></div>})}</div>
          {!premiumEarnings.length&&<div className="mini-empty">Import an OnlyFans or Fansly CSV from Analytics to calculate the first earnings split.</div>}
          <p className="earnings-note">“Imported earnings” means the revenue value contained in the reviewed CSV. THOT OS does not assume whether platform fees, tax, refunds or GST have already been deducted.</p>
        </section>
        <section className="panel reporting-panel imported-report">
          <div className="panel-heading"><div><h2>Imported performance</h2><p>Manual platform exports; not live API data</p></div></div>
          <div className="report-table"><div className="report-row head"><span>Platform</span><span>Rows</span><span>Views</span><span>Imported revenue</span></div>{analytics.byPlatform.map((row) => <div className="report-row" key={`${row.platform}-${row.currency}`}><strong>{row.platform}</strong><span>{row.rows}</span><span>{row.views.toLocaleString()}</span><span>{money(row.revenue,row.currency)}</span></div>)}</div>
          {analytics.byPlatform.length === 0 && <div className="mini-empty">No platform exports imported yet.</div>}
        </section>
      </section>
    </AppShell>
  );
}
