import Link from "next/link";
import { sendAgencyMessageToCreatorAction } from "@/app/actions";
import { AppNav } from "@/components/app-nav";
import { getActiveCreator } from "@/lib/current-creator";
import { getAccounts, getAgentTasks, getAssetCount, getCreatorReadiness, getPostPackages, getResearchFindings, getTelegramCreatorPairing, getTelegramSendLog } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ telegram?: string }> }) {
  const creator = await getActiveCreator();
  const query = await searchParams;
  const posts = getPostPackages(creator.id);
  const accounts = getAccounts(creator.id);
  const research = getResearchFindings(creator.id, true);
  const tasks = getAgentTasks(creator.id);
  const assetCount = getAssetCount(creator.id);
  const readiness = getCreatorReadiness(creator.id);
  const telegramPairing = getTelegramCreatorPairing(creator.id);
  const telegramLog = getTelegramSendLog(creator.id, 12);
  const awaitingApproval = posts.filter((post) => post.status === "needs_approval" || post.status === "draft");
  const approved = posts.filter((post) => post.status === "approved");

  return (
    <main className="app-shell">
      <AppNav active="Overview" />
      <section className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">{creator.status === "setup" ? "CREATOR SETUP" : "ACTIVE WORKSPACE"}</span><h1>{creator.name} dashboard</h1><p className="page-subtitle">Content operations, approvals and agent work in one creator-scoped view.</p></div>
          <div className="header-actions"><Link className="primary-button button-link" href="/content/new"><span>＋</span> Add content</Link></div>
        </header>

        <section className="status-strip">
          <div><span className="metric-icon violet">▦</span><p><strong>{assetCount}</strong><small>Assets indexed</small></p></div>
          <div><span className="metric-icon amber">◷</span><p><strong>{awaitingApproval.length}</strong><small>Need approval</small></p></div>
          <div><span className="metric-icon green">✓</span><p><strong>{approved.length}</strong><small>Approved handoffs</small></p></div>
          <div><span className="metric-icon rose">↗</span><p><strong>{accounts.length}</strong><small>Accounts configured</small></p></div>
        </section>

        {creator.status === "setup" && (
          <section className="onboarding-panel panel">
            <div className="panel-heading"><div><h2>Set up {creator.name}</h2><p>{readiness.completed} of {readiness.total} essentials complete</p></div><b>{Math.round((readiness.completed / readiness.total) * 100)}%</b></div>
            <div className="onboarding-progress"><i style={{ width: `${(readiness.completed / readiness.total) * 100}%` }} /></div>
            <div className="onboarding-checks">{readiness.checks.map((check) => <Link className={check.complete ? "complete" : ""} href={check.href} key={check.key}><span>{check.complete ? "✓" : "○"}</span>{check.label}<b>→</b></Link>)}</div>
          </section>
        )}

        <div className="content-grid">
          <section className="panel approval-panel">
            <div className="panel-heading"><div><h2>Approval queue</h2><p>Latest creator-specific post variants</p></div><Link className="text-button" href="/approvals">View all →</Link></div>
            <div className="dashboard-list">
              {posts.slice(0, 6).map((post) => (
                <Link className="dashboard-row" href={`/approvals/${post.id}`} key={post.id}>
                  <span className={`platform ${post.platform === "instagram" ? "purple" : post.platform === "reddit" ? "orange" : "blue"}`}>{post.platform.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{post.asset_count > 1 ? `${post.asset_count}-image carousel` : post.basename}</strong><small>{post.account_label} · {post.handle}</small></div>
                  <b className={`approval-state ${post.status}`}>{post.status.replaceAll("_", " ")}</b>
                </Link>
              ))}
              {posts.length === 0 && <div className="mini-empty">No post variants yet. Build the first {creator.name} package.</div>}
            </div>
          </section>

          <aside className="right-column">
            <section className="panel assist-panel">
              <div className="panel-heading"><div><h2>Creative assist</h2><p>Optional suggestions, always reviewed by a human</p></div><b>Coming next</b></div>
              <div className="assist-toggles">
                <label><span><strong>AI suggested captions</strong><small>Draft in the creator&apos;s approved voice</small></span><input type="checkbox" disabled aria-label="AI suggested captions coming soon" /><i /></label>
                <label><span><strong>AI suggested #</strong><small>Relevant platform-specific hashtag ideas</small></span><input type="checkbox" disabled aria-label="AI suggested hashtags coming soon" /><i /></label>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading"><div><h2>Agent activity</h2><p>Approval-gated local tasks</p></div><Link className="text-button" href="/agents">Open →</Link></div>
              <div className="small-stat-list"><div><strong>{tasks.filter((task) => task.status === "awaiting_approval").length}</strong><span>Awaiting run approval</span></div><div><strong>{tasks.filter((task) => task.status === "completed").length}</strong><span>Completed drafts</span></div></div>
            </section>
            <section className="research-card">
              <div className="research-glow" /><span className="spark">✦</span><p className="eyebrow">RESEARCH INBOX</p><h2>{research.length} current signals</h2><p>Only accepted, unexpired findings are available to {creator.name}&apos;s managing agent.</p><Link href="/research">Review findings →</Link>
            </section>
          </aside>
        </div>

        <section className="panel dashboard-telegram-panel">
          <div className="panel-heading"><div><h2>Agency bot thread</h2><p>Message {creator.name} in the paired private Telegram chat and review every attempted send.</p></div><b className={telegramPairing ? "ready" : ""}>{telegramPairing ? "Paired" : "Not paired"}</b></div>
          {query.telegram === "sent" && <div className="handoff-result success">Message sent and added to the Telegram log.</div>}
          {query.telegram === "failed" && <div className="handoff-result failed">Message was not confirmed by Telegram. The failed attempt is recorded below.</div>}
          {telegramPairing ? <form action={sendAgencyMessageToCreatorAction} className="telegram-message-form">
            <label>Message to {telegramPairing.telegram_username ? `@${telegramPairing.telegram_username}` : telegramPairing.display_name}<textarea name="message" required maxLength={4000} placeholder={`Write a private agency message to ${creator.name}…`} /></label>
            <div><small>Sent only when you press the button. No automatic replies or publication authority.</small><button className="primary-button">Send via agency bot</button></div>
          </form> : <div className="telegram-unpaired">Pair {creator.name}&apos;s private Telegram chat before sending messages. <Link href={`/creators/${creator.id}#telegram-mobile`}>Open Telegram setup →</Link></div>}
          <div className="telegram-send-log">
            <div className="telegram-log-heading"><strong>Send log</strong><span>{telegramLog.length} recent attempts</span></div>
            {telegramLog.map((item) => <details key={item.id} className={`telegram-log-item ${item.status}`}>
              <summary><span>{item.kind === "message" ? "MESSAGE" : item.kind === "post_handoff" ? "POST" : "REMINDER"}</span><div><strong>{item.title}</strong><small>{new Date(item.occurred_at).toLocaleString("en-AU", { timeZone: "Australia/Perth" })}</small></div><b>{item.status}</b></summary>
              <pre>{item.content}</pre>{item.error && <p>{item.error}</p>}
            </details>)}
            {!telegramLog.length && <div className="mini-empty">Nothing has been sent to this creator through the agency bot yet.</div>}
          </div>
        </section>
      </section>
    </main>
  );
}
