type UnknownRecord = Record<string, unknown>;
import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";
type DuePost = {
  id: string;
  creator_id: string;
  account_id: string;
  asset_id: string;
  caption: string;
  extension: string;
  relative_path: string;
  dropbox_root: string;
  provider_container_id: string | null;
  provider_container_type: string | null;
};
type InstagramConversation = { id?: string; updated_time?: string };
type InstagramParticipant = { id?: string; username?: string };
type InstagramMessage = {
  id?: string; created_time?: string; message?: string;
  from?: InstagramParticipant; to?: { data?: InstagramParticipant[] };
  attachments?: { data?: UnknownRecord[] };
  shares?: { data?: Array<{ link?: string }> };
  story?: { reply_to?: { link?: string } };
};
type InstagramReplyDraft = {
  id: string; creator_id: string; connection_id: string; thread_id: string; body: string; status: string;
  requested_by: string;
  external_thread_id: string; participant_external_id: string; participant_name: string; participant_handle: string;
  last_inbound_at: string | null;
  connection_status: string; write_enabled: number; outbound_validated: number; emergency_paused: number;
};

const COMPOSIO_V3 = "https://backend.composio.dev/api/v3";
const COMPOSIO_V31 = "https://backend.composio.dev/api/v3.1";

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

async function jsonRequest<T>(url: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": apiKey, ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    const error = record(payload.error);
    throw new Error(String(error?.message ?? payload.message ?? `Composio request failed (${response.status}).`));
  }
  return payload as T;
}

async function executeTool<T>(env: Env, slug: string, connectedAccountId: string, userId: string, args: UnknownRecord): Promise<T> {
  const response = await jsonRequest<{ successful?: boolean; data?: T; error?: string | { message?: string } }>(
    `${COMPOSIO_V31}/tools/execute/${slug}`,
    env.COMPOSIO_API_KEY,
    { method: "POST", body: JSON.stringify({ connected_account_id: connectedAccountId, user_id: userId, version: "latest", arguments: args }) },
  );
  if (response.successful === false) {
    const message = typeof response.error === "string" ? response.error : response.error?.message;
    throw new Error(message || `${slug} failed.`);
  }
  if (response.data === undefined) throw new Error(`${slug} returned no data.`);
  return response.data;
}

async function proxyInstagram<T>(env: Env, connectedAccountId: string, endpoint: string, method: "GET" | "POST"): Promise<T> {
  const response = await jsonRequest<{ status?: number; data?: T }>(
    `${COMPOSIO_V3}/tools/execute/proxy`,
    env.COMPOSIO_API_KEY,
    { method: "POST", body: JSON.stringify({ connected_account_id: connectedAccountId, endpoint, method }) },
  );
  if (!response.status || response.status < 200 || response.status >= 300) {
    throw new Error(`Instagram connection check failed (${response.status ?? "unknown"}).`);
  }
  if (response.data === undefined) throw new Error("Instagram connection check returned no data.");
  return response.data;
}

const INSTAGRAM_MESSAGE_SUBSCRIPTIONS = ["messages", "messaging_postbacks", "messaging_seen", "message_reactions", "messaging_referral"] as const;
const MAX_MESSAGE_MEDIA_BYTES = 50 * 1024 * 1024;

