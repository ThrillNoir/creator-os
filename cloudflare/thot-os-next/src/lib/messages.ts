import { cloudflareEnv, type D1Result } from "./cloudflare";

export const messagePlatforms = ["telegram", "instagram", "fansly", "onlyfans"] as const;
export type MessagePlatform = (typeof messagePlatforms)[number];

export interface MessagingConnection {
  id: string; creator_id: string; account_id: string | null; platform: MessagePlatform; display_name: string; handle: string;
  mode: "observe" | "assist" | "operate"; read_enabled: number; write_enabled: number; outbound_validated: number;
  emergency_paused: number; status: string; last_synced_at: string | null; last_error: string | null;
  thread_count: number; unread_count: number;
}

export interface MessageThread {
  id: string; connection_id: string; external_thread_id: string; platform: MessagePlatform; connection_name: string; participant_name: string;
  participant_handle: string; participant_external_id: string; subject: string; unread_count: number; last_message_at: string | null;
  last_inbound_at: string | null; status: string;
}

export interface MessageRow {
  id: string; direction: "inbound" | "outbound"; sender_type: string; body: string; sent_at: string | null;
  created_at: string; delivery_status: string; attachments: MessageAttachment[];
}

export interface MessageAttachment {
  id: string; message_id: string; kind: "shared_post" | "story" | "image" | "video" | "audio" | "file";
  external_url: string | null; mime_type: string | null; status: "ready" | "unavailable" | "failed"; error: string | null;
}

export interface TelegramLogRow {
  id: string; message_text: string; status: string; requested_by: string; error: string | null; completed_at: string | null; created_at: string;
}

export interface InstagramReplyDraft {
  id: string; body: string; status: "draft" | "approved" | "sending" | "sent" | "failed" | "uncertain" | "cancelled";
  requested_by: string; approved_by: string | null; provider_message_id: string | null; error: string | null;
  completed_at: string | null; created_at: string;
}

export interface PremiumReplyDraft {
  id: string; body: string; status: "draft" | "approved" | "claimed" | "sent" | "failed" | "cancelled";
  requested_by: string; approved_by: string | null; error: string | null; receipt: string;
  completed_at: string | null; created_at: string;
}

export interface MessagingAuditRow {
  id: string; event_type: string; actor: string; detail: string; created_at: string; display_name: string | null;
}

export function isMessagePlatform(value: string | undefined): value is MessagePlatform {
  return messagePlatforms.includes(value as MessagePlatform);
}

