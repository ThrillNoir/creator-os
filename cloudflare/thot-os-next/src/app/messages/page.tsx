import Link from "next/link";
import {
  markInstagramThreadReadAction,
  markCollectedThreadReadAction,
  refreshTelegramMessagesAction,
  refreshInstagramMessagesAction,
  setMessagingPauseAction,
  startTelegramPairingAction,
  completeTelegramPairingAction,
  updateMessagingAuthorityAction,
  validateTelegramConnectorAction,
} from "@/app/actions";
import { AppShell, PageHeader } from "@/components/app-shell";
import { MessageQuickReply } from "@/components/message-quick-reply";
import { MessageRefreshButton } from "@/components/message-refresh-button";
import { getUnifiedMessages, isMessagePlatform, messagePlatforms, type MessageAttachment, type MessagingConnection } from "@/lib/messages";
import { requireCreatorContext } from "@/lib/identity";
import { notFound } from "next/navigation";
import { roleCan } from "@/lib/authorization";
import { cloudflareEnv } from "@/lib/cloudflare";
import { instagramSendingBlocker } from "@/lib/instagram-readiness";
import { fanslyDeliveryWarning } from "@/lib/fansly-delivery";

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
const connectionLabel = (connection: MessagingConnection | undefined) => connection ? `${connection.display_name}${connection.handle ? ` · ${connection.handle}` : ""}` : "Selected account";
const attentionEvent = (value: string) => /failed|error|uncertain|attention|paused|review/i.test(value);

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
  const blocker = instagramSendingBlocker(connection, replyWindowOpen, data.paused);
  const canSend = !blocker;
  const participant = thread.participant_name || thread.participant_handle || "this Instagram user";
  return <div className="instagram-replies">
    <div className="reply-heading"><div><strong>Reply to {participant}</strong><small className="reply-account">Sending from {connectionLabel(connection)}</small><small>Enter sends immediately; Shift+Enter adds a line.</small></div>{blocker ? <span className={`account-status ${!replyWindowOpen ? "blocked" : "attention"}`}>send locked</span> : <span className="account-status ready">ready</span>}</div>
    {!replyWindowOpen && <div className="connection-banner blocked"><div><strong>Instagram will not accept a reply to this older conversation.</strong><span>Ask {participant} to send the creator a new Instagram message, refresh the inbox, then reply within the active window.</span></div></div>}
    {canSend ? <MessageQuickReply key={`instagram:${thread.id}`} platform="instagram" threadId={thread.id} participant={participant} /> : <div className="empty"><b>Instagram sending is locked.</b><span>{blocker}</span></div>}
    <details className="reply-drafts" open={data.instagramDrafts.some((send) => send.status === "failed" || send.status === "uncertain" || Boolean(send.error))}><summary><span><strong>Instagram sends & receipts</strong><small>{data.instagramDrafts.length ? `${data.instagramDrafts.length} recorded` : "Nothing recorded yet"}</small></span><b>View</b></summary><div className="reply-draft-list">{data.instagramDrafts.map((send) => <article className="reply-draft" key={send.id}><div><span className={`post-state ${send.status}`}>{statusLabel(send.status)}</span><small>{formatDate(send.completed_at ?? send.created_at)}</small></div><p>{send.body}</p>{send.provider_message_id && <small>Instagram receipt: {send.provider_message_id}</small>}{send.error && <strong className="reply-error">{send.error}</strong>}</article>)}{!data.instagramDrafts.length && <div className="empty"><b>No Instagram sends yet.</b><span>Confirmed attempts and receipts will stay here.</span></div>}</div></details>
  </div>;
}

