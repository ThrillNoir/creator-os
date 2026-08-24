type UnknownRecord = Record<string, unknown>;
import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";
type TelegramMessage = {
  message_id?: number; text?: string; caption?: string; date?: number;
  photo?: unknown[]; video?: unknown; document?: unknown; voice?: unknown; audio?: unknown; sticker?: unknown;
  chat?: { id?: number; type?: string; username?: string; first_name?: string; last_name?: string };
  from?: { id?: number; username?: string; first_name?: string; last_name?: string; is_bot?: boolean };
};
type TelegramUpdate = { update_id?: number; message?: TelegramMessage; edited_message?: TelegramMessage };
type Connector = {
  creator_id: string; connection_id: string; chat_id: string; telegram_user_id: string; telegram_username: string;
  display_name: string; expected_bot_username: string; status: string; next_update_id: number;
};

const COMPOSIO_V31 = "https://backend.composio.dev/api/v3.1";

function threadId(creatorId: string) {
  return `${creatorId}-telegram-private`;
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

export async function executeTelegramTool<T>(
  env: Pick<Env, "COMPOSIO_API_KEY" | "COMPOSIO_TELEGRAM_CONNECTED_ACCOUNT_ID" | "COMPOSIO_TELEGRAM_USER_ID">,
  slug: string,
  args: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(`${COMPOSIO_V31}/tools/execute/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.COMPOSIO_API_KEY },
    body: JSON.stringify({ connected_account_id: env.COMPOSIO_TELEGRAM_CONNECTED_ACCOUNT_ID, user_id: env.COMPOSIO_TELEGRAM_USER_ID, version: "latest", arguments: args }),
  });
  const payload = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok || payload.successful === false) {
    const nested = record(payload.error);
    throw new Error(String(nested?.message ?? payload.error ?? payload.message ?? `${slug} failed (${response.status}).`));
  }
  return (payload.data ?? payload) as T;
}

async function connector(env: Env, creatorId: string) {
  return env.DB.prepare("SELECT * FROM telegram_connector_state WHERE creator_id=?").bind(creatorId).first<Connector>();
}

async function activeConnectors(env: Env) {
  return env.DB.prepare("SELECT * FROM telegram_connector_state WHERE status IN ('connected','needs_check','failed')").all<Connector>();
}

async function validateIdentity(env: Env, creatorId: string) {
  const state = await connector(env, creatorId);
  if (!state) throw new Error("This creator’s Telegram pairing has not been configured.");
  try {
    const response = await executeTelegramTool<{ ok?: boolean; result?: { id?: number; username?: string; first_name?: string; is_bot?: boolean } }>(env, "TELEGRAM_GET_ME", {});
    const identity = response.result;
    const expected = state.expected_bot_username.replace(/^@/, "").toLowerCase();
    if (!response.ok || !identity?.id || !identity.is_bot || identity.username?.toLowerCase() !== expected) {
      throw new Error(`Telegram bot identity did not match @${expected}.`);
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE telegram_connector_state SET status='connected',identity_confirmed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(creatorId),
      env.DB.prepare("UPDATE messaging_connections SET status='connected',outbound_validated=1,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(state.connection_id, creatorId),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,?,?,'telegram_identity_validated','service:telegram-bridge','service',?)").bind(crypto.randomUUID(), creatorId, state.connection_id, JSON.stringify({ username: `@${identity.username}` })),
    ]);
    return { ok: true, username: `@${identity.username}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram validation failed.";
    await env.DB.batch([
      env.DB.prepare("UPDATE telegram_connector_state SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(message.slice(0, 1000), creatorId),
      env.DB.prepare("UPDATE messaging_connections SET status='needs_check',outbound_validated=0,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(message.slice(0, 1000), state.connection_id, creatorId),
    ]);
    throw error;
  }
}

async function importUpdate(env: Env, state: Connector, update: TelegramUpdate) {
  const creatorId = state.creator_id;
  const creatorThreadId = threadId(creatorId);
  const message = update.message ?? update.edited_message;
  const updateId = update.update_id;
  if (updateId == null) return { imported: false, nextOffset: state.next_update_id };
  const nextOffset = updateId + 1;
  if (!message?.chat?.id || String(message.chat.id) !== state.chat_id || message.chat.type !== "private" || message.from?.is_bot) {
    return { imported: false, nextOffset };
  }
  const attachmentLabel = message.photo?.length ? "[Telegram photo]" : message.video ? "[Telegram video]" : message.document ? "[Telegram document]" : message.voice ? "[Telegram voice message]" : message.audio ? "[Telegram audio]" : message.sticker ? "[Telegram sticker]" : "";
  const body = String(message.text ?? message.caption ?? attachmentLabel).trim().slice(0, 20_000);
  if (!body || /^\/start\s+cos_/i.test(body)) return { imported: false, nextOffset };
  const sentAt = message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString();
  const participantName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || state.display_name || "Creator";
  const participantHandle = message.from?.username ? `@${message.from.username}` : state.telegram_username ? `@${state.telegram_username.replace(/^@/, "")}` : "";
  const externalMessageId = String(message.message_id ?? `update-${updateId}`);
  const existing = await env.DB.prepare("SELECT id FROM messages WHERE creator_id=? AND thread_id=? AND external_message_id=?").bind(creatorId, creatorThreadId, externalMessageId).first<{ id: string }>();
  const statements = [
    env.DB.prepare(`INSERT INTO message_threads (id,creator_id,connection_id,external_thread_id,participant_name,participant_handle,subject,unread_count,last_message_at,status)
      VALUES (?,?,?,? ,?,?, 'Agency ↔ creator',?,?,'open')
      ON CONFLICT(id) DO UPDATE SET participant_name=excluded.participant_name,participant_handle=excluded.participant_handle,
        unread_count=message_threads.unread_count+excluded.unread_count,last_message_at=excluded.last_message_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(creatorThreadId, creatorId, state.connection_id, `${creatorId}-telegram-private`, participantName, participantHandle, existing ? 0 : 1, sentAt),
  ];
  if (existing) {
    statements.push(env.DB.prepare("UPDATE messages SET body=?,sent_at=?,delivery_status='received' WHERE id=? AND creator_id=?").bind(body, sentAt, existing.id, creatorId));
  } else {
    statements.push(
      env.DB.prepare(`INSERT INTO messages (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
        VALUES (?,?,?,?, 'inbound','creator',?,?,'received')`).bind(`telegram-in-${creatorId}-${updateId}`, creatorId, creatorThreadId, externalMessageId, body, sentAt),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?, 'telegram_reply_collected','service:telegram-bridge','service',?)").bind(crypto.randomUUID(), creatorId, state.connection_id, creatorThreadId, JSON.stringify({ updateId, externalMessageId })),
    );
  }
  await env.DB.batch(statements);
  return { imported: !existing, nextOffset };
}

async function pollSharedUpdates(env: Env, trigger: string, requestedCreatorId?: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO telegram_bot_state (id) VALUES ('shared')").run();
  const claimed = await env.DB.prepare(`UPDATE telegram_bot_state SET claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id='shared' AND (claimed_at IS NULL OR claimed_at<datetime('now','-5 minutes'))`).run();
  if (!claimed.meta.changes) return { ok: true, busy: true, seen: 0, imported: 0 };
  let states: Connector[] = [];
  const runs = new Map<string, { id: string; seen: number; imported: number }>();
  let totalSeen = 0, totalImported = 0;
  try {
    const configured = (await activeConnectors(env)).results;
    if (requestedCreatorId && !configured.some((state) => state.creator_id === requestedCreatorId)) throw new Error("This creator’s Telegram pairing has not been configured.");
    for (const state of configured) if (state.status !== "connected") await validateIdentity(env, state.creator_id).catch(() => undefined);
    states = (await activeConnectors(env)).results.filter((state) => state.status === "connected");
    if (requestedCreatorId && !states.some((state) => state.creator_id === requestedCreatorId)) throw new Error("This creator’s Telegram identity is not validated.");
    const stateByChat = new Map(states.map((state) => [state.chat_id, state]));
    for (const state of states) {
      const run = { id: crypto.randomUUID(), seen: 0, imported: 0 };
      runs.set(state.creator_id, run);
      await env.DB.prepare("INSERT INTO telegram_poll_runs (id,creator_id,status) VALUES (?,?,'running')").bind(run.id, state.creator_id).run();
    }
    let botState = await env.DB.prepare("SELECT next_update_id FROM telegram_bot_state WHERE id='shared'").first<{ next_update_id: number }>();
    if (!botState) throw new Error("Telegram shared cursor is unavailable.");
    for (let page = 0; page < 5; page++) {
      const response: { ok?: boolean; result?: TelegramUpdate[] } = await executeTelegramTool<{ ok?: boolean; result?: TelegramUpdate[] }>(env, "TELEGRAM_GET_UPDATES", { offset: botState.next_update_id, limit: 100, timeout: 0, allowed_updates: ["message", "edited_message"] });
      if (!response.ok) throw new Error("Telegram did not confirm getUpdates.");
      const updates: TelegramUpdate[] = response.result ?? [];
      if (!updates.length) break;
      for (const update of updates) {
        const updateId: number | undefined = update.update_id;
        if (updateId == null) continue;
        totalSeen++;
        const message = update.message ?? update.edited_message;
        const state = message?.chat?.id ? stateByChat.get(String(message.chat.id)) : undefined;
        if (state) {
          const result = await importUpdate(env, state, update);
          const run = runs.get(state.creator_id);
          if (run) { run.seen++; if (result.imported) run.imported++; }
          if (result.imported) totalImported++;
        }
        const nextOffset: number = updateId + 1;
        await env.DB.prepare("UPDATE telegram_bot_state SET next_update_id=?,last_polled_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id='shared' AND next_update_id<?").bind(nextOffset, nextOffset).run();
        botState = { next_update_id: Math.max(botState.next_update_id, nextOffset) };
      }
      if (updates.length < 100) break;
    }
    for (const state of states) {
      const run = runs.get(state.creator_id)!;
      await env.DB.batch([
        env.DB.prepare("UPDATE telegram_connector_state SET last_polled_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(state.creator_id),
        env.DB.prepare("UPDATE messaging_connections SET read_enabled=1,last_synced_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(state.connection_id, state.creator_id),
        env.DB.prepare("UPDATE telegram_poll_runs SET status='completed',updates_seen=?,messages_imported=?,completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(run.seen, run.imported, run.id),
      ]);
    }
    const requested = requestedCreatorId ? runs.get(requestedCreatorId) : undefined;
    console.log(JSON.stringify({ event: "telegram_poll_completed", trigger, seen: totalSeen, imported: totalImported }));
    return { ok: true, runId: requested?.id, seen: requested?.seen ?? totalSeen, imported: requested?.imported ?? totalImported };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram polling failed.";
    for (const state of states) {
      const run = runs.get(state.creator_id)!;
      await env.DB.batch([
        env.DB.prepare("UPDATE telegram_poll_runs SET status='failed',updates_seen=?,messages_imported=?,error=?,completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(run.seen, run.imported, message.slice(0, 1000), run.id),
        env.DB.prepare("UPDATE telegram_connector_state SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?").bind(message.slice(0, 1000), state.creator_id),
      ]);
    }
    await env.DB.prepare("UPDATE telegram_bot_state SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id='shared'").bind(message.slice(0, 1000)).run();
    console.error(JSON.stringify({ event: "telegram_poll_failed", trigger, message }));
    throw error;
  } finally {
    await env.DB.prepare("UPDATE telegram_bot_state SET claimed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id='shared'").run();
  }
}

async function beginTelegramSend(env: Env, creatorId: string, logId: string) {
  const operationId = `message-send:telegram:${logId}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO operation_outbox
      (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(idempotency_key) DO UPDATE SET status=CASE WHEN operation_outbox.status='delivered' THEN 'delivered' ELSE 'pending' END,
        attempts=operation_outbox.attempts+1,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(operationId, creatorId, "message_send", operationId, JSON.stringify({ logId, platform: "telegram" })),
    env.DB.prepare(`INSERT INTO external_operation_receipts
      (id,creator_id,operation_id,provider,status,verification_detail,created_at,updated_at)
      VALUES (?,?,?,'telegram','pending','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(operation_id,provider) DO UPDATE SET status=CASE WHEN external_operation_receipts.status='confirmed' THEN 'confirmed' ELSE 'pending' END,
        verification_detail='{}',updated_at=CURRENT_TIMESTAMP`)
      .bind(`external-receipt:telegram:${logId}`, creatorId, operationId),
  ]);
  return operationId;
}

async function sendMessage(request: Request, env: Env) {
  const input = await request.json<{ logId?: string; creatorId?: string }>();
  if (!input.logId || !input.creatorId) return Response.json({ ok: false, error: "missing_log_or_creator_id" }, { status: 400 });
  const creatorId = input.creatorId;
  const row = await env.DB.prepare(`SELECT l.id,l.message_text,l.status,l.claimed_at,c.id AS connection_id,c.write_enabled,c.outbound_validated,c.emergency_paused,c.status AS connection_status,s.chat_id
    FROM telegram_send_log l JOIN messaging_connections c ON c.id=l.connection_id AND c.creator_id=l.creator_id
    JOIN telegram_connector_state s ON s.creator_id=l.creator_id AND s.connection_id=c.id
    WHERE l.id=? AND l.creator_id=?`).bind(input.logId, creatorId).first<{ id: string; message_text: string; status: string; claimed_at: string | null; connection_id: string; write_enabled: number; outbound_validated: number; emergency_paused: number; connection_status: string; chat_id: string }>();
  if (!row || row.status !== "queued" || row.claimed_at) return Response.json({ ok: false, error: "message_not_sendable" }, { status: 409 });
  if (row.emergency_paused || !row.write_enabled || !row.outbound_validated || row.connection_status !== "connected") return Response.json({ ok: false, error: "outbound_not_authorised" }, { status: 409 });
  const claim = await env.DB.prepare("UPDATE telegram_send_log SET claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='queued' AND claimed_at IS NULL").bind(row.id, creatorId).run();
  if (!claim.meta.changes) return Response.json({ ok: false, error: "message_already_claimed" }, { status: 409 });
  const operationId = `message-send:telegram:${row.id}`;
  let providerMessageId: string | null = null;
  try {
    await beginTelegramSend(env, creatorId, row.id);
    const result = await executeTelegramTool<{ ok?: boolean; result?: { message_id?: number; date?: number } }>(env, "TELEGRAM_SEND_MESSAGE", { chat_id: row.chat_id, text: row.message_text, disable_web_page_preview: true });
    if (!result.ok || !result.result?.message_id) throw new Error("Telegram did not confirm the message.");
    const providerId = String(result.result.message_id);
    providerMessageId = providerId;
    const sentAt = result.result.date ? new Date(result.result.date * 1000).toISOString() : new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE telegram_send_log SET status='sent',provider_message_id=?,completed_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(providerId, row.id, creatorId),
      env.DB.prepare(`INSERT INTO message_threads (id,creator_id,connection_id,external_thread_id,participant_name,subject,unread_count,last_message_at,status)
        VALUES (?,?,?,?,?,'Agency ↔ creator',0,?,'open') ON CONFLICT(id) DO UPDATE SET last_message_at=excluded.last_message_at,updated_at=CURRENT_TIMESTAMP`).bind(threadId(creatorId), creatorId, row.connection_id, `${creatorId}-telegram-private`, "Creator", sentAt),
      env.DB.prepare(`INSERT OR IGNORE INTO messages (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
        VALUES (?,?,?,?, 'outbound','agency',?,?,'sent')`).bind(`telegram-out-${creatorId}-${providerId}`, creatorId, threadId(creatorId), providerId, row.message_text, sentAt),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?, 'telegram_message_sent','service:telegram-bridge','service',?)").bind(crypto.randomUUID(), creatorId, row.connection_id, threadId(creatorId), JSON.stringify({ logId: row.id, providerMessageId: providerId })),
      env.DB.prepare("UPDATE external_operation_receipts SET status='confirmed',provider_operation_id=?,verification_detail=?,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE operation_id=? AND creator_id=? AND provider='telegram'")
        .bind(providerId, JSON.stringify({ logId: row.id, providerMessageId: providerId }), operationId, creatorId),
      env.DB.prepare("UPDATE operation_outbox SET status='delivered',delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
        .bind(operationId, creatorId),
    ]);
    return Response.json({ ok: true, logId: row.id, providerMessageId: providerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram delivery failed.";
    const uncertain = providerMessageId !== null;
    const safeMessage = `${uncertain ? "Outcome uncertain; verify Telegram before retrying. " : ""}${message}`.slice(0, 1000);
    await env.DB.batch([
      env.DB.prepare("UPDATE telegram_send_log SET status='failed',error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(safeMessage, row.id, creatorId),
      env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,?,?,'service:telegram-bridge','service',?)").bind(crypto.randomUUID(), creatorId, row.connection_id, uncertain ? "telegram_message_uncertain" : "telegram_message_failed", JSON.stringify({ logId: row.id, error: safeMessage, uncertain })),
      env.DB.prepare(`UPDATE external_operation_receipts SET status=CASE WHEN status='confirmed' THEN 'confirmed' ELSE ? END,
        provider_operation_id=COALESCE(provider_operation_id,?),verification_detail=?,updated_at=CURRENT_TIMESTAMP
        WHERE operation_id=? AND creator_id=? AND provider='telegram'`)
        .bind(uncertain ? "uncertain" : "failed", providerMessageId, JSON.stringify({ logId: row.id, error: safeMessage, uncertain }), operationId, creatorId),
      env.DB.prepare("UPDATE operation_outbox SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status<>'delivered'")
        .bind(safeMessage, operationId, creatorId),
    ]);
    return Response.json({ ok: false, uncertain, error: safeMessage }, { status: 502 });
  }
}

async function status(env: Env, creatorId: string) {
  const [state, lastRun] = await Promise.all([
    env.DB.prepare("SELECT status,telegram_username,display_name,identity_confirmed_at,last_polled_at,last_error,updated_at FROM telegram_connector_state WHERE creator_id=?").bind(creatorId).first(),
    env.DB.prepare("SELECT status,updates_seen,messages_imported,error,started_at,completed_at FROM telegram_poll_runs WHERE creator_id=? ORDER BY started_at DESC LIMIT 1").bind(creatorId).first(),
  ]);
  return Response.json({ ok: true, state, lastRun });
}

function requiredCreatorId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw new Error("A valid creatorId is required.");
  return value;
}

async function creatorIdFromBody(request: Request) {
  return requiredCreatorId((await request.json<{ creatorId?: string }>()).creatorId);
}

const routeCapabilities: Record<string, string> = {
  "POST /validate": "telegram.connection.manage",
  "POST /run": "telegram.messages.sync",
  "POST /send": "telegram.messages.write",
  "GET /status": "telegram.status.read",
};

async function authenticatedCreatorId(request: Request, env: Env, url: URL, capability: string) {
  const candidate = request.method === "GET"
    ? url.searchParams.get("creator")
    : (await request.clone().json<{ creatorId?: unknown }>()).creatorId;
  const creatorId = requiredCreatorId(candidate);
  const service = await requireInternalServiceForCreator(request, env.DB, creatorId, "thot-os-web-telegram", capability);
  await internalServiceAuditStatement(env.DB, service, url.pathname).run();
  return creatorId;
}

async function pollAllCreators(env: Env) {
  await pollSharedUpdates(env, "cron");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const capability = routeCapabilities[`${request.method} ${url.pathname}`];
      if (!capability) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      let creatorId: string;
      try {
        creatorId = await authenticatedCreatorId(request, env, url, capability);
      } catch {
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      if (request.method === "POST" && url.pathname === "/validate") return Response.json(await validateIdentity(env, creatorId));
      if (request.method === "POST" && url.pathname === "/run") return Response.json(await pollSharedUpdates(env, "service", creatorId));
      if (request.method === "POST" && url.pathname === "/send") return sendMessage(request, env);
      if (request.method === "GET" && url.pathname === "/status") return status(env, creatorId);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram bridge failed.";
      console.error(JSON.stringify({ event: "telegram_bridge_request_failed", path: url.pathname, message }));
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pollAllCreators(env));
  },
} satisfies ExportedHandler<Env>;
