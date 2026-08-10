import Link from "next/link";
import {
  markInstagramThreadReadAction,
  markCollectedThreadReadAction,
  refreshTelegramMessagesAction,
  refreshInstagramMessagesAction,
  setMessagingPauseAction,
  updateMessagingAuthorityAction,
  validateInstagramReplyTargetAction,
  validateTelegramConnectorAction,
} from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { MessageQuickReply } from "@/components/message-quick-reply";
import { getUnifiedMessages, isMessagePlatform, messagePlatforms, type MessageAttachment, type MessagingConnection } from "@/lib/messages";

export const dynamic = "force-dynamic";

const labels = { telegram: "Telegram", instagram: "Instagram", fansly: "Fansly", onlyfans: "OnlyFans" } as const;
const timestamp = (value: string | null) => {
  if (!value) return Number.NaN;
  const normalized = value.replace(" ", "T");
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`).getTime();
};
const formatDate = (value: string | null) => {
  if (!value) return "Never";
  const date = new Date(timestamp(value));
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Perth" }).format(date);
};
const statusLabel = (value: string) => value.replaceAll("_", " ");

type UnifiedMessagesData = Awaited<ReturnType<typeof getUnifiedMessages>>;

function InstagramAttachmentView({ attachment }: { attachment: MessageAttachment }) {
  if (attachment.status !== "ready") return <div className="message-attachment unavailable"><span>Media preview unavailable</span></div>;
  if (attachment.kind === "shared_post" && attachment.external_url) {
    return <a className="message-attachment shared-post" href={attachment.external_url} target="_blank" rel="noreferrer"><span>Instagram post</span><strong>Open shared post ↗</strong></a>;
  }
  if (attachment.external_url) {
    return <a className="message-attachment shared-post" href={attachment.external_url} target="_blank" rel="noreferrer"><span>Instagram {attachment.kind}</span><strong>Open on Instagram ↗</strong></a>;
  }
  const source = `/api/message-attachment/${encodeURIComponent(attachment.id)}`;
  if (attachment.mime_type?.startsWith("video/") || attachment.kind === "video") return <video className="message-attachment-media" controls preload="metadata" src={source}>Instagram video</video>;
  if (attachment.mime_type?.startsWith("audio/") || attachment.kind === "audio") return <audio className="message-attachment-audio" controls preload="metadata" src={source}>Instagram audio</audio>;
  if (attachment.kind === "file") return <a className="message-attachment file" href={source} target="_blank" rel="noreferrer">Open attachment ↗</a>;
  return <img className="message-attachment-media" src={source} alt={attachment.kind === "story" ? "Instagram story referenced in this message" : "Instagram message attachment"} loading="lazy" />;
}

function InstagramReplyComposer({ data, connection }: { data: UnifiedMessagesData; connection: MessagingConnection | undefined }) {
  const thread = data.selectedThread?.platform === "instagram" ? data.selectedThread : null;
  if (!thread) return <div className="reply-placeholder"><textarea disabled placeholder="Choose an Instagram conversation to reply." /><button className="primary" disabled>Send</button></div>;
  const replyWindowOpen = Number.isFinite(timestamp(thread.last_inbound_at)) && Date.now() - timestamp(thread.last_inbound_at) <= 24 * 60 * 60_000;
  const canSend = connection?.status === "connected" && Boolean(connection.write_enabled) && Boolean(connection?.outbound_validated) && replyWindowOpen && !data.paused;
  const participant = thread.participant_name || thread.participant_handle || "this Instagram user";
  return <div className="instagram-replies">
    <div className="reply-heading"><div><strong>Reply to {participant}</strong><small>Press Enter to send immediately.</small></div>{!replyWindowOpen ? <span className="account-status blocked">reply window closed</span> : connection?.outbound_validated ? <span className="account-status ready">ready</span> : <span className="account-status attention">send locked</span>}</div>
    {!replyWindowOpen && <div className="connection-banner blocked"><div><strong>Instagram will not accept a reply to this older conversation.</strong><span>Ask {participant} to send Adelaide a new Instagram message, refresh the inbox, then reply within the active window.</span></div></div>}
    {!connection?.outbound_validated && connection?.status === "connected" && <form action={validateInstagramReplyTargetAction} className="reply-validation"><input type="hidden" name="threadId" value={thread.id} /><p>Validate the Instagram-scoped recipient for this exact conversation. This check does not send a message.</p><button className="secondary-action" type="submit">Validate reply target</button></form>}
    {canSend ? <MessageQuickReply platform="instagram" threadId={thread.id} participant={participant} /> : connection?.outbound_validated ? <div className="empty"><b>Instagram sending is locked.</b><span>{data.paused ? "Resume messaging controls first." : "Reconnect Instagram and wait for a new inbound message."}</span></div> : null}
    <details className="reply-drafts"><summary><span><strong>Instagram sends & receipts</strong><small>{data.instagramDrafts.length ? `${data.instagramDrafts.length} recorded` : "Nothing recorded yet"}</small></span><b>View</b></summary><div className="reply-draft-list">{data.instagramDrafts.map((send) => <article className="reply-draft" key={send.id}><div><span className={`post-state ${send.status}`}>{statusLabel(send.status)}</span><small>{formatDate(send.completed_at ?? send.created_at)}</small></div><p>{send.body}</p>{send.provider_message_id && <small>Instagram receipt: {send.provider_message_id}</small>}{send.error && <strong className="reply-error">{send.error}</strong>}</article>)}{!data.instagramDrafts.length && <div className="empty"><b>No Instagram sends yet.</b><span>Confirmed attempts and receipts will stay here.</span></div>}</div></details>
  </div>;
}

function TelegramComposer({ data, connection }: { data: UnifiedMessagesData; connection: MessagingConnection | undefined }) {
  const thread = data.selectedThread?.platform === "telegram" ? data.selectedThread : null;
  if (!thread) return <div className="reply-placeholder"><textarea disabled placeholder="Choose Adelaide’s Telegram conversation." /><button className="primary" disabled>Send</button></div>;
  const canSend = connection?.status === "connected" && Boolean(connection.write_enabled) && Boolean(connection.outbound_validated) && !data.paused;
  return <div className="instagram-replies">
    <div className="reply-heading"><div><strong>Message Adelaide</strong><small>Sent through the paired private agency bot.</small></div><span className={`account-status ${canSend ? "ready" : "attention"}`}>{canSend ? "ready" : "send locked"}</span></div>
    {canSend ? <MessageQuickReply platform="telegram" threadId={thread.id} participant="Adelaide" /> : <div className="empty"><b>Telegram sending is locked.</b><span>Validate the bot, enable sending, and make sure the emergency pause is off.</span></div>}
    <details className="reply-drafts"><summary><span><strong>Telegram receipts</strong><small>{data.telegramLog.length ? `${data.telegramLog.length} recorded` : "Nothing recorded yet"}</small></span><b>View</b></summary><div className="reply-draft-list">{data.telegramLog.map((item) => <article className="reply-draft" key={item.id}><div><span className={`post-state ${item.status}`}>{statusLabel(item.status)}</span><small>{formatDate(item.completed_at ?? item.created_at)}</small></div><p>{item.message_text}</p>{item.error ? <strong className="reply-error">{item.error}</strong> : null}</article>)}{!data.telegramLog.length ? <div className="empty"><b>No Telegram sends yet.</b><span>Confirmed attempts will stay here.</span></div> : null}</div></details>
  </div>;
}

function FanslyComposer({ data, connection }: { data: UnifiedMessagesData; connection: MessagingConnection | undefined }) {
  const thread = data.selectedThread?.platform === "fansly" ? data.selectedThread : null;
  if (!thread) return <div className="reply-placeholder"><textarea disabled placeholder="Open and pair Fansly Messages, then choose a conversation." /><button className="primary" disabled>Send</button></div>;
  const participant = thread.participant_name || thread.participant_handle || "this Fansly subscriber";
  const canSend = connection?.status === "connected" && Boolean(connection.write_enabled) && Boolean(connection.outbound_validated) && !data.paused;
  const conversationUrl = `https://fansly.com${thread.external_thread_id}`;
  return <div className="instagram-replies">
    <div className="reply-heading"><div><strong>Reply to {participant}</strong><small>Fansly uses Adelaide’s paired browser; THOT OS never stores her login.</small></div><span className={`account-status ${canSend ? "ready" : "attention"}`}>{canSend ? "device ready" : "send locked"}</span></div>
    {canSend ? <MessageQuickReply platform="fansly" threadId={thread.id} participant={participant} /> : <div className="empty"><b>Fansly sending is locked.</b><span>Open and pair Fansly Messages, enable sending authority, and make sure the emergency pause is off.</span></div>}
    <details className="reply-drafts" open={data.premiumDrafts.some((send) => send.status === "approved" || send.status === "claimed")}><summary><span><strong>Fansly sends & device receipts</strong><small>{data.premiumDrafts.length ? `${data.premiumDrafts.length} recorded` : "Nothing recorded yet"}</small></span><b>View</b></summary><div className="reply-draft-list">{data.premiumDrafts.map((send) => <article className="reply-draft" key={send.id}><div><span className={`post-state ${send.status}`}>{send.status === "sent" ? "sent" : statusLabel(send.status)}</span><small>{formatDate(send.completed_at ?? send.created_at)}</small></div><p>{send.body}</p>{send.error ? <strong className="reply-error">{send.error}</strong> : null}{send.status === "approved" || send.status === "claimed" ? <div className="device-handoff"><span>{send.status === "claimed" ? "Adelaide’s paired browser is delivering this message." : "Queued for Adelaide’s paired browser. No Fansly action is required."}</span><a className="secondary-action" href={conversationUrl} target="_blank" rel="noreferrer">View conversation ↗</a></div> : null}{send.status === "sent" ? <small>The paired browser confirmed the native Fansly send and returned its receipt.</small> : null}</article>)}{!data.premiumDrafts.length ? <div className="empty"><b>No Fansly sends yet.</b><span>Queued attempts and confirmed receipts will remain here.</span></div> : null}</div></details>
  </div>;
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ platform?: string; thread?: string; saved?: string }> }) {
  const query = await searchParams;
  const platform = isMessagePlatform(query.platform) ? query.platform : undefined;
  const data = await getUnifiedMessages(platform, query.thread);
  const telegram = data.connections.find((connection) => connection.platform === "telegram");
  const instagram = data.connections.find((connection) => connection.platform === "instagram");
  const fansly = data.connections.find((connection) => connection.platform === "fansly");
  const platformHref = (value?: string) => value ? `/messages?platform=${value}` : "/messages";
  return <AppShell active="Messages"><PageHeader title="Unified Messages" subtitle="Creator-scoped conversations, permissions and delivery history in one calm workspace." />
    {query.saved === "authority" && <div className="success">Messaging authority was updated and added to the audit log.</div>}
    {query.saved === "paused" && <div className="success">All outbound messaging is paused. Collection remains visible.</div>}
    {query.saved === "resumed" && <div className="success">Messaging controls were resumed. Unvalidated connectors still cannot send.</div>}
    {query.saved === "telegram_validated" && <div className="success">The agency Telegram bot and Adelaide pairing were validated. No message was sent.</div>}
    {query.saved === "telegram_sent" && <div className="success">Telegram confirmed the agency message. Its receipt is recorded below.</div>}
    {query.saved === "telegram_queued" && <div className="success">That Telegram message is already queued. THOT OS did not create a duplicate.</div>}
    {query.saved === "telegram_refreshed" && <div className="success">Telegram replies were refreshed and the selected conversation stayed open.</div>}
    {query.saved === "telegram_failed" && <div className="connection-banner blocked"><div><strong>Telegram did not confirm the action.</strong><span>Review the connection and send log before trying again.</span></div></div>}
    {query.saved === "instagram_validated" && <div className="success">The recipient for this Instagram conversation was validated. No message was sent.</div>}
    {query.saved === "instagram_validation_failed" && <div className="connection-banner blocked"><div><strong>The Instagram reply target could not be validated.</strong><span>Refresh Instagram data, confirm the conversation, then try the validation again.</span></div></div>}
    {query.saved === "instagram_sent" && <div className="success">Instagram confirmed the reply. Its provider receipt and audit event are recorded below.</div>}
    {query.saved === "instagram_sending" && <div className="success">That Instagram reply is already being sent. THOT OS did not create a duplicate.</div>}
    {query.saved === "instagram_uncertain" && <div className="connection-banner blocked"><div><strong>Instagram’s reply outcome is uncertain.</strong><span>Check the live conversation before doing anything else. THOT OS will not retry it automatically.</span></div></div>}
    {query.saved === "instagram_send_failed" && <div className="connection-banner blocked"><div><strong>Instagram did not accept the reply.</strong><span>Review the draft status and connection before creating another reply.</span></div></div>}
    {query.saved === "instagram_messages_refreshed" && <div className="success">Instagram conversations were refreshed. New messages and available media are now shown.</div>}
    {query.saved === "instagram_thread_read" && <div className="success">Instagram confirmed this conversation as read.</div>}
    {query.saved === "thread_read" && <div className="success">This collected conversation is marked read in THOT OS.</div>}
    {query.saved === "fansly_reply_queued" && <div className="success">Fansly reply queued. Adelaide’s paired browser will deliver it automatically and return the receipt here.</div>}
    {query.saved === "fansly_pair_failed" && <div className="connection-banner blocked"><div><strong>Fansly pairing did not complete.</strong><span>Refresh this page, confirm Adelaide is signed into Fansly, then open the pairing tab again.</span></div></div>}
    <section className={`connection-banner ${data.paused ? "blocked" : "attention"}`}><div><strong>{data.paused ? "Emergency pause is active" : "Enter-to-send messaging"}</strong><span>{data.paused ? "THOT OS will not release an outbound message." : "Press Enter to send on Telegram, Instagram or Fansly. Use Shift+Enter for a new line; every attempt keeps a receipt."}</span></div><form action={setMessagingPauseAction}><input type="hidden" name="paused" value={data.paused ? "no" : "yes"} /><button className="secondary-action" type="submit">{data.paused ? "Resume controls" : "Pause all sending"}</button></form></section>
    <section className="ops-summary messages-summary"><article><b>{data.metrics.conversations}</b><span>Conversations</span></article><article><b>{data.metrics.unread}</b><span>Unread</span></article><article><b>{data.metrics.sent}</b><span>Recorded sends</span></article><article><b>{data.metrics.attention}</b><span>Connections need attention</span></article></section>
    <nav className="message-streams" aria-label="Message streams"><Link className={!platform ? "active" : ""} href={platformHref()}><span>ALL</span><strong>All streams</strong><small>{data.metrics.conversations} conversations</small></Link>{messagePlatforms.map((item) => { const connection = data.connections.find((candidate) => candidate.platform === item); return <Link className={platform === item ? "active" : ""} href={platformHref(item)} key={item}><span>{item.slice(0,2).toUpperCase()}</span><strong>{labels[item]}</strong><small>{connection ? `${statusLabel(connection.status)} · ${connection.thread_count} threads` : "Not configured"}</small></Link>; })}</nav>
    <div className="message-workspace"><section className="panel thread-list"><div className="section-heading"><div><span className="eyebrow">CONVERSATIONS</span><h2>{platform ? labels[platform] : "All streams"}</h2>{platform === "instagram" || platform === "telegram" || platform === "fansly" ? <small className="sync-time">Last synced {formatDate((platform === "instagram" ? instagram : platform === "telegram" ? telegram : fansly)?.last_synced_at ?? null)}</small> : null}</div>{platform === "instagram" ? <form action={refreshInstagramMessagesAction}><input type="hidden" name="threadId" value={data.selectedThread?.id ?? ""} /><button className="compact-action" type="submit">Refresh</button></form> : platform === "telegram" ? <form action={refreshTelegramMessagesAction}><input type="hidden" name="threadId" value={data.selectedThread?.id ?? ""} /><button className="compact-action" type="submit">Refresh</button></form> : platform === "fansly" ? <form action="/api/fansly/pair" method="post" target="_blank"><input type="hidden" name="destination" value="messages" /><button className="compact-action" type="submit">Open & pair ↗</button></form> : <span>{data.threads.length} shown</span>}</div>{data.threads.map((thread) => <Link className={data.selectedThread?.id === thread.id ? "active" : ""} href={`/messages${platform ? `?platform=${platform}&` : "?"}thread=${encodeURIComponent(thread.id)}`} key={thread.id}><span className="platform-mark">{thread.platform.slice(0,2).toUpperCase()}</span><div><strong>{thread.participant_name || thread.participant_handle || "Conversation"}</strong><small>{thread.connection_name}{thread.subject ? ` · ${thread.subject}` : ""}</small></div>{thread.unread_count ? <b>{thread.unread_count}</b> : null}</Link>)}{!data.threads.length ? <div className="empty"><b>No cloud conversations yet.</b><span>{platform === "fansly" ? "Open and pair Fansly Messages. The signed browser will populate this stream without sharing Adelaide’s password." : "The validated collector will populate this stream without mixing creator accounts."}</span></div> : null}</section>
      <section className="panel conversation"><div className="section-heading"><div><span className="eyebrow">THREAD</span><h2>{data.selectedThread ? data.selectedThread.participant_name || data.selectedThread.participant_handle || "Conversation" : "Choose a conversation"}</h2></div><div className="conversation-heading-actions">{data.selectedThread?.platform === "instagram" && data.selectedThread.unread_count ? <form action={markInstagramThreadReadAction}><input type="hidden" name="threadId" value={data.selectedThread.id} /><button className="compact-action" type="submit">Mark read</button></form> : data.selectedThread && (data.selectedThread.platform === "telegram" || data.selectedThread.platform === "fansly") && data.selectedThread.unread_count ? <form action={markCollectedThreadReadAction}><input type="hidden" name="threadId" value={data.selectedThread.id} /><button className="compact-action" type="submit">Mark read</button></form> : null}{data.selectedThread ? <span>{labels[data.selectedThread.platform]}</span> : null}</div></div>{data.messages.map((message) => <article className={message.direction} key={message.id}><div><strong>{message.direction === "outbound" ? "Agency / creator" : data.selectedThread?.participant_name || data.selectedThread?.participant_handle || statusLabel(message.sender_type)}</strong><small>{formatDate(message.sent_at ?? message.created_at)} · {statusLabel(message.delivery_status)}</small></div>{message.body !== "[Instagram attachment]" || !message.attachments.length ? <p>{message.body}</p> : null}{message.attachments.length ? <div className="message-attachments">{message.attachments.map((attachment) => <InstagramAttachmentView attachment={attachment} key={attachment.id} />)}</div> : null}</article>)}{!data.messages.length ? <div className="empty"><b>No collected messages to display.</b><span>Choose a populated conversation before replying.</span></div> : null}{data.selectedThread?.platform === "instagram" ? <InstagramReplyComposer data={data} connection={instagram} /> : data.selectedThread?.platform === "telegram" ? <TelegramComposer data={data} connection={telegram} /> : data.selectedThread?.platform === "fansly" ? <FanslyComposer data={data} connection={fansly} /> : <div className="reply-placeholder"><textarea disabled placeholder="Sending is not enabled for this stream yet." /><button className="primary" disabled>Send</button></div>}</section>
      <aside className="panel message-authority"><div className="section-heading"><div><span className="eyebrow">AUTHORITY</span><h2>Connection controls</h2></div></div>{data.connections.filter((connection) => !platform || connection.platform === platform).map((connection) => <div className="authority-group" key={connection.id}><form action={updateMessagingAuthorityAction}><input type="hidden" name="connectionId" value={connection.id} /><div className="authority-title"><span className="platform-mark">{connection.platform.slice(0,2).toUpperCase()}</span><div><strong>{connection.display_name}</strong><small>{connection.handle || labels[connection.platform]} · {statusLabel(connection.status)}</small></div></div><label>Mode<select name="mode" defaultValue={connection.mode}><option value="observe">Observe only</option><option value="assist">Assist — human-reviewed sending</option><option value="operate" disabled={!connection.outbound_validated}>Operate — validated connection</option></select></label><div className="authority-checks"><label><input type="checkbox" name="readEnabled" defaultChecked={Boolean(connection.read_enabled)} /> Read</label><label><input type="checkbox" name="writeEnabled" defaultChecked={Boolean(connection.write_enabled)} /> Send messages</label></div>{connection.last_error && <p>{connection.last_error}</p>}<button className="secondary-action" type="submit">Save authority</button></form>{connection.platform === "telegram" && <form action={validateTelegramConnectorAction}><button className="secondary-action validate-connector" type="submit">Validate bot & pairing</button></form>}</div>)}</aside></div>
    <section className="panel message-audit"><div className="section-heading"><div><span className="eyebrow">AUDIT</span><h2>Messaging activity</h2></div></div>{data.audit.map((event) => <article className="audit-row" key={event.id}><div><strong>{statusLabel(event.event_type)}</strong><small>{event.display_name || "Unified Messages"}</small></div><span>{event.actor}</span><time>{formatDate(event.created_at)}</time></article>)}{!data.audit.length ? <div className="empty">No messaging events yet.</div> : null}</section>
  </AppShell>;
}