function TelegramComposer({ data, connection }: { data: UnifiedMessagesData; connection: MessagingConnection | undefined }) {
  const thread = data.selectedThread?.platform === "telegram" ? data.selectedThread : null;
  if (!thread) return <div className="reply-placeholder"><textarea disabled placeholder="Choose the creator’s Telegram conversation." /><button className="primary" disabled>Send</button></div>;
  const canSend = connection?.status === "connected" && Boolean(connection.write_enabled) && Boolean(connection.outbound_validated) && !data.paused;
  return <div className="instagram-replies">
    <div className="reply-heading"><div><strong>Message creator</strong><small className="reply-account">Sending from {connectionLabel(connection)}</small><small>Sent through the paired private agency bot.</small></div><span className={`account-status ${canSend ? "ready" : "attention"}`}>{canSend ? "ready" : "send locked"}</span></div>
    {canSend ? <MessageQuickReply key={`telegram:${thread.id}`} platform="telegram" threadId={thread.id} participant="the creator" /> : <div className="empty"><b>Telegram sending is locked.</b><span>Validate the bot, enable sending, and make sure the emergency pause is off.</span></div>}
    <details className="reply-drafts" open={data.telegramLog.some((item) => Boolean(item.error) || /failed|uncertain/i.test(item.status))}><summary><span><strong>Telegram receipts</strong><small>{data.telegramLog.length ? `${data.telegramLog.length} recorded` : "Nothing recorded yet"}</small></span><b>View</b></summary><div className="reply-draft-list">{data.telegramLog.map((item) => <article className="reply-draft" key={item.id}><div><span className={`post-state ${item.status}`}>{statusLabel(item.status)}</span><small>{formatDate(item.completed_at ?? item.created_at)}</small></div><p>{item.message_text}</p>{item.error ? <strong className="reply-error">{item.error}</strong> : null}</article>)}{!data.telegramLog.length ? <div className="empty"><b>No Telegram sends yet.</b><span>Confirmed attempts will stay here.</span></div> : null}</div></details>
  </div>;
}