export async function getUnifiedMessages(platform?: MessagePlatform, selectedThreadId?: string) {
  const { DB } = cloudflareEnv();
  const [connectionsResult, threadsResult, telegramResult, instagramSentResult, premiumSentResult, auditResult] = await Promise.all([
    DB.prepare(`SELECT c.*,COUNT(DISTINCT t.id) AS thread_count,COALESCE(SUM(t.unread_count),0) AS unread_count
      FROM messaging_connections c LEFT JOIN message_threads t ON t.connection_id=c.id AND t.creator_id=c.creator_id
      WHERE c.creator_id='adelaide' GROUP BY c.id ORDER BY c.platform,c.display_name`).all<MessagingConnection>(),
    platform
      ? DB.prepare(`SELECT t.id,t.connection_id,t.external_thread_id,c.platform,c.display_name AS connection_name,t.participant_name,t.participant_handle,t.participant_external_id,t.subject,t.unread_count,t.last_message_at,t.status,
          (SELECT MAX(COALESCE(m.sent_at,m.created_at)) FROM messages m WHERE m.creator_id=t.creator_id AND m.thread_id=t.id AND m.direction='inbound') AS last_inbound_at
          FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
          WHERE t.creator_id='adelaide' AND c.platform=? ORDER BY COALESCE(t.last_message_at,t.updated_at) DESC LIMIT 100`).bind(platform).all<MessageThread>()
      : DB.prepare(`SELECT t.id,t.connection_id,t.external_thread_id,c.platform,c.display_name AS connection_name,t.participant_name,t.participant_handle,t.participant_external_id,t.subject,t.unread_count,t.last_message_at,t.status,
          (SELECT MAX(COALESCE(m.sent_at,m.created_at)) FROM messages m WHERE m.creator_id=t.creator_id AND m.thread_id=t.id AND m.direction='inbound') AS last_inbound_at
          FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
          WHERE t.creator_id='adelaide' ORDER BY COALESCE(t.last_message_at,t.updated_at) DESC LIMIT 100`).all<MessageThread>(),
    DB.prepare("SELECT id,message_text,status,requested_by,error,completed_at,created_at FROM telegram_send_log WHERE creator_id='adelaide' ORDER BY created_at DESC LIMIT 20").all<TelegramLogRow>(),
    DB.prepare("SELECT COUNT(*) AS count FROM instagram_reply_drafts WHERE creator_id='adelaide' AND status='sent'").first<{ count: number }>(),
    DB.prepare("SELECT COUNT(*) AS count FROM premium_message_drafts WHERE creator_id='adelaide' AND status='sent'").first<{ count: number }>(),
    DB.prepare(`SELECT e.id,e.event_type,e.actor,e.detail,e.created_at,c.display_name FROM messaging_audit_events e
      LEFT JOIN messaging_connections c ON c.id=e.connection_id AND c.creator_id=e.creator_id
      WHERE e.creator_id='adelaide' ORDER BY e.created_at DESC LIMIT 30`).all<MessagingAuditRow>(),
  ]);
  const threads = threadsResult.results;
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? threads[0] ?? null;
  const [messageRows, instagramDraftRows, premiumDraftRows, attachmentRows] = selectedThread
    ? await Promise.all([
        DB.prepare(`SELECT m.id,m.direction,m.sender_type,m.body,m.sent_at,m.created_at,m.delivery_status FROM messages m
          JOIN message_threads t ON t.id=m.thread_id WHERE m.creator_id='adelaide' AND m.thread_id=? AND t.creator_id='adelaide'
          ORDER BY unixepoch(replace(substr(COALESCE(m.sent_at,m.created_at),1,19),'T',' ')),m.id`).bind(selectedThread.id).all<MessageRow>(),
        selectedThread.platform === "instagram"
          ? DB.prepare(`SELECT d.id,d.body,d.status,d.requested_by,d.approved_by,d.provider_message_id,d.error,d.completed_at,d.created_at
              FROM instagram_reply_drafts d JOIN message_threads t ON t.id=d.thread_id AND t.creator_id=d.creator_id
              WHERE d.creator_id='adelaide' AND d.thread_id=? AND d.status NOT IN ('draft','cancelled') ORDER BY d.created_at DESC LIMIT 20`).bind(selectedThread.id).all<InstagramReplyDraft>()
          : Promise.resolve({ results: [], success: true } as D1Result<InstagramReplyDraft>),
        selectedThread.platform === "fansly" || selectedThread.platform === "onlyfans"
          ? DB.prepare(`SELECT d.id,d.body,d.status,d.requested_by,d.approved_by,d.error,d.receipt,d.completed_at,d.created_at
              FROM premium_message_drafts d JOIN message_threads t ON t.id=d.thread_id AND t.creator_id=d.creator_id
              WHERE d.creator_id='adelaide' AND d.thread_id=? AND d.status NOT IN ('draft','cancelled') ORDER BY d.created_at DESC LIMIT 20`).bind(selectedThread.id).all<PremiumReplyDraft>()
          : Promise.resolve({ results: [], success: true } as D1Result<PremiumReplyDraft>),
        DB.prepare(`SELECT a.id,a.message_id,a.kind,a.external_url,a.mime_type,a.status,a.error
          FROM message_attachments a JOIN messages m ON m.id=a.message_id AND m.creator_id=a.creator_id
          WHERE a.creator_id='adelaide' AND m.thread_id=? ORDER BY a.created_at,a.id`).bind(selectedThread.id).all<MessageAttachment>(),
      ])
    : [
        { results: [], success: true } as D1Result<MessageRow>,
        { results: [], success: true } as D1Result<InstagramReplyDraft>,
        { results: [], success: true } as D1Result<PremiumReplyDraft>,
        { results: [], success: true } as D1Result<MessageAttachment>,
      ];
  const attachmentsByMessage = new Map<string, MessageAttachment[]>();
  for (const attachment of attachmentRows.results) {
    const current = attachmentsByMessage.get(attachment.message_id) ?? [];
    current.push(attachment);
    attachmentsByMessage.set(attachment.message_id, current);
  }
  const messages = messageRows.results.map((message) => ({ ...message, attachments: attachmentsByMessage.get(message.id) ?? [] }));
  const connections = connectionsResult.results;
  return {
    connections, threads, selectedThread, messages,
    instagramDrafts: instagramDraftRows.results,
    premiumDrafts: premiumDraftRows.results,
    telegramLog: telegramResult.results, audit: auditResult.results,
    paused: connections.some((connection) => connection.emergency_paused === 1),
    metrics: {
      conversations: connections.reduce((sum, connection) => sum + Number(connection.thread_count), 0),
      unread: connections.reduce((sum, connection) => sum + Number(connection.unread_count), 0),
      sent: telegramResult.results.filter((item) => item.status === "sent").length + Number(instagramSentResult?.count ?? 0) + Number(premiumSentResult?.count ?? 0),
      attention: connections.filter((connection) => connection.status !== "connected" && connection.status !== "device_bridge_ready").length,
    },
  };
}