async function ensureInstagramMessageSubscriptions(env: Env, connectedAccountId: string, instagramUserId: string) {
  const endpoint = `/v25.0/${encodeURIComponent(instagramUserId)}/subscribed_apps`;
  const readFields = async () => {
    const payload = await proxyInstagram<unknown>(env, connectedAccountId, endpoint, "GET");
    const subscriptions = records(record(payload)?.data);
    return new Set(subscriptions.flatMap((item) => Array.isArray(item.subscribed_fields) ? item.subscribed_fields.map(String) : []));
  };
  let fields = await readFields();
  const missing = INSTAGRAM_MESSAGE_SUBSCRIPTIONS.filter((field) => !fields.has(field));
  if (missing.length) {
    const subscribed = await proxyInstagram<unknown>(env, connectedAccountId, `${endpoint}?subscribed_fields=${encodeURIComponent(INSTAGRAM_MESSAGE_SUBSCRIPTIONS.join(","))}`, "POST");
    if (record(subscribed)?.success !== true) throw new Error("Instagram did not confirm its messaging webhook subscription.");
    fields = await readFields();
  }
  const stillMissing = INSTAGRAM_MESSAGE_SUBSCRIPTIONS.filter((field) => !fields.has(field));
  if (stillMissing.length) throw new Error(`Instagram messaging subscription is incomplete: ${stillMissing.join(", ")}.`);
  return { subscribedFields: INSTAGRAM_MESSAGE_SUBSCRIPTIONS.length, repaired: missing.length > 0 };
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isInstagramPublicLink(url: URL) {
  return url.hostname === "instagram.com" || url.hostname === "www.instagram.com";
}

function isMetaMediaHost(url: URL) {
  return url.hostname === "lookaside.instagram.com" || url.hostname === "fbsbx.com" || url.hostname.endsWith(".fbsbx.com") || url.hostname.endsWith(".fbcdn.net") || url.hostname.endsWith(".cdninstagram.com");
}

async function fetchMetaMedia(source: URL) {
  let current = source;
  for (let redirect = 0; redirect < 4; redirect++) {
    if (!isMetaMediaHost(current)) throw new Error(`Instagram returned an untrusted media host (${current.hostname}).`);
    const response = await fetch(current, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Instagram media redirect was incomplete.");
      const next = safeHttpsUrl(new URL(location, current).toString());
      if (!next) throw new Error("Instagram media redirect was invalid.");
      current = next;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Instagram media could not be collected (${response.status}).`);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!/^(image|video|audio)\//.test(contentType)) throw new Error("Instagram returned an unsupported media type.");
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_MESSAGE_MEDIA_BYTES) throw new Error("Instagram media exceeds the 50 MB preview limit.");
    let received = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_MESSAGE_MEDIA_BYTES) throw new Error("Instagram media exceeds the 50 MB preview limit.");
        controller.enqueue(chunk);
      },
    }));
    return { body, contentType };
  }
  throw new Error("Instagram media redirected too many times.");
}

async function storeMessageAttachment(env: Env, creatorId: string, input: { messageId: string; externalMessageId: string; sourceKey: string; kind: "story" | "image" | "video" | "audio" | "file"; sourceUrl: URL }) {
  const existing = await env.DB.prepare("SELECT status,object_key FROM message_attachments WHERE creator_id=? AND message_id=? AND source_key=?")
    .bind(creatorId, input.messageId, input.sourceKey).first<{ status: string; object_key: string | null }>();
  if (existing?.status === "ready" && existing.object_key) return;
  const attachmentId = `instagram-attachment-${(await sha256(`${input.externalMessageId}:${input.sourceKey}`)).slice(0, 40)}`;
  const objectKey = `messages/${creatorId}/${await sha256(`${input.externalMessageId}:${input.sourceKey}:media`)}`;
  try {
    const media = await fetchMetaMedia(input.sourceUrl);
    await env.PREVIEWS.put(objectKey, media.body, { httpMetadata: { contentType: media.contentType }, customMetadata: { creatorId, messageId: input.messageId } });
    await env.DB.prepare(`INSERT INTO message_attachments
      (id,creator_id,message_id,source_key,kind,object_key,mime_type,status,error,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id,message_id,source_key) DO UPDATE SET kind=excluded.kind,object_key=excluded.object_key,mime_type=excluded.mime_type,status='ready',error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(attachmentId, creatorId, input.messageId, input.sourceKey, input.kind, objectKey, media.contentType).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram media could not be collected.";
    await env.DB.prepare(`INSERT INTO message_attachments
      (id,creator_id,message_id,source_key,kind,status,error,updated_at)
      VALUES (?, ?, ?, ?, ?, 'failed', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id,message_id,source_key) DO UPDATE SET status='failed',error=excluded.error,updated_at=CURRENT_TIMESTAMP`)
      .bind(attachmentId, creatorId, input.messageId, input.sourceKey, input.kind, message.slice(0, 500)).run();
  }
}

async function syncMessageAttachments(env: Env, creatorId: string, messageId: string, externalMessageId: string, message: InstagramMessage) {
  for (const [index, share] of (message.shares?.data ?? []).entries()) {
    const url = safeHttpsUrl(share.link);
    if (!url || !isInstagramPublicLink(url)) continue;
    const sourceKey = `shared-post:${index}`;
    const attachmentId = `instagram-attachment-${(await sha256(`${externalMessageId}:${sourceKey}`)).slice(0, 40)}`;
    await env.DB.prepare(`INSERT INTO message_attachments
      (id,creator_id,message_id,source_key,kind,external_url,status,error,updated_at)
      VALUES (?, ?, ?, ?, 'shared_post', ?, 'ready', NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id,message_id,source_key) DO UPDATE SET external_url=excluded.external_url,status='ready',error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(attachmentId, creatorId, messageId, sourceKey, url.toString()).run();
  }
  const storyUrl = safeHttpsUrl(message.story?.reply_to?.link);
  if (storyUrl && isInstagramPublicLink(storyUrl)) {
    const sourceKey = "story:reply";
    const attachmentId = `instagram-attachment-${(await sha256(`${externalMessageId}:${sourceKey}`)).slice(0, 40)}`;
    await env.DB.prepare(`INSERT INTO message_attachments
      (id,creator_id,message_id,source_key,kind,external_url,status,error,updated_at)
      VALUES (?, ?, ?, ?, 'story', ?, 'ready', NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id,message_id,source_key) DO UPDATE SET kind='story',external_url=excluded.external_url,status='ready',error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(attachmentId, creatorId, messageId, sourceKey, storyUrl.toString()).run();
  } else if (storyUrl) {
    await storeMessageAttachment(env, creatorId, { messageId, externalMessageId, sourceKey: "story:reply", kind: "story", sourceUrl: storyUrl });
  }
  for (const [index, attachment] of (message.attachments?.data ?? []).entries()) {
    const image = record(attachment.image_data);
    const video = record(attachment.video_data);
    const audio = record(attachment.audio_data);
    const candidate = image?.url ?? video?.url ?? audio?.url ?? attachment.file_url ?? attachment.url;
    const sourceUrl = safeHttpsUrl(candidate);
    if (!sourceUrl) continue;
    const kind = image ? "image" : video ? "video" : audio ? "audio" : "file";
    await storeMessageAttachment(env, creatorId, { messageId, externalMessageId, sourceKey: `attachment:${index}`, kind, sourceUrl });
  }
}

function responseId(value: unknown, label: string) {
  const root = record(value) ?? {};
  const data = record(root.data) ?? root;
  const id = [data.id, data.message_id, data.creation_id, data.media_id, data.post_id, root.id, root.message_id].find((item) => typeof item === "string" || typeof item === "number");
  if (id === undefined) throw new Error(`${label} returned no Instagram receipt.`);
  return String(id);
}

function dropboxPath(root: string, relative: string) {
  return `/${[root, relative].map((part) => part.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
}

function mediaType(extension: string) {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  if (["jpg", "jpeg", "png"].includes(normalized)) return "photo" as const;
  if (["mp4", "mov"].includes(normalized)) return "reel" as const;
  throw new Error("Instagram supports JPG, PNG, MP4 or MOV assets in this workflow.");
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
}

function dataRecords(value: unknown) {
  return records(record(value)?.data);
}

function scalarMetric(item: UnknownRecord) {
  const total = record(item.total_value)?.value;
  if (typeof total === "number") return total;
  const first = records(item.values)[0];
  return typeof first?.value === "number" ? first.value : null;
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function d1TimestampMs(value: string | null) {
  if (!value) return Number.NaN;
  const normalized = value.replace(" ", "T");
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`).getTime();
}

function isDefinitiveInstagramRejection(message: string) {
  return /\bstatus 4\d\d\b/i.test(message) || /outside of allowed window/i.test(message);
}

async function currentInstagramConnection(env: Env, creatorId: string) {
  const connection = await env.DB.prepare(`SELECT pc.connected_account_id,pc.status,pc.external_account_id,pc.display_name,oa.id AS account_id,mc.id AS messaging_connection_id
    FROM provider_connections pc JOIN operational_accounts oa ON oa.creator_id=pc.creator_id AND oa.platform='instagram'
    JOIN messaging_connections mc ON mc.creator_id=pc.creator_id AND mc.platform='instagram'
    WHERE pc.creator_id=? AND pc.service='instagram' ORDER BY oa.label LIMIT 1`)
    .bind(creatorId).first<{ connected_account_id: string; status: string; external_account_id: string; display_name: string; account_id: string; messaging_connection_id: string }>();
  if (!connection || connection.status !== "active" || !connection.external_account_id) throw new Error("Instagram is not connected.");
  return connection;
}

async function resolveInstagramRecipient(env: Env, creatorId: string, externalThreadId: string) {
  const connection = await currentInstagramConnection(env, creatorId);
  const payload = await executeTool<unknown>(env, "INSTAGRAM_LIST_ALL_MESSAGES", connection.connected_account_id, `creator-os:${creatorId}:service:instagram`, {
    conversation_id: externalThreadId,
    graph_api_version: "v25.0",
    limit: 100,
  });
  const root = record(payload) ?? {};
  const messages = (Array.isArray(payload) ? records(payload) : dataRecords(root)) as InstagramMessage[];
  const selfUsername = normalizedUsername(connection.display_name);
  const isSelf = (item: InstagramParticipant | undefined) => Boolean(item) && (item!.id === connection.external_account_id || (selfUsername && normalizedUsername(item!.username) === selfUsername));
  const inboundSender = messages.map((message) => message.from).find((item) => item?.id && !isSelf(item));
  const outboundRecipient = messages.flatMap((message) => message.to?.data ?? []).find((item) => item.id && !isSelf(item));
  const recipient = inboundSender ?? outboundRecipient;
  if (!recipient?.id) throw new Error("Instagram did not provide a safe recipient ID for this conversation.");
  return { connection, recipient, messageCount: messages.length };
}

function normalizedUsername(value: string | undefined) {
  return value?.replace(/^@/, "").trim().toLowerCase() ?? "";
}

async function syncInstagramMessages(env: Env, creatorId: string, force = false) {
  const connection = await currentInstagramConnection(env, creatorId);
  const state = await env.DB.prepare("SELECT last_messages_sync_at FROM instagram_sync_state WHERE creator_id=?").bind(creatorId).first<{ last_messages_sync_at: string | null }>();
  const previousSync = state?.last_messages_sync_at ? new Date(`${state.last_messages_sync_at.replace(" ", "T")}Z`).getTime() : 0;
  const listed = await executeTool<unknown>(env, "INSTAGRAM_LIST_ALL_CONVERSATIONS", connection.connected_account_id, `creator-os:${creatorId}:service:instagram`, {
    graph_api_version: "v25.0",
    ig_user_id: connection.external_account_id,
    platform: "instagram",
    limit: 25,
  });
  const root = record(listed) ?? {};
  const conversations = (Array.isArray(listed) ? records(listed) : dataRecords(root)) as InstagramConversation[];
  let threadCount = 0;
  let newMessageCount = 0;
  let newInboundCount = 0;

  for (const conversation of conversations) {
    if (!conversation.id) continue;
    const updatedAt = conversation.updated_time ? new Date(conversation.updated_time).getTime() : 0;
    if (!force && previousSync && updatedAt && updatedAt < previousSync - 5 * 60_000) continue;
    const conversationFields = "id,updated_time,participants,messages.limit(100){id,created_time,from,to,message,attachments,shares,story}";
    const detail = await proxyInstagram<unknown>(env, connection.connected_account_id, `/v25.0/${encodeURIComponent(conversation.id)}?fields=${encodeURIComponent(conversationFields)}`, "GET");
    const detailRoot = record(detail) ?? {};
    const participants = dataRecords(detailRoot.participants) as InstagramParticipant[];
    const messages = dataRecords(detailRoot.messages) as InstagramMessage[];
    const selfUsername = normalizedUsername(connection.display_name);
    const isSelf = (item: InstagramParticipant | undefined) => Boolean(item) && (item!.id === connection.external_account_id || (selfUsername && normalizedUsername(item!.username) === selfUsername));
    const messageParticipant = messages.map((message) => message.from).find((item) => item?.id && !isSelf(item));
    const messageRecipient = messages.flatMap((message) => message.to?.data ?? []).find((item) => item.id && !isSelf(item));
    const participant = messageParticipant ?? messageRecipient ?? participants.find((item) => item.id && !isSelf(item)) ?? {};
    const threadId = `instagram-${(await sha256(conversation.id)).slice(0, 40)}`;
    const latestAt = messages.reduce<string | null>((latest, message) => {
      if (!message.created_time) return latest;
      return !latest || message.created_time > latest ? message.created_time : latest;
    }, conversation.updated_time ?? null);
    await env.DB.prepare(`INSERT INTO message_threads
      (id,creator_id,connection_id,external_thread_id,participant_name,participant_handle,participant_external_id,subject,unread_count,last_message_at,status,updated_at)
      VALUES (?,?,?,?,?,?,?,'Instagram conversation',0,?,'open',CURRENT_TIMESTAMP)
      ON CONFLICT(connection_id,external_thread_id) DO UPDATE SET participant_name=excluded.participant_name,participant_handle=excluded.participant_handle,
        participant_external_id=CASE WHEN excluded.participant_external_id<>'' THEN excluded.participant_external_id ELSE message_threads.participant_external_id END,
        last_message_at=COALESCE(excluded.last_message_at,message_threads.last_message_at),updated_at=CURRENT_TIMESTAMP`)
      .bind(threadId, creatorId, connection.messaging_connection_id, conversation.id, participant.username ? `@${participant.username.replace(/^@/, "")}` : "Instagram user", participant.username ? `@${participant.username.replace(/^@/, "")}` : "", participant.id ?? "", latestAt).run();

    let insertedInbound = 0;
    for (const [index, message] of messages.entries()) {
      const externalId = message.id ?? `${conversation.id}:${message.created_time ?? "unknown"}:${index}`;
      const outbound = isSelf(message.from);
      const body = message.message?.trim() || "[Instagram attachment]";
      const localMessageId = crypto.randomUUID();
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO messages
        (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
        VALUES (?,?,?,?,?,?,?,?, 'observed')`)
        .bind(localMessageId, creatorId, threadId, externalId, outbound ? "outbound" : "inbound", outbound ? "creator" : "instagram_user", body, message.created_time ?? null).run();
      if (inserted.meta.changes) {
        newMessageCount++;
        if (!outbound) insertedInbound++;
      } else {
        await env.DB.prepare("UPDATE messages SET direction=?,sender_type=? WHERE creator_id=? AND thread_id=? AND external_message_id=?")
          .bind(outbound ? "outbound" : "inbound", outbound ? "creator" : "instagram_user", creatorId, threadId, externalId).run();
      }
      if (message.attachments?.data?.length || message.shares?.data?.length || message.story?.reply_to?.link) {
        const stored = inserted.meta.changes ? { id: localMessageId } : await env.DB.prepare("SELECT id FROM messages WHERE creator_id=? AND thread_id=? AND external_message_id=?")
          .bind(creatorId, threadId, externalId).first<{ id: string }>();
        if (stored?.id) await syncMessageAttachments(env, creatorId, stored.id, externalId, message);
      }
    }
    if (insertedInbound && previousSync) {
      newInboundCount += insertedInbound;
      await env.DB.prepare("UPDATE message_threads SET unread_count=unread_count+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(insertedInbound, threadId, creatorId).run();
    }
    threadCount++;
  }

  const completionStatements = [
    env.DB.prepare("UPDATE messaging_connections SET status='connected',read_enabled=1,last_synced_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(connection.messaging_connection_id, creatorId),
    env.DB.prepare("INSERT INTO instagram_sync_state (creator_id,connection_id,last_messages_sync_at,last_error,updated_at) VALUES (?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP) ON CONFLICT(creator_id) DO UPDATE SET last_messages_sync_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP").bind(creatorId, connection.messaging_connection_id),
  ];
  if (!previousSync || newMessageCount) completionStatements.push(env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,?,?,'instagram_messages_synced','service:instagram-scheduler','service',?)").bind(crypto.randomUUID(), creatorId, connection.messaging_connection_id, JSON.stringify({ threadCount, newMessageCount, newInboundCount })));
  await env.DB.batch(completionStatements);
  return { threadCount, newMessageCount, newInboundCount };
}

async function syncInstagramAnalytics(env: Env, creatorId: string, force = false) {
  const connection = await currentInstagramConnection(env, creatorId);
  const state = await env.DB.prepare("SELECT last_analytics_sync_at FROM instagram_sync_state WHERE creator_id=?").bind(creatorId).first<{ last_analytics_sync_at: string | null }>();
  if (!force && state?.last_analytics_sync_at) {
    const last = new Date(`${state.last_analytics_sync_at.replace(" ", "T")}Z`).getTime();
    if (Number.isFinite(last) && Date.now() - last < 6 * 60 * 60_000) return { skipped: true, mediaCount: 0 };
  }
  const [insightsPayload, mediaPayload, profilePayload] = await Promise.all([
    executeTool<unknown>(env, "INSTAGRAM_GET_USER_INSIGHTS", connection.connected_account_id, `creator-os:${creatorId}:service:instagram`, {
      ig_user_id: connection.external_account_id,
      metric: ["reach", "follower_count", "accounts_engaged", "total_interactions", "profile_views", "website_clicks"],
      period: "day",
      metric_type: "total_value",
    }),
    executeTool<unknown>(env, "INSTAGRAM_GET_IG_USER_MEDIA", connection.connected_account_id, `creator-os:${creatorId}:service:instagram`, {
      ig_user_id: connection.external_account_id,
      limit: 100,
      fields: "id,media_type,media_product_type,permalink,timestamp,comments_count,like_count,view_count,saved_count,shares_count,total_views_count",
    }),
    executeTool<unknown>(env, "INSTAGRAM_GET_USER_INFO", connection.connected_account_id, `creator-os:${creatorId}:service:instagram`, {}),
  ]);
  const insightRoot = record(insightsPayload) ?? {};
  const insightItems = (Array.isArray(insightsPayload) ? records(insightsPayload) : dataRecords(insightRoot));
  const metrics = new Map(insightItems.map((item) => [String(item.name ?? ""), scalarMetric(item)]));
  const profile = record(profilePayload) ?? {};
  const mediaRoot = record(mediaPayload) ?? {};
  const mediaItems = Array.isArray(mediaPayload) ? records(mediaPayload) : dataRecords(mediaRoot);
  await env.DB.prepare(`INSERT INTO instagram_analytics_snapshots
    (id,creator_id,account_id,reach,follower_count,accounts_engaged,total_interactions,profile_views,website_clicks)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), creatorId, connection.account_id, metrics.get("reach") ?? null, metrics.get("follower_count") ?? numeric(profile.followers_count), metrics.get("accounts_engaged") ?? null, metrics.get("total_interactions") ?? null, metrics.get("profile_views") ?? null, metrics.get("website_clicks") ?? null).run();
  for (const item of mediaItems) {
    if (!item.id) continue;
    const mediaId = String(item.id);
    const permalink = typeof item.permalink === "string" ? item.permalink : null;
    const mediaStatements = [env.DB.prepare(`INSERT INTO instagram_media_metrics
      (creator_id,media_id,permalink,media_type,media_product_type,published_at,like_count,comments_count,view_count,saved_count,shares_count,collected_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(creator_id,media_id) DO UPDATE SET permalink=excluded.permalink,media_type=excluded.media_type,media_product_type=excluded.media_product_type,published_at=excluded.published_at,like_count=excluded.like_count,comments_count=excluded.comments_count,view_count=excluded.view_count,saved_count=excluded.saved_count,shares_count=excluded.shares_count,collected_at=CURRENT_TIMESTAMP`)
      .bind(creatorId, mediaId, permalink, item.media_type ?? null, item.media_product_type ?? null, item.timestamp ?? null, numeric(item.like_count), numeric(item.comments_count), numeric(item.view_count) ?? numeric(item.total_views_count), numeric(item.saved_count), numeric(item.shares_count))];
    if (permalink) mediaStatements.push(env.DB.prepare("UPDATE social_posts SET external_url=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND platform='instagram' AND external_post_id=? AND (external_url IS NULL OR external_url='')").bind(permalink, creatorId, mediaId));
    await env.DB.batch(mediaStatements);
  }
  const missingReceipts = await env.DB.prepare("SELECT id,external_post_id FROM social_posts WHERE creator_id=? AND platform='instagram' AND status='published' AND external_post_id IS NOT NULL AND (external_url IS NULL OR external_url='') ORDER BY published_at DESC LIMIT 20").bind(creatorId).all<{ id: string; external_post_id: string }>();
  for (const post of missingReceipts.results) {
    try {
      const receipt = await executeTool<unknown>(env, "INSTAGRAM_GET_IG_MEDIA", connection.connected_account_id, `creator-os:${creatorId}:service:instagram`, {
        ig_media_id: post.external_post_id,
        fields: "id,permalink,media_type,media_product_type,timestamp",
      });
      const permalink = record(receipt)?.permalink;
      if (typeof permalink === "string" && permalink) {
        await env.DB.prepare("UPDATE social_posts SET external_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND external_post_id=?").bind(permalink, post.id, creatorId, post.external_post_id).run();
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: "instagram_receipt_backfill_failed", postId: post.id, message: error instanceof Error ? error.message : "Lookup failed" }));
    }
  }
  await env.DB.prepare("INSERT INTO instagram_sync_state (creator_id,connection_id,last_analytics_sync_at,last_error,updated_at) VALUES (?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP) ON CONFLICT(creator_id) DO UPDATE SET last_analytics_sync_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP").bind(creatorId, connection.messaging_connection_id).run();
  return { skipped: false, mediaCount: mediaItems.length };
}

async function syncInstagram(env: Env, creatorId: string, forceAnalytics = false) {
  const result: { subscription?: unknown; messages?: unknown; analytics?: unknown; errors: string[] } = { errors: [] };
  try {
    const connection = await currentInstagramConnection(env, creatorId);
    result.subscription = await ensureInstagramMessageSubscriptions(env, connection.connected_account_id, connection.external_account_id);
  } catch (error) {
    result.errors.push(`Messaging subscription: ${error instanceof Error ? error.message : "check failed"}`);
  }
  try { result.messages = await syncInstagramMessages(env, creatorId); } catch (error) { result.errors.push(`Messages: ${error instanceof Error ? error.message : "sync failed"}`); }
  try { result.analytics = await syncInstagramAnalytics(env, creatorId, forceAnalytics); } catch (error) { result.errors.push(`Analytics: ${error instanceof Error ? error.message : "sync failed"}`); }
  const error = result.errors.join(" ").slice(0, 2000) || null;
  if (error) await env.DB.prepare("UPDATE instagram_sync_state SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(error, creatorId).run();
  return { ok: result.errors.length === 0, ...result };
}

async function validateInstagramReplyTarget(request: Request, env: Env) {
  const input = await request.json<{ threadId?: string; creatorId?: string }>();
  if (!input.threadId || !input.creatorId) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const thread = await env.DB.prepare(`SELECT t.id,t.external_thread_id,t.participant_external_id
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id=? AND c.platform='instagram'`)
    .bind(input.threadId, input.creatorId).first<{ id: string; external_thread_id: string; participant_external_id: string }>();
  if (!thread) return Response.json({ ok: false, error: "instagram_thread_not_found" }, { status: 404 });
  const { connection, recipient, messageCount } = await resolveInstagramRecipient(env, input.creatorId, thread.external_thread_id);
  await ensureInstagramMessageSubscriptions(env, connection.connected_account_id, connection.external_account_id);
  if (thread.participant_external_id && thread.participant_external_id !== recipient.id) {
    return Response.json({ ok: false, error: "Instagram recipient changed. Refresh messages before enabling replies." }, { status: 409 });
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE message_threads SET participant_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(recipient.id, thread.id, input.creatorId),
    env.DB.prepare("UPDATE messaging_connections SET outbound_validated=1,status='connected',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(connection.messaging_connection_id, input.creatorId),
    env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?, 'instagram_reply_target_validated','service:instagram-scheduler','service',?)")
      .bind(crypto.randomUUID(), input.creatorId, connection.messaging_connection_id, thread.id, JSON.stringify({ messageCount, recipientIdStored: true, liveMessageSent: false })),
  ]);
  return Response.json({ ok: true, participantUsername: recipient.username ? `@${recipient.username.replace(/^@/, "")}` : null, messageCount });
}

async function markInstagramThreadSeen(request: Request, env: Env) {
  const input = await request.json<{ threadId?: string; creatorId?: string }>();
  if (!input.threadId || !input.creatorId) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const thread = await env.DB.prepare(`SELECT t.id,t.external_thread_id,t.participant_external_id
    FROM message_threads t JOIN messaging_connections c ON c.id=t.connection_id AND c.creator_id=t.creator_id
    WHERE t.id=? AND t.creator_id=? AND c.platform='instagram'`)
    .bind(input.threadId, input.creatorId).first<{ id: string; external_thread_id: string; participant_external_id: string }>();
  if (!thread) return Response.json({ ok: false, error: "instagram_thread_not_found" }, { status: 404 });
  const { connection, recipient } = await resolveInstagramRecipient(env, input.creatorId, thread.external_thread_id);
  if (thread.participant_external_id && thread.participant_external_id !== recipient.id) {
    return Response.json({ ok: false, error: "Instagram recipient changed. Refresh this conversation before marking it read." }, { status: 409 });
  }
  await executeTool<unknown>(env, "INSTAGRAM_MARK_SEEN", connection.connected_account_id, `creator-os:${input.creatorId}:service:instagram`, {
    graph_api_version: "v25.0",
    ig_user_id: connection.external_account_id,
    recipient_id: recipient.id,
  });
  await env.DB.batch([
    env.DB.prepare("UPDATE message_threads SET unread_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(thread.id, input.creatorId),
    env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?, 'instagram_thread_marked_seen',?,?,?)")
      .bind(crypto.randomUUID(), input.creatorId, connection.messaging_connection_id, thread.id, "service:thot-os-web-instagram", "service", JSON.stringify({ providerConfirmed: true })),
  ]);
  return Response.json({ ok: true, markedSeen: true });
}

async function syncInstagramMessagesOnly(env: Env, creatorId: string) {
  const connection = await currentInstagramConnection(env, creatorId);
  const subscription = await ensureInstagramMessageSubscriptions(env, connection.connected_account_id, connection.external_account_id);
  const messages = await syncInstagramMessages(env, creatorId);
  return { ok: true, subscription, messages };
}

async function sendInstagramReply(request: Request, env: Env) {
  const input = await request.json<{ draftId?: string; creatorId?: string }>();
  if (!input.draftId || !input.creatorId) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const draft = await env.DB.prepare(`SELECT d.id,d.creator_id,d.connection_id,d.thread_id,d.body,d.status,d.requested_by,
      t.external_thread_id,t.participant_external_id,t.participant_name,t.participant_handle,
      (SELECT MAX(COALESCE(m.sent_at,m.created_at)) FROM messages m WHERE m.creator_id=d.creator_id AND m.thread_id=d.thread_id AND m.direction='inbound') AS last_inbound_at,
      c.status AS connection_status,c.write_enabled,c.outbound_validated,c.emergency_paused
    FROM instagram_reply_drafts d
    JOIN message_threads t ON t.id=d.thread_id AND t.creator_id=d.creator_id AND t.connection_id=d.connection_id
    JOIN messaging_connections c ON c.id=d.connection_id AND c.creator_id=d.creator_id
    WHERE d.id=? AND d.creator_id=? AND c.platform='instagram'`)
    .bind(input.draftId, input.creatorId).first<InstagramReplyDraft>();
  if (!draft) return Response.json({ ok: false, error: "instagram_reply_draft_not_found" }, { status: 404 });
  if (draft.status !== "draft") return Response.json({ ok: false, error: "instagram_reply_not_sendable" }, { status: 409 });
  if (draft.connection_status !== "connected" || !draft.write_enabled || !draft.outbound_validated || draft.emergency_paused) {
    return Response.json({ ok: false, error: "Instagram sending is locked. Validate the reply target, enable sending, and confirm messaging is not paused." }, { status: 409 });
  }
  const lastInboundAt = d1TimestampMs(draft.last_inbound_at);
  if (!Number.isFinite(lastInboundAt) || Date.now() - lastInboundAt > 24 * 60 * 60_000) {
    return Response.json({ ok: false, error: "Instagram's active reply window is closed. Ask the person to send a new message, refresh the inbox, then reply." }, { status: 409 });
  }
  const { connection, recipient } = await resolveInstagramRecipient(env, input.creatorId, draft.external_thread_id);
  if (draft.participant_external_id && draft.participant_external_id !== recipient.id) {
    return Response.json({ ok: false, error: "Instagram recipient changed. Refresh and validate this conversation again." }, { status: 409 });
  }
  const claim = await env.DB.prepare(`UPDATE instagram_reply_drafts SET status='sending',approved_by=requested_by,approved_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND status='draft'`).bind(draft.id, input.creatorId).run();
  if (!claim.meta.changes) return Response.json({ ok: false, error: "instagram_reply_already_claimed" }, { status: 409 });
  const requestedByRole = await storedHumanActorRole(env, input.creatorId, draft.requested_by);
  await env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?, 'instagram_reply_approved', ?, ?, ?)")
    .bind(crypto.randomUUID(), input.creatorId, draft.connection_id, draft.thread_id, draft.requested_by, requestedByRole, JSON.stringify({ draftId: draft.id, characters: draft.body.length })).run();

  let sendAttempted = false;
  try {
    sendAttempted = true;
    const sent = await executeTool<unknown>(env, "INSTAGRAM_SEND_TEXT_MESSAGE", connection.connected_account_id, `creator-os:${input.creatorId}:service:instagram`, {
      graph_api_version: "v25.0",
      ig_user_id: connection.external_account_id,
      recipient_id: recipient.id,
      text: draft.body,
    });
    const providerMessageId = responseId(sent, "Instagram message");
    const messageId = `instagram-outbound-${(await sha256(providerMessageId)).slice(0, 40)}`;
    await env.DB.batch([
      env.DB.prepare("UPDATE instagram_reply_drafts SET status='sent',provider_message_id=?,completed_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='sending'").bind(providerMessageId, draft.id, input.creatorId),
      env.DB.prepare(`INSERT OR IGNORE INTO messages (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
        VALUES (?,? ,?,?,'outbound','agency',?,CURRENT_TIMESTAMP,'sent')`).bind(messageId, input.creatorId, draft.thread_id, providerMessageId, draft.body),
      env.DB.prepare("UPDATE message_threads SET participant_external_id=?,last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(recipient.id, draft.thread_id, input.creatorId),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?, 'instagram_reply_sent', 'service:instagram-scheduler', 'service', ?)")
        .bind(crypto.randomUUID(), input.creatorId, draft.connection_id, draft.thread_id, JSON.stringify({ draftId: draft.id, providerMessageId })),
    ]);
    return Response.json({ ok: true, sent: true, providerMessageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram reply failed.";
    const definitiveRejection = isDefinitiveInstagramRejection(message);
    const uncertain = sendAttempted && !definitiveRejection;
    const status = uncertain ? "uncertain" : "failed";
    const safeMessage = `${uncertain ? "Outcome uncertain; check Instagram before sending again. " : ""}${message}`.slice(0, 2000);
    await env.DB.batch([
      env.DB.prepare("UPDATE instagram_reply_drafts SET status=?,error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='sending'").bind(status, safeMessage, draft.id, input.creatorId),
      ...(definitiveRejection ? [env.DB.prepare("UPDATE messaging_connections SET outbound_validated=0,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
        .bind("Instagram rejected the reply. Refresh messages and validate this conversation again after a new inbound DM.", draft.connection_id, input.creatorId)] : []),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?,?,'service:instagram-scheduler','service',?)")
        .bind(crypto.randomUUID(), input.creatorId, draft.connection_id, draft.thread_id, uncertain ? "instagram_reply_uncertain" : "instagram_reply_failed", JSON.stringify({ draftId: draft.id, error: safeMessage })),
    ]);
    return Response.json({ ok: false, sent: false, uncertain, error: safeMessage }, { status: uncertain ? 502 : 409 });
  }
}

async function markFailed(env: Env, post: DuePost, message: string, uncertain = false) {
  const safeMessage = `${uncertain ? "Outcome uncertain; verify Instagram before retrying. " : ""}${message}`.slice(0, 2000);
  await env.DB.batch([
    env.DB.prepare("UPDATE social_posts SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(safeMessage, post.id, post.creator_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:instagram-scheduler','service','publish_failed',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ error: safeMessage, uncertain })),
  ]);
}

async function publishPost(env: Env, post: DuePost) {
  const connection = await currentInstagramConnection(env, post.creator_id);
  const instagramUserId = `creator-os:${post.creator_id}:service:instagram`;
  const kind = mediaType(post.extension);
  let containerId = post.provider_container_id;
  if (!containerId) {
    const temporary = await executeTool<{ link?: string }>(env, "DROPBOX_GET_TEMPORARY_LINK", env.COMPOSIO_DROPBOX_CONNECTED_ACCOUNT_ID, `creator-os:${post.creator_id}:service:dropbox`, {
      path: dropboxPath(post.dropbox_root, post.relative_path),
    });
    if (!temporary.link) throw new Error("Dropbox did not return a temporary media link.");
    let created: unknown;
    try {
      created = await executeTool<unknown>(env, "INSTAGRAM_CREATE_MEDIA_CONTAINER", connection.connected_account_id, instagramUserId, {
        ig_user_id: connection.external_account_id,
        caption: post.caption,
        content_type: kind,
        ...(kind === "reel"
          ? { video_url: temporary.link, media_type: "REELS", share_to_feed: true }
          : { image_url: temporary.link }),
      });
      containerId = responseId(created, "Instagram media container");
    } catch (error) {
      await markFailed(env, post, error instanceof Error ? error.message : "Instagram container creation failed.", true);
      return { published: false, failed: true };
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE social_posts SET provider_container_id=?,provider_container_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(containerId, kind, post.id, post.creator_id),
      env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:instagram-scheduler','service','container_created',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ containerId, kind })),
    ]);
  }

  let published: unknown;
  try {
    published = await executeTool<unknown>(env, "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", connection.connected_account_id, instagramUserId, {
      ig_user_id: connection.external_account_id,
      creation_id: containerId,
      max_wait_seconds: kind === "reel" ? 180 : 60,
    });
  } catch (error) {
    await markFailed(env, post, error instanceof Error ? error.message : "Instagram publishing failed.", true);
    return { published: false, failed: true };
  }
  const externalPostId = responseId(published, "Instagram publish");
  let permalink: string | null = null;
  let receiptWarning: string | null = null;
  try {
    const details = await executeTool<unknown>(env, "INSTAGRAM_GET_IG_MEDIA", connection.connected_account_id, instagramUserId, {
      ig_media_id: externalPostId,
      fields: "id,permalink,media_type,media_product_type,timestamp",
    });
    const detailsRecord = record(details) ?? {};
    permalink = typeof detailsRecord.permalink === "string" ? detailsRecord.permalink : null;
  } catch (error) {
    receiptWarning = error instanceof Error ? error.message.slice(0, 1000) : "Instagram permalink lookup failed.";
  }
  const statements = [
    env.DB.prepare("UPDATE social_posts SET status='published',published_at=CURRENT_TIMESTAMP,external_post_id=?,external_url=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(externalPostId, permalink, post.id, post.creator_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:instagram-scheduler','service','publish_completed',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ externalPostId, containerId, kind, permalink })),
    env.DB.prepare("UPDATE operational_accounts SET last_success_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,warning_level='none',warning_message='',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND platform='instagram'").bind(post.creator_id),
  ];
  if (receiptWarning) statements.push(env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:instagram-scheduler','service','receipt_enrichment_failed',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ error: receiptWarning })));
  await env.DB.batch(statements);
  return { published: true, failed: false };
}

async function loadPost(env: Env, creatorId: string, postId: string) {
  return env.DB.prepare(`
    SELECT p.id,p.creator_id,p.account_id,p.asset_id,p.caption,p.provider_container_id,p.provider_container_type,
      a.extension,a.relative_path,c.dropbox_root
    FROM social_posts p
    JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
    JOIN creators c ON c.id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.platform='instagram' AND p.status='scheduled' AND p.approved_at IS NOT NULL
  `).bind(postId, creatorId).first<DuePost>();
}

async function claimAndPublish(env: Env, post: DuePost) {
  const claim = await env.DB.prepare("UPDATE social_posts SET status='publishing',claimed_at=CURRENT_TIMESTAMP,last_attempt_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='scheduled'").bind(post.id, post.creator_id).run();
  if (!claim.meta.changes) return { claimed: false, published: false, failed: false };
  try {
    const result = await publishPost(env, post);
    return { claimed: true, ...result };
  } catch (error) {
    await markFailed(env, post, error instanceof Error ? error.message : "Instagram publishing failed.");
    return { claimed: true, published: false, failed: true };
  }
}

async function publishOne(request: Request, env: Env) {
  const input = await request.json<{ postId?: string; creatorId?: string }>();
  if (!input.postId || !input.creatorId) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const post = await loadPost(env, input.creatorId, input.postId);
  if (!post) return Response.json({ ok: false, error: "post_not_publishable" }, { status: 409 });
  const result = await claimAndPublish(env, post);
  const current = await env.DB.prepare("SELECT status,external_post_id,error FROM social_posts WHERE id=? AND creator_id=?").bind(input.postId, input.creatorId).first();
  return Response.json({ ok: result.published, ...result, post: current }, { status: result.published ? 200 : 409 });
}

async function processDue(env: Env, triggerType: string) {
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO scheduler_runs (id,service,trigger_type,status) VALUES (?,'instagram',?,'running')").bind(runId, triggerType).run();
  let claimed = 0, published = 0, failed = 0;
  try {
    const due = await env.DB.prepare(`
      SELECT p.id,p.creator_id,p.account_id,p.asset_id,p.caption,p.provider_container_id,p.provider_container_type,
        a.extension,a.relative_path,c.dropbox_root
      FROM social_posts p
      JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
      JOIN creators c ON c.id=p.creator_id
      WHERE p.platform='instagram' AND p.status='scheduled' AND p.approved_at IS NOT NULL
        AND p.scheduled_at IS NOT NULL AND unixepoch(p.scheduled_at)<=unixepoch(CURRENT_TIMESTAMP)
      ORDER BY p.scheduled_at LIMIT 3
    `).all<DuePost>();
    for (const post of due.results) {
      const result = await claimAndPublish(env, post);
      if (!result.claimed) continue;
      claimed++;
      if (result.published) published++;
      if (result.failed) failed++;
    }
    await env.DB.prepare("UPDATE scheduler_runs SET status='completed',completed_at=CURRENT_TIMESTAMP,claimed_count=?,published_count=?,failed_count=? WHERE id=?").bind(claimed, published, failed, runId).run();
    console.log(JSON.stringify({ event: "instagram_scheduler_run", runId, claimed, published, failed }));
    return { ok: true, runId, claimed, published, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduler run failed.";
    await env.DB.prepare("UPDATE scheduler_runs SET status='failed',completed_at=CURRENT_TIMESTAMP,claimed_count=?,published_count=?,failed_count=?,error=? WHERE id=?").bind(claimed, published, failed, message.slice(0, 2000), runId).run();
    throw error;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// This is used only for the already-persisted human who requested a reply
// draft. Never call it with an HTTP-supplied actor value.
async function storedHumanActorRole(env: Env, creatorId: string, actor: string) {
  const membership = await env.DB.prepare(`SELECT m.role FROM creator_memberships m
    JOIN users u ON lower(u.email)=lower(m.user_email)
    WHERE m.creator_id=? AND lower(m.user_email)=lower(?)
      AND m.status='active' AND u.status='active'`)
    .bind(creatorId, actor).first<{ role: "agency_admin" | "operator" | "creator" | "viewer" }>();
  if (!membership) throw new Error("The original draft requester is no longer authorised for this creator.");
  return membership.role;
}

async function startConnection(request: Request, env: Env) {
  const input = await request.json<{ callbackUrl?: string; creatorId?: string }>();
  if (!input.callbackUrl?.startsWith("https://thot-os-staging.thot-os.workers.dev/") || !input.creatorId) return Response.json({ ok: false, error: "invalid_connection_scope" }, { status: 400 });
  const account = await env.DB.prepare("SELECT id FROM operational_accounts WHERE creator_id=? AND platform='instagram'").bind(input.creatorId).first();
  if (!account) return Response.json({ ok: false, error: "creator_account_not_found" }, { status: 404 });
  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const callback = new URL(input.callbackUrl);
  callback.searchParams.set("state", state);
  const link = await jsonRequest<{ redirect_url: string; connected_account_id: string; expires_at?: string }>(
    `${COMPOSIO_V3}/connected_accounts/link`, env.COMPOSIO_API_KEY,
    { method: "POST", body: JSON.stringify({ auth_config_id: env.COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID, user_id: `creator-os:${input.creatorId}:service:instagram`, alias: `${input.creatorId}-instagram-${Date.now().toString(36)}`, callback_url: callback.toString() }) },
  );
  await env.DB.prepare("INSERT INTO provider_connection_attempts (id,creator_id,service,state_hash,connected_account_id,status,expires_at) VALUES (?,?,'instagram',?,?,'pending',?)")
    .bind(crypto.randomUUID(), input.creatorId, await sha256(state), link.connected_account_id, link.expires_at ?? new Date(Date.now() + 10 * 60_000).toISOString()).run();
  return Response.json({ ok: true, redirectUrl: link.redirect_url });
}

async function completeConnection(request: Request, env: Env) {
  const input = await request.json<{ state?: string; creatorId?: string }>();
  if (!input.state || !input.creatorId) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const attempt = await env.DB.prepare("SELECT id,connected_account_id,expires_at FROM provider_connection_attempts WHERE creator_id=? AND service='instagram' AND state_hash=? AND status='pending'")
    .bind(input.creatorId, await sha256(input.state)).first<{ id: string; connected_account_id: string; expires_at: string }>();
  if (!attempt || new Date(attempt.expires_at).getTime() < Date.now()) return Response.json({ ok: false, error: "invalid_or_expired_state" }, { status: 400 });
  try {
    const account = await jsonRequest<{ status?: string }>(`${COMPOSIO_V3}/connected_accounts/${attempt.connected_account_id}`, env.COMPOSIO_API_KEY);
    if (account.status !== "ACTIVE") throw new Error(`Instagram authorization is ${account.status ?? "not active"}.`);
    const instagramUserId = `creator-os:${input.creatorId}:service:instagram`;
    const identity = await executeTool<{ id?: string; username?: string }>(env, "INSTAGRAM_GET_USER_INFO", attempt.connected_account_id, instagramUserId, {});
    if (!identity.id || !identity.username) throw new Error("Instagram identity could not be verified.");
    await ensureInstagramMessageSubscriptions(env, attempt.connected_account_id, identity.id);
    const expected = await env.DB.prepare("SELECT handle FROM operational_accounts WHERE creator_id=? AND platform='instagram' ORDER BY label LIMIT 1").bind(input.creatorId).first<{ handle: string }>();
    if (expected?.handle && expected.handle.replace(/^@/, "").toLowerCase() !== identity.username.replace(/^@/, "").toLowerCase()) {
      throw new Error(`Authorized @${identity.username.replace(/^@/, "")}, but the configured creator account is ${expected.handle}.`);
    }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO provider_connections (creator_id,service,connected_account_id,composio_user_id,status,external_account_id,display_name,identity_confirmed_at,last_error,updated_at) VALUES (?,'instagram',?,?,'active',?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP) ON CONFLICT(creator_id,service) DO UPDATE SET connected_account_id=excluded.connected_account_id,composio_user_id=excluded.composio_user_id,status='active',external_account_id=excluded.external_account_id,display_name=excluded.display_name,identity_confirmed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP").bind(input.creatorId, attempt.connected_account_id, instagramUserId, identity.id, `@${identity.username.replace(/^@/, "")}`),
      env.DB.prepare("UPDATE provider_connection_attempts SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(attempt.id),
      env.DB.prepare("UPDATE operational_accounts SET handle=?,connection_status='connected',publishing_mode='scheduled_api',publishing_authority='confirmed',warning_level='none',warning_message='',external_identity_confirmed_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND platform='instagram'").bind(`@${identity.username.replace(/^@/, "")}`, input.creatorId),
      env.DB.prepare("UPDATE messaging_connections SET handle=?,status='connected',read_enabled=1,outbound_validated=0,last_error='Validate a conversation before the first Instagram reply.',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND platform='instagram'").bind(`@${identity.username.replace(/^@/, "")}`, input.creatorId),
      env.DB.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,'service','instagram_connection_verified','instagram',?)").bind(crypto.randomUUID(), input.creatorId, "service:thot-os-web-instagram", JSON.stringify({ username: identity.username })),
    ]);
    return Response.json({ ok: true, displayName: `@${identity.username.replace(/^@/, "")}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram connection failed.";
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_connection_attempts SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message.slice(0, 2000), attempt.id),
      env.DB.prepare("UPDATE operational_accounts SET connection_status='needs_reconnection',publishing_authority='blocked',warning_level='blocked',warning_message=?,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND platform='instagram'").bind(message.slice(0, 500), input.creatorId),
    ]);
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

async function status(env: Env, creatorId: string) {
  const [connection, lastRun, due, syncState, analytics] = await Promise.all([
    env.DB.prepare("SELECT status,display_name,identity_confirmed_at,last_error,updated_at FROM provider_connections WHERE creator_id=? AND service='instagram'").bind(creatorId).first(),
    env.DB.prepare("SELECT status,started_at,completed_at,claimed_count,published_count,failed_count,error FROM scheduler_runs WHERE service='instagram' ORDER BY started_at DESC LIMIT 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM social_posts WHERE creator_id=? AND platform='instagram' AND status='scheduled' AND unixepoch(scheduled_at)<=unixepoch(CURRENT_TIMESTAMP)").bind(creatorId).first<{ count: number }>(),
    env.DB.prepare("SELECT last_messages_sync_at,last_analytics_sync_at,last_error,updated_at FROM instagram_sync_state WHERE creator_id=?").bind(creatorId).first(),
    env.DB.prepare("SELECT reach,follower_count,accounts_engaged,total_interactions,profile_views,website_clicks,collected_at FROM instagram_analytics_snapshots WHERE creator_id=? ORDER BY collected_at DESC LIMIT 1").bind(creatorId).first(),
  ]);
  return Response.json({ ok: true, connection, lastRun, due: due?.count ?? 0, syncState, analytics });
}

async function requestedCreatorId(request: Request) {
  const input = await request.json<{ creatorId?: string }>();
  if (!input.creatorId) throw new Error("Creator scope is required.");
  return input.creatorId;
}

async function authenticatedCreatorId(request: Request, env: Env, url: URL) {
  const candidate = request.method === "GET"
    ? url.searchParams.get("creator")
    : (await request.clone().json<{ creatorId?: unknown }>()).creatorId;
  if (typeof candidate !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(candidate)) throw new Error("Creator scope is required.");
  const service = await requireInternalServiceForCreator(request, env.DB, candidate, "thot-os-web-instagram");
  await internalServiceAuditStatement(env.DB, service, url.pathname).run();
  return candidate;
}

async function syncAllCreators(env: Env) {
  const creators = await env.DB.prepare("SELECT creator_id FROM provider_connections WHERE service='instagram' AND status='active'").all<{ creator_id: string }>();
  return Promise.allSettled(creators.results.map((row) => syncInstagram(env, row.creator_id)));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      let creatorId: string;
      try {
        creatorId = await authenticatedCreatorId(request, env, url);
      } catch {
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      if (request.method === "POST" && url.pathname === "/connections/instagram/start") return startConnection(request, env);
      if (request.method === "POST" && url.pathname === "/connections/instagram/complete") return completeConnection(request, env);
      if (request.method === "POST" && url.pathname === "/posts/instagram/publish") return publishOne(request, env);
      if (request.method === "POST" && url.pathname === "/messages/instagram/validate") return validateInstagramReplyTarget(request, env);
      if (request.method === "POST" && url.pathname === "/messages/instagram/send") return sendInstagramReply(request, env);
      if (request.method === "POST" && url.pathname === "/messages/instagram/seen") return markInstagramThreadSeen(request, env);
      if (request.method === "POST" && url.pathname === "/run") return new Response("Not found", { status: 404 });
      if (request.method === "POST" && url.pathname === "/sync") return Response.json(await syncInstagram(env, await requestedCreatorId(request), true));
      if (request.method === "POST" && url.pathname === "/sync/messages") return Response.json(await syncInstagramMessagesOnly(env, await requestedCreatorId(request)));
      if (request.method === "GET" && url.pathname === "/status") return status(env, creatorId);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: "instagram_scheduler_request_error", path: url.pathname, message: error instanceof Error ? error.message : "Unknown error" }));
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Request failed." }, { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.allSettled([processDue(env, "cron"), syncAllCreators(env)]));
  },
} satisfies ExportedHandler<Env>;
