import { AppNav } from "@/components/app-nav";
import { getActiveCreator } from "@/lib/current-creator";
import { getMessageSyncSummary, getMessagingAuditEvents, getMessagingConnections, getMessagingThreads, getTelegramCreatorPairing, getTelegramSendLog } from "@/lib/db";
import { openLocalPlatformAction, sendAgencyMessageToCreatorAction, setMessagingEmergencyPauseAction, updateMessagingConnectionAction } from "@/app/actions";
import Link from "next/link";
import "./messages.css";

export const dynamic = "force-dynamic";

const platformNames: Record<string,string> = {telegram:"Telegram",instagram:"Instagram",onlyfans:"OnlyFans",fansly:"Fansly",reddit:"Reddit",signal:"Signal"};

export default async function MessagesPage({searchParams}:{searchParams:Promise<{platform?:string;telegram?:string}>}) {
  const query = await searchParams;
  const creator = await getActiveCreator();
  const connections = getMessagingConnections(creator.id);
  const threads = getMessagingThreads(creator.id);
  const platforms = ["telegram","instagram","onlyfans","fansly","reddit","signal"];
  const selectedPlatform = platforms.includes(query.platform ?? "") ? query.platform! : "all";
  const visibleThreads = selectedPlatform === "all" ? threads : threads.filter((thread) => thread.platform === selectedPlatform);
  const audit = getMessagingAuditEvents(creator.id);
  const syncSummary = getMessageSyncSummary(creator.id);
  const paused = connections.some((connection) => connection.emergency_paused === 1);
  const telegramPairing = getTelegramCreatorPairing(creator.id);
  const telegramLog = getTelegramSendLog(creator.id, 8);

  return <main className="app-shell">
    <AppNav active="Messages" />
    <section className="workspace messaging-workspace">
      <header className="topbar">
        <div><span className="eyebrow">UNIFIED INBOX</span><h1>{creator.name} messages</h1><p className="page-subtitle">One creator-scoped inbox with explicit read, drafting and sending authority.</p></div>
        <form action={setMessagingEmergencyPauseAction}>
          <input type="hidden" name="paused" value={paused ? "no" : "yes"} />
          <button className={paused ? "primary-button" : "danger-button"} type="submit">{paused ? "Resume messaging" : "Pause all sending"}</button>
        </form>
      </header>

      {paused && <div className="messaging-alert"><strong>Emergency pause is active.</strong> No connector may send until messaging is resumed.</div>}

      <section className="messaging-platform-strip">
        <Link className={selectedPlatform === "all" ? "connected active" : "connected"} href="/messages"><span>ALL</span><strong>All streams</strong><small>{threads.length} conversations</small></Link>
        {platforms.map((platform) => {
          const matches = connections.filter((connection) => connection.platform === platform);
          const connected = matches.some((connection) => connection.status !== "not_connected");
          const sync = syncSummary.find((item) => item.platform === platform);
          const collection = sync ? `${sync.complete} collected · ${sync.pending + sync.claimed} queued${sync.failed ? ` · ${sync.failed} need retry` : ""}` : undefined;
          return <Link className={`${connected ? "connected" : ""}${selectedPlatform === platform ? " active" : ""}`} href={`/messages?platform=${platform}`} key={platform}><span>{platform.slice(0,2).toUpperCase()}</span><strong>{platformNames[platform]}</strong><small>{collection ?? (matches.length ? `${matches.length} configured` : "Not configured")}</small></Link>;
        })}
      </section>

      <section className="panel inbox-telegram-panel">
        <div className="panel-heading"><div><h2>Agency → creator Telegram</h2><p>Send a private message through the paired agency bot and retain the delivery log.</p></div><b className={telegramPairing ? "ready" : ""}>{telegramPairing ? `Paired · @${telegramPairing.telegram_username || telegramPairing.display_name}` : "Not paired"}</b></div>
        {query.telegram === "sent" && <div className="handoff-result success">Telegram message sent and logged.</div>}
        {query.telegram === "failed" && <div className="handoff-result failed">Telegram did not confirm delivery. The failed attempt is logged.</div>}
        {telegramPairing ? <form action={sendAgencyMessageToCreatorAction} className="inbox-telegram-form"><input type="hidden" name="returnTo" value="messages"/><textarea name="message" required maxLength={4000} placeholder={`Write a private agency message to ${creator.name}…`}/><button className="primary-button">Send via agency bot</button></form> : <p className="mini-empty">Pair this creator&apos;s Telegram chat under Accounts &amp; connections before sending.</p>}
        <div className="inbox-telegram-log">{telegramLog.map((item)=><details key={item.id}><summary><strong>{item.title}</strong><span>{item.status} · {item.occurred_at}</span></summary><pre>{item.content}</pre>{item.error&&<p>{item.error}</p>}</details>)}{!telegramLog.length&&<div className="mini-empty">No agency Telegram sends recorded yet.</div>}</div>
      </section>

      <div className="messaging-grid">
        <section className="panel messaging-inbox">
          <div className="panel-heading"><div><h2>{selectedPlatform === "all" ? "All conversations" : `${platformNames[selectedPlatform]} conversations`}</h2><p>{visibleThreads.reduce((sum,thread) => sum + thread.unread_count,0)} unread across {visibleThreads.length} threads</p></div><b>Live collector</b></div>
          <div className="dashboard-list">
            {visibleThreads.map((thread) => <Link className="dashboard-row" href={`/messages/${thread.id}`} key={thread.id}>
              <span className="platform blue">{thread.platform.slice(0,2).toUpperCase()}</span>
              <div><strong>{thread.participant_name || thread.participant_handle || "Conversation"}</strong><small>{thread.connection_name}{thread.subject ? ` · ${thread.subject}` : ""}</small></div>
              <b className="message-unread">{thread.unread_count || ""}</b>
            </Link>)}
            {!visibleThreads.length && <div className="mini-empty">No collected conversations are available in this stream yet.</div>}
          </div>
        </section>

        <aside className="panel messaging-controls">
          <div className="panel-heading"><div><h2>Connection authority</h2><p>Writing can be enabled now; live operate mode remains validation-gated.</p></div></div>
          {connections.map((connection) => <form action={updateMessagingConnectionAction} className="messaging-connection" key={connection.id}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="accountId" value={connection.account_id ?? ""} />
            <input type="hidden" name="destination" value="inbox" />
            <div className="messaging-connection-title"><span className={`account-logo ${connection.platform}`}>{connection.platform.slice(0,2).toUpperCase()}</span><p><strong>{platformNames[connection.platform] ?? connection.platform}</strong><small>{connection.display_name}</small></p><em>{connection.status.replaceAll("_"," ")}</em></div>
            <label>Operating mode<select name="mode" defaultValue={connection.mode}><option value="observe">Observe</option><option value="assist">Assist</option><option value="operate" disabled={!connection.outbound_validated}>Operate{!connection.outbound_validated ? " — validate first" : ""}</option></select></label>
            <div className="message-permissions"><label><input type="checkbox" name="readEnabled" value="yes" defaultChecked={Boolean(connection.read_enabled)} /> Read</label><label><input type="checkbox" name="writeEnabled" value="yes" defaultChecked={Boolean(connection.write_enabled)} /> Draft and write</label></div>
            <button className="secondary-button" type="submit">Save authority</button>
            {(connection.platform === "onlyfans" || connection.platform === "fansly") && connection.account_id && <button className="secondary-button collector-button" formAction={openLocalPlatformAction} type="submit">Open inbox and collect</button>}
          </form>)}
          {!connections.length && <div className="mini-empty">Add or connect a supported platform account to configure messaging authority.</div>}
        </aside>
      </div>

      <section className="panel messaging-audit">
        <div className="panel-heading"><div><h2>Messaging audit</h2><p>Permission changes and future draft, approval and delivery events.</p></div></div>
        {audit.map((event) => <div className="audit-row" key={event.id}><strong>{event.event_type.replaceAll("_"," ")}</strong><span>{event.display_name ?? "All connections"}</span><small>{event.actor} · {event.created_at}</small></div>)}
        {!audit.length && <div className="mini-empty">No messaging actions recorded yet.</div>}
      </section>
    </section>
  </main>;
}
