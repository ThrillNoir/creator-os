import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getActiveCreator } from "@/lib/current-creator";
import { getMessagingThread, getMessagingThreads, getThreadDrafts, getThreadMessages } from "@/lib/db";
import { approveMessageDraftForSendAction, createMessageDraftAction } from "@/app/actions";
import "../messages.css";

export const dynamic = "force-dynamic";

export default async function MessageThreadPage({params}:{params:Promise<{threadId:string}>}) {
  const creator = await getActiveCreator();
  const threadId = Number((await params).threadId);
  if (!Number.isInteger(threadId)) notFound();
  const thread = getMessagingThread(creator.id,threadId);
  if (!thread) notFound();
  const messages = getThreadMessages(creator.id,threadId);
  const drafts = getThreadDrafts(creator.id,threadId);
  const threads = getMessagingThreads(creator.id);
  return <AppShell active="Messages"><section className="workspace messaging-workspace">
    <header className="topbar"><div><span className="eyebrow">{thread.platform.toUpperCase()} CONVERSATION</span><h1>{thread.participant_name || thread.participant_handle || "Conversation"}</h1><p className="page-subtitle">{thread.connection_name} · {messages.length} imported messages</p></div><Link className="secondary-button button-link" href="/messages">← Inbox</Link></header>
    <nav className="thread-switcher" aria-label="Switch conversation">{threads.map((item)=><Link className={item.id===thread.id?"active":""} href={`/messages/${item.id}`} key={item.id}><span>{item.platform.slice(0,2).toUpperCase()}</span><strong>{item.participant_name||item.participant_handle||"Conversation"}</strong></Link>)}</nav>
    <div className="thread-layout">
      <section className="panel thread-reader">
        <div className="thread-warning">Message direction is not yet validated for this {thread.platform} adapter. Treat bubble alignment as provisional.</div>
        <div className="message-stream">{messages.map((message) => <article className={`message-bubble ${message.direction}`} key={message.id}><p>{message.body}</p><small>{message.sender_type} · {message.sent_at ?? message.created_at}</small></article>)}</div>
        {!messages.length && <div className="mini-empty">Open this conversation in the native platform window and refresh to collect its visible history.</div>}
      </section>
      <aside className="panel draft-panel">
        <div className="panel-heading"><div><h2>Reply draft</h2><p>Saved locally. Sending remains disabled until outbound validation.</p></div></div>
        <form action={createMessageDraftAction}><input type="hidden" name="threadId" value={thread.id} /><textarea name="body" required maxLength={20000} placeholder="Write a reply…" /><button className="primary-button" type="submit">Save draft</button><button className="secondary-button" disabled type="button">Send locked</button></form>
        <div className="draft-history">{drafts.map((draft) => <article key={draft.id}><strong>{draft.status}</strong><p>{draft.body}</p><small>{draft.author_name} · {draft.created_at}</small>{draft.status === "draft" && <form action={approveMessageDraftForSendAction}><input type="hidden" name="threadId" value={thread.id} /><input type="hidden" name="draftId" value={draft.id} /><button className="danger-button" type="submit">Approve this one message to send</button></form>}</article>)}{!drafts.length && <div className="mini-empty">No reply drafts yet.</div>}</div>
      </aside>
    </div>
  </section></AppShell>;
}
