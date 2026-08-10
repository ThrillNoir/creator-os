import { createResearchFindingAction, queueResearchTaskAction } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { getResearchFindings } from "@/lib/db";
import { getActiveCreator } from "@/lib/current-creator";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const creator = await getActiveCreator();
  const findings = getResearchFindings(creator.id);
  return (
    <main className="app-shell">
      <AppNav active="Research" />
      <section className="workspace library-workspace">
        <header className="topbar"><div><span className="eyebrow">{creator.name.toUpperCase()} · SOURCE-BACKED SIGNALS</span><h1>Research inbox</h1><p className="page-subtitle">Evidence can influence an angle; it never overrides creator voice.</p></div></header>
        <section className="panel research-agent-brief">
          <div className="panel-heading"><div><h2>Queue a research brief</h2><p>The agent stays read-only; its sourced output waits for human review.</p></div></div>
          <form action={queueResearchTaskAction} className="research-task-form">
            <select name="platform"><option value="all">All platforms</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="x">X</option><option value="reddit">Reddit</option><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option></select>
            <input name="question" required placeholder="What should the research agent investigate?" />
            <select name="provider"><option value="codex">Codex</option><option value="claude">Claude</option></select>
            <button className="primary-button">Queue for approval</button>
          </form>
        </section>
        <div className="people-layout">
          <section className="panel research-list">
            <div className="panel-heading"><div><h2>{findings.length} findings</h2><p>Current platform and audience intelligence</p></div></div>
            {findings.map((finding) => (
              <article className="finding-row" key={finding.id}>
                <div className="finding-top"><span className="platform-pill">{finding.platform}</span><b className={`confidence ${finding.confidence}`}>{finding.confidence}</b></div>
                <h3>{finding.summary}</h3>
                {finding.recommendation && <p>{finding.recommendation}</p>}
                <div><a href={finding.source_url} target="_blank" rel="noreferrer">{finding.source_name} ↗</a><span>Observed {finding.observed_at}{finding.expires_at ? ` · recheck ${finding.expires_at}` : ""}</span></div>
              </article>
            ))}
            {findings.length === 0 && <div className="mini-empty">No research findings recorded yet.</div>}
          </section>
          <section className="form-panel">
            <div className="form-section-title"><span>＋</span><div><h2>Add finding</h2><p>Every finding needs a source and observation date</p></div></div>
            <form action={createResearchFindingAction} className="person-form">
              <div className="two-fields"><label>Platform<select name="platform"><option value="all">All</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="x">X</option><option value="reddit">Reddit</option><option value="onlyfans">OnlyFans</option><option value="myroomz">MyRoomz</option></select></label><label>Confidence<select name="confidence"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></label></div>
              <label>Source URL<input type="url" name="sourceUrl" required /></label>
              <label>Source name<input name="sourceName" placeholder="Optional; domain used by default" /></label>
              <label>Finding<textarea name="summary" required placeholder="What was observed—not what the agent assumes." /></label>
              <label>Recommended experiment<textarea name="recommendation" /></label>
              <div className="two-fields"><label>Observed<input type="date" name="observedAt" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Recheck/expiry<input type="date" name="expiresAt" /></label></div>
              <button className="primary-button">Save finding</button>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