function FanslyComposer({ data, connection, creatorName }: { data: UnifiedMessagesData; connection: MessagingConnection | undefined; creatorName: string }) {
  const thread = data.selectedThread?.platform === "fansly" ? data.selectedThread : null;
  if (!thread) return <div className="reply-placeholder"><textarea disabled placeholder="Open and pair Fansly Messages, then choose a conversation." /><button className="primary" disabled>Send</button></div>;
  const participant = thread.participant_name || thread.participant_handle || "this Fansly subscriber";
  const canSend = connection?.status === "connected" && Boolean(connection.write_enabled) && Boolean(connection.outbound_validated) && !data.paused;
  const conversationUrl = `https://fansly.com${thread.external_thread_id}`;
  return <div className="instagram-replies">
    <div className="reply-heading"><div><strong>Reply to {participant}</strong><small className="reply-account">Sending from {connectionLabel(connection)}</small><small>Fansly uses the assigned creator profile; THOT OS never stores the login.</small></div><span className={`account-status ${canSend ? "ready" : "attention"}`}>{canSend ? "device ready" : "send locked"}</span></div>
    {canSend ? <MessageQuickReply key={`fansly:${thread.id}`} platform="fansly" threadId={thread.id} participant={participant} /> : <div className="empty"><b>Fansly sending is locked.</b><span>Open and pair Fansly Messages, enable sending authority, and make sure the emergency pause is off.</span></div>}
    <p>Fansly messaging requires THOT OS bridge extension 1.1.0 or later in the assigned Chrome profile.</p>
    <details className="reply-drafts" open={data.premiumDrafts.some((send) => send.status === "approved" || send.status === "claimed" || fanslyDeliveryWarning(send))}>
      <summary><span><strong>Fansly sends & device receipts</strong><small>{data.premiumDrafts.length ? `${data.premiumDrafts.length} recorded` : "Nothing recorded yet"}</small></span><b>View</b></summary>
      <div className="reply-draft-list">{data.premiumDrafts.map((send) => {
        const warning = fanslyDeliveryWarning(send);
        return <article className="reply-draft" key={send.id}>
          <div><span className={`post-state ${warning ? "uncertain" : send.status}`}>{warning ? "delivery uncertain" : statusLabel(send.status)}</span><small>{formatDate(send.completed_at ?? send.created_at)}</small></div>
          <p>{send.body}</p>{warning || send.error ? <strong className="reply-error">{warning || send.error}</strong> : null}
          {warning || send.status === "approved" || send.status === "claimed" ? <div className="device-handoff">
            {!warning && <span>{send.status === "claimed" ? `${creatorName}’s paired browser has claimed this message; delivery is not confirmed yet.` : `Queued for ${creatorName}’s paired browser. No Fansly action is required.`}</span>}
            <a className="secondary-action" href={conversationUrl} target="_blank" rel="noreferrer">View conversation ↗</a>
          </div> : null}
          {send.status === "sent" ? <small>The paired browser confirmed the native Fansly send and returned its receipt.</small> : null}
        </article>;
      })}{!data.premiumDrafts.length ? <div className="empty"><b>No Fansly sends yet.</b><span>Queued attempts and confirmed receipts will remain here.</span></div> : null}</div>
    </details>
  </div>;
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ platform?: string; accountId?: string; thread?: string; saved?: string }> }) {
  const query = await searchParams;
  const context = await requireCreatorContext();
  if (context.creator.role === "viewer") notFound();
  const canApproveMessaging = roleCan(context.creator.role, "approve");
  const canManageIdentity = roleCan(context.creator.role, "manage_identity");
  const platform = isMessagePlatform(query.platform) ? query.platform : undefined;
  const data = await getUnifiedMessages(context.creator.creator_id, platform, query.thread, query.accountId);
  const telegramConnector = canManageIdentity ? await cloudflareEnv().DB.prepare("SELECT telegram_username,expected_bot_username,status FROM telegram_connector_state WHERE creator_id=?").bind(context.creator.creator_id).first<{ telegram_username: string; expected_bot_username: string; status: string }>() : null;
  const telegram = data.connections.find((connection) => connection.platform === "telegram");
  const instagram = data.connections.find((connection) => connection.platform === "instagram");
  const selectedInstagram = data.selectedThread?.platform === "instagram"
    ? data.connections.find((connection) => connection.id === data.selectedThread?.connection_id)
    : data.connections.find((connection) => connection.platform === "instagram" && connection.account_id === query.accountId);
  const instagramConnections = data.connections.filter((connection) => connection.platform === "instagram" && connection.account_id);
  const fansly = data.connections.find((connection) => connection.platform === "fansly");
  const selectedConnection = data.selectedThread ? data.connections.find((connection) => connection.id === data.selectedThread?.connection_id) : undefined;
  const authorityConnections = data.connections.filter((connection) => !platform || connection.platform === platform).filter((connection) => {
    if (platform !== "instagram" || !query.accountId) return true;
    return connection.account_id === query.accountId;
  });
  const platformHref = (value?: string) => value ? `/messages?platform=${value}` : "/messages";
  return <AppShell active="Messages"><PageHeader title="Unified Messages" subtitle="Creator-scoped conversations, permissions and delivery history in one calm workspace." />
    {query.saved === "authority" && <div className="success">Messaging authority was updated and added to the audit log.</div>}
    {query.saved === "paused" && <div className="success">All outbound messaging is paused. Collection remains visible.</div>}
    {query.saved === "resumed" && <div className="success">Messaging controls were resumed. Unvalidated connectors still cannot send.</div>}
    {query.saved === "telegram_validated" && <div className="success">The agency Telegram bot and creator pairing were validated. No message was sent.</div>}
    {query.saved === "telegram_pairing_started" && <div className="success">Telegram pairing is ready. Open the bot below from the creator&apos;s Telegram account.</div>}
    {query.saved === "telegram_pairing_complete" && <div className="success">Telegram is paired. Refresh the inbox to collect the creator&apos;s messages.</div>}
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
    {query.saved === "fansly_reply_queued" && <div className="success">Fansly reply queued. The assigned creator browser will deliver it automatically and return the receipt here.</div>}
    {query.saved === "fansly_pair_failed" && <div className="connection-banner blocked"><div><strong>Fansly pairing did not complete.</strong><span>Refresh this page, confirm the creator is signed into Fansly, then open the pairing tab again.</span></div></div>}
    <section className={`connection-banner ${data.paused ? "blocked" : "attention"}`}><div><strong>{data.paused ? "Sending is paused" : "Ready for reviewed replies"}</strong><span>{data.paused ? "THOT OS will not release an outbound message." : "Choose a conversation, then press Enter to send. Shift+Enter adds a line; every attempt keeps a receipt."}</span></div>{canApproveMessaging ? <form action={setMessagingPauseAction}><input type="hidden" name="paused" value={data.paused ? "no" : "yes"} /><input type="hidden" name="platform" value={platform ?? ""} /><input type="hidden" name="accountId" value={query.accountId ?? ""} /><input type="hidden" name="thread" value={query.thread ?? ""} /><button className="secondary-action" type="submit">{data.paused ? "Resume sending" : "Pause all sending"}</button></form> : <span className="permission-note">Pause controls are managed by agency staff.</span>}</section>
    {data.fanslyCollectionNeedsReview > 0 && (!platform || platform === "fansly") && <div className="connection-banner attention"><div><strong>{data.fanslyCollectionNeedsReview} Fansly conversation syncs need review.</strong><span>Open the affected conversations in the paired browser to verify their state. Older claims are not automatically replayed.</span></div></div>}
    <section className="ops-summary messages-summary" aria-label="Workspace messaging totals"><article><b>{data.metrics.conversations}</b><span>Workspace conversations</span></article><article><b>{data.metrics.unread}</b><span>Workspace unread</span></article><article><b>{data.metrics.sent}</b><span>Recorded sends · all accounts</span></article><article><b>{data.metrics.attention}</b><span>Connections needing attention</span></article></section>
    <nav className="message-streams" aria-label="Message streams"><Link className={!platform ? "active" : ""} href={platformHref()}><span>ALL</span><strong>All streams</strong><small>Workspace · {data.metrics.conversations} conversations</small></Link>{messagePlatforms.map((item) => { const connection = data.connections.find((candidate) => candidate.platform === item); return <Link className={platform === item ? "active" : ""} href={platformHref(item)} key={item}><span>{item.slice(0,2).toUpperCase()}</span><strong>{labels[item]}</strong><small>{connection ? `${connection.handle || connection.display_name} · ${connection.thread_count} conversations` : "Not configured"}</small></Link>; })}</nav>
    <div className="message-workspace"><section className="panel thread-list"><div className="section-heading"><div><span className="eyebrow">CONVERSATIONS</span><h2>{platform ? labels[platform] : "All streams"}</h2>{platform === "instagram" && selectedInstagram ? <small className="scope-label">Viewing {connectionLabel(selectedInstagram)}</small> : null}{platform === "instagram" || platform === "telegram" || platform === "fansly" ? <small className="sync-time">Last synced {formatDate((platform === "instagram" ? selectedInstagram : platform === "telegram" ? telegram : fansly)?.last_synced_at ?? null)}</small> : null}</div>{platform === "instagram" ? <div className="thread-list-actions"><form method="get"><input type="hidden" name="platform" value="instagram" /><input type="hidden" name="thread" value="" />{instagramConnections.length > 1 ? <label>Account<select name="accountId" defaultValue={selectedInstagram?.account_id ?? instagramConnections[0].account_id ?? ""}>{instagramConnections.map((connection) => <option key={connection.account_id} value={connection.account_id ?? ""}>{connection.display_name}{connection.handle ? ` · ${connection.handle}` : ""}</option>)}</select></label> : <input type="hidden" name="accountId" value={selectedInstagram?.account_id ?? instagramConnections[0]?.account_id ?? ""} />}<button className="compact-action" type="submit">Show inbox</button></form><form action={refreshInstagramMessagesAction}><input type="hidden" name="threadId" value={data.selectedThread?.id ?? ""} /><input type="hidden" name="accountId" value={selectedInstagram?.account_id ?? ""} /><MessageRefreshButton /></form></div> : platform === "telegram" ? <form action={refreshTelegramMessagesAction}><input type="hidden" name="threadId" value={data.selectedThread?.id ?? ""} /><MessageRefreshButton /></form> : platform === "fansly" && canManageIdentity ? <form action="/api/fansly/pair" method="post" target="_blank"><input type="hidden" name="destination" value="messages" /><button className="compact-action" type="submit">Open & pair ↗</button></form> : <span>{data.threads.length} shown</span>}</div>{data.threads.map((thread) => <Link className={data.selectedThread?.id === thread.id ? "active" : ""} href={`/messages${platform ? `?platform=${platform}&` : "?"}${thread.platform === "instagram" && thread.account_id ? `accountId=${encodeURIComponent(thread.account_id)}&` : ""}thread=${encodeURIComponent(thread.id)}`} key={thread.id}><span className="platform-mark">{thread.platform.slice(0,2).toUpperCase()}</span><div><strong>{thread.participant_name || thread.participant_handle || "Conversation"}</strong><small>{thread.connection_name}{thread.subject ? ` · ${thread.subject}` : ""}</small></div>{thread.unread_count ? <b>{thread.unread_count}</b> : null}</Link>)}{!data.threads.length ? <div className="empty"><b>No cloud conversations yet.</b><span>{platform === "fansly" ? `The signed browser will populate this stream without sharing ${context.creator.creator_name}’s password.` : "The validated collector will populate this stream without mixing creator accounts."}</span></div> : null}</section>
      <section className="panel conversation"><div className="section-heading"><div><span className="eyebrow">THREAD</span><h2>{data.selectedThread ? data.selectedThread.participant_name || data.selectedThread.participant_handle || "Conversation" : "Choose a conversation"}</h2>{data.selectedThread && <small className="conversation-account">{connectionLabel(selectedConnection)} · {labels[data.selectedThread.platform]}</small>}</div><div className="conversation-heading-actions">{data.selectedThread?.platform === "instagram" && data.selectedThread.unread_count ? <form action={markInstagramThreadReadAction}><input type="hidden" name="threadId" value={data.selectedThread.id} /><button className="compact-action" type="submit">Mark read</button></form> : data.selectedThread && (data.selectedThread.platform === "telegram" || data.selectedThread.platform === "fansly") && data.selectedThread.unread_count ? <form action={markCollectedThreadReadAction}><input type="hidden" name="threadId" value={data.selectedThread.id} /><button className="compact-action" type="submit">Mark read</button></form> : null}</div></div>{data.messages.map((message) => <article className={message.direction} key={message.id}><div><strong>{message.direction === "outbound" ? "Agency / creator" : data.selectedThread?.participant_name || data.selectedThread?.participant_handle || statusLabel(message.sender_type)}</strong><small>{formatDate(message.sent_at ?? message.created_at)} · {statusLabel(message.delivery_status)}</small></div>{message.body !== "[Instagram attachment]" || !message.attachments.length ? <p>{message.body}</p> : null}{message.attachments.length ? <div className="message-attachments">{message.attachments.map((attachment) => <InstagramAttachmentView attachment={attachment} key={attachment.id} />)}</div> : null}</article>)}{!data.messages.length ? <div className="empty"><b>No collected messages to display.</b><span>Choose a populated conversation before replying.</span></div> : null}{data.selectedThread?.platform === "instagram" ? <InstagramReplyComposer data={data} connection={selectedConnection} /> : data.selectedThread?.platform === "telegram" ? <TelegramComposer data={data} connection={telegram} /> : data.selectedThread?.platform === "fansly" ? <FanslyComposer data={data} connection={fansly} creatorName={context.creator.creator_name} /> : <div className="reply-placeholder"><textarea disabled placeholder="Sending is not enabled for this stream yet." /><button className="primary" disabled>Send</button></div>}</section>
      <details className="panel message-authority" open={canApproveMessaging && (query.saved === "authority" || authorityConnections.some((connection) => Boolean(connection.last_error)))}><summary className="message-settings-summary"><span><span className="eyebrow">SETTINGS</span><strong>Connection settings</strong><small>{canApproveMessaging ? "Pause, permissions and pairing" : "Read-only for this role"}</small></span><b>View</b></summary><div className="message-authority-body">{platform === "telegram" && canManageIdentity && !telegram ? <form action={startTelegramPairingAction} className="authority-group"><label>Creator Telegram username<input name="telegramUsername" placeholder="ThrillNoir" required /></label><p>This only pairs the private agency bot. It does not send a message.</p><button className="primary" type="submit">Start Telegram pairing</button></form> : null}{!canApproveMessaging && <div className="permission-note">An agency administrator or operator manages sending permissions and the emergency pause.</div>}{authorityConnections.map((connection) => <div className="authority-group" key={connection.id}><div className="authority-title"><span className="platform-mark">{connection.platform.slice(0,2).toUpperCase()}</span><div><strong>{connectionLabel(connection)}</strong><small>{labels[connection.platform]} · {statusLabel(connection.status)}</small></div></div>{canApproveMessaging ? <><form action={updateMessagingAuthorityAction}><input type="hidden" name="connectionId" value={connection.id} /><input type="hidden" name="platform" value={platform ?? ""} /><input type="hidden" name="accountId" value={query.accountId ?? ""} /><input type="hidden" name="thread" value={query.thread ?? ""} /><label>Sending mode<select name="mode" defaultValue={connection.mode}><option value="observe">Observe only</option><option value="assist">Assist — reviewed sending</option><option value="operate" disabled={!connection.outbound_validated}>Automatic sending — validated</option></select></label><div className="authority-checks"><label><input type="checkbox" name="readEnabled" defaultChecked={Boolean(connection.read_enabled)} /> Read messages</label><label><input type="checkbox" name="writeEnabled" defaultChecked={Boolean(connection.write_enabled)} /> Send messages</label></div>{connection.last_error && <p>{connection.last_error}</p>}<button className="secondary-action" type="submit">Save settings</button></form>{connection.platform === "telegram" && canManageIdentity && telegramConnector?.status === "pending_validation" ? <div className="connection-row-actions"><a className="primary" href={`https://t.me/${encodeURIComponent(telegramConnector.expected_bot_username.replace(/^@/, ""))}?start=cos_${encodeURIComponent(context.creator.creator_id)}`} target="_blank" rel="noreferrer">Open Telegram &amp; tap Start ↗</a><form action={completeTelegramPairingAction}><button className="secondary-action" type="submit">Confirm pairing</button></form></div> : connection.platform === "telegram" && canManageIdentity ? <form action={validateTelegramConnectorAction}><button className="secondary-action validate-connector" type="submit">Validate bot & pairing</button></form> : null}</> : <small className="permission-note">{connection.last_error || "Connection settings are managed by agency staff."}</small>}</div>)}</div></details></div>
    <details className="panel message-audit" open={data.audit.some((event) => attentionEvent(event.event_type))}><summary className="message-settings-summary"><span><span className="eyebrow">AUDIT</span><strong>Messaging activity</strong><small>{data.audit.length ? `${data.audit.length} recent events` : "No events yet"}</small></span><b>View</b></summary><div>{data.audit.map((event) => <article className="audit-row" key={event.id}><div><strong>{statusLabel(event.event_type)}</strong><small>{event.display_name || "Unified Messages"}</small></div><span>{event.actor}</span><time>{formatDate(event.created_at)}</time></article>)}{!data.audit.length ? <div className="empty">No messaging events yet.</div> : null}</div></details>
  </AppShell>;
}
