import { importAnalyticsCsvAction, syncInstagramAnalyticsAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { getActiveCreator } from "@/lib/current-creator";
import { getAnalyticsSummary, getInstagramAnalyticsData } from "@/lib/db";
import { calculateInstagramTiming } from "@/lib/instagram-timing";

export const dynamic = "force-dynamic";

function number(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

export default async function AnalyticsPage({searchParams}:{searchParams:Promise<{notice?:string}>}) {
  const query=await searchParams;
  const creator = await getActiveCreator();
  const imported = getAnalyticsSummary(creator.id);
  const instagram = getInstagramAnalyticsData(creator.id);
  const timing = calculateInstagramTiming({ media: instagram.media, followerActivity: instagram.followerActivity.map((item) => item.hourly), timeZone: "Australia/Perth" });
  const totals = instagram.media.reduce((sum, item) => ({
    reach: sum.reach + (item.reach || 0), views: sum.views + (item.views || 0),
    interactions: sum.interactions + (item.total_interactions ?? ((item.likes || 0) + (item.comments || 0) + (item.saves || 0) + (item.shares || 0))),
  }), { reach: 0, views: 0, interactions: 0 });
  const latestActivity = instagram.followerActivity[0]?.hourly || {};
  const maxActivity = Math.max(1, ...Object.values(latestActivity));
  return (
    <AppShell active="Analytics">
      <section className="workspace library-workspace">
        <header className="topbar command-header">
          <div><span className="eyebrow">{creator.name.toUpperCase()} · PERFORMANCE INTELLIGENCE</span><h1>Analytics command centre</h1><p className="page-subtitle">Live Instagram evidence, timing recommendations and reviewed manual imports—kept inside this creator workspace.</p></div>
          <form action={syncInstagramAnalyticsAction}><button className="primary-button">↻ Sync Instagram</button></form>
        </header>

        {query.notice==="imported"&&<div className="connection-alert success">The reviewed CSV was imported successfully.</div>}
        {query.notice==="duplicate_import"&&<div className="connection-alert success">That exact CSV was already imported for this platform, so THOT OS did not count it twice.</div>}

        <section className="analytics-live-strip">
          <div><span>Posts analysed</span><strong>{instagram.media.length}</strong><small>{instagram.latestSync?.completed_at ? `Synced ${new Date(instagram.latestSync.completed_at).toLocaleString("en-AU")}` : "Not synced yet"}</small></div>
          <div><span>Reach observed</span><strong>{number(totals.reach)}</strong><small>Across stored post insights</small></div>
          <div><span>Views observed</span><strong>{number(totals.views)}</strong><small>Reels and feed where available</small></div>
          <div><span>Interactions</span><strong>{number(totals.interactions)}</strong><small>Likes, comments, saves and shares</small></div>
        </section>

        {instagram.latestSync?.status === "failed" && <div className="analytics-alert"><strong>Last Instagram sync needs attention</strong><span>{instagram.latestSync.error}</span></div>}

        <div className="timing-layout">
          <section className="panel timing-recommendations">
            <div className="panel-heading"><div><h2>Best times to post</h2><p>Australia/Perth · follower activity blended with this account&apos;s results</p></div><span className={`confidence-pill ${timing.confidence}`}>{timing.confidence} confidence</span></div>
            <div className="timing-list">
              {timing.recommendations.map((slot, index) => <article key={`${slot.weekday}-${slot.hour}`}>
                <b>{index + 1}</b><div><strong>{slot.label}</strong><span>{slot.reason}</span></div><em>{slot.score}</em>
              </article>)}
              {!timing.recommendations.length && <div className="mini-empty">Sync Instagram to calculate the first recommended windows.</div>}
            </div>
            <p className="model-note">{timing.hasFollowerActivity ? "Recommendation score combines follower activity (70%) and observed post performance (30%)." : "Meta returned no hourly follower counts, so current recommendations use observed post performance only."} Confidence increases as THOT OS learns from more posts and snapshots.</p>
          </section>

          <section className="panel follower-clock">
            <div className="panel-heading"><div><h2>Follower activity clock</h2><p>Relative online activity by hour</p></div></div>
            {timing.hasFollowerActivity ? <><div className="hour-bars">
              {Array.from({ length: 24 }, (_, hour) => {
                const value = Number(latestActivity[String(hour)] || 0);
                return <div key={hour} title={`${hour}:00 · ${value.toLocaleString()} online`}><i style={{ height: `${Math.max(4, (value / maxActivity) * 100)}%` }} /><span>{hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span></div>;
              })}
            </div>
            <div className="clock-key"><span>00:00</span><span>Perth local time</span><span>23:00</span></div></> : <div className="activity-unavailable"><strong>Hourly audience data unavailable</strong><span>Meta returned the metric with empty hourly values. THOT OS is using post performance until this account becomes eligible.</span></div>}
          </section>
        </div>

        <section className="panel performance-table-panel">
          <div className="panel-heading"><div><h2>Recent Instagram performance</h2><p>Read-only API data; THOT OS never changes the post</p></div></div>
          <div className="performance-table"><div className="performance-row head"><span>Published</span><span>Type</span><span>Reach</span><span>Views</span><span>Interactions</span><span></span></div>
            {instagram.media.slice(0, 12).map((item) => <div className="performance-row" key={item.media_id}>
              <span>{new Date(item.published_at).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Perth" })}</span>
              <strong>{item.media_product_type || item.media_type || "Post"}</strong><span>{number(item.reach)}</span><span>{number(item.views)}</span>
              <span>{number(item.total_interactions ?? ((item.likes || 0) + (item.comments || 0) + (item.saves || 0) + (item.shares || 0)))}</span>
              <a href={item.permalink} target="_blank" rel="noreferrer">View ↗</a>
            </div>)}
            {!instagram.media.length && <div className="mini-empty">No Instagram performance stored yet.</div>}
          </div>
        </section>

        <div className="connection-layout analytics-import-layout">
          <section className="panel">
            <div className="panel-heading"><div><h2>Manual data bridge</h2><p>For platforms without analytics API access; up to 2 MB or 2,000 rows.</p></div></div>
            <form action={importAnalyticsCsvAction} className="analytics-import-form">
              <label>Platform<select name="platform" required><option value="instagram">Instagram</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="x">X</option><option value="reddit">Reddit</option><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option><option value="myroomz">MyRoomz</option><option value="stripe">Stripe customs</option></select></label>
              <label>CSV export<input type="file" name="file" accept=".csv,text/csv" required /></label>
              <button className="handoff-button">Import reviewed data</button>
            </form>
            <div className="csv-schema"><strong>Accepted columns</strong><code>date, account_handle, impressions, reach, views, followers, subscribers, revenue, currency</code></div>
          </section>
          <section className="panel integration-roadmap analytics-platforms">
            <div className="panel-heading"><div><h2>Manual imports</h2><p>Reviewed rows by source</p></div></div>
            {imported.byPlatform.map((row) => <article key={`${row.platform}-${row.currency}`}><div><strong>{row.platform}</strong><span>{row.rows} rows · {row.currency} · through {row.latest_date}</span></div><b>{row.views.toLocaleString()} views</b></article>)}
            {!imported.byPlatform.length && <div className="mini-empty">No manual analytics imported.</div>}
          </section>
        </div>
      </section>
    </AppShell>
  );
}
