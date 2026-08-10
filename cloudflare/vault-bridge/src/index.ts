type BridgeIdentity = { creator_id: string; account_id: string; platform: "fansly" };
type RedditBridgeIdentity = { creator_id: string; account_id: string };
type VaultJob = { id: string; basename: string; bytes: number; asset_id: string };
type BrowserMessage = { externalMessageId?: string; direction?: string; senderType?: string; body?: string; sentAt?: string };
type BrowserThread = { externalThreadId?: string; participantName?: string; participantHandle?: string; unreadCount?: number; observedOpen?: boolean; messages?: BrowserMessage[] };
type RedditNativeJob = {
  id: string; basename: string; bytes: number; extension: string; asset_id: string;
  title: string; caption: string; content_rating: "sfw" | "nsfw"; community_name: string;
  expected_handle: string;
};

const DROPBOX_USER_ID = "creator-os:adelaide:service:dropbox";
const COMPOSIO_V31 = "https://backend.composio.dev/api/v3.1";
const REDDIT_USER_ID = "creator-os:adelaide:service:reddit";
const allowedOrigins = new Set(["https://fansly.com", "https://www.reddit.com", "https://reddit.com", "https://thot-os-staging.thot-os.workers.dev"]);

function cors(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": allowedOrigins.has(origin) ? origin : "https://fansly.com",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-thot-os-vault-client,x-thot-os-reddit-client",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors(request) });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 40) return null;
  const identity = await env.DB.prepare(`
    SELECT creator_id,account_id,platform FROM vault_bridge_tokens
    WHERE token_hash=? AND status='active' AND expires_at>CURRENT_TIMESTAMP
  `).bind(await sha256(token)).first<BridgeIdentity>();
  if (identity) await env.DB.prepare("UPDATE vault_bridge_tokens SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<datetime('now','-5 minutes'))").bind(await sha256(token)).run();
  return identity;
}

async function authenticateReddit(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 40) return null;
  const tokenHash = await sha256(token);
  const identity = await env.DB.prepare(`
    SELECT creator_id,account_id FROM reddit_bridge_tokens
    WHERE token_hash=? AND status='active' AND expires_at>CURRENT_TIMESTAMP
  `).bind(tokenHash).first<RedditBridgeIdentity>();
  if (identity) await env.DB.prepare("UPDATE reddit_bridge_tokens SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash).run();
  return identity;
}

async function executeDropbox<T>(env: Env, slug: string, args: Record<string, unknown>) {
  const response = await fetch(`${COMPOSIO_V31}/tools/execute/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.COMPOSIO_API_KEY },
    body: JSON.stringify({ connected_account_id: env.COMPOSIO_DROPBOX_CONNECTED_ACCOUNT_ID, user_id: DROPBOX_USER_ID, version: "latest", arguments: args }),
  });
  const payload = await response.json().catch(() => ({})) as { successful?: boolean; data?: T; error?: string | { message?: string } };
  if (!response.ok || payload.successful === false || payload.data === undefined) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || `Dropbox request failed (${response.status}).`);
  }
  return payload.data;
}

async function executeReddit<T>(env: Env, connectedAccountId: string, slug: string, args: Record<string, unknown>) {
  const response = await fetch(`${COMPOSIO_V31}/tools/execute/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.COMPOSIO_API_KEY },
    body: JSON.stringify({ connected_account_id: connectedAccountId, user_id: REDDIT_USER_ID, version: "latest", arguments: args }),
  });
  const payload = await response.json().catch(() => ({})) as { successful?: boolean; data?: T; error?: string | { message?: string } };
  if (!response.ok || payload.successful === false || payload.data === undefined) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || `${slug} failed (${response.status}).`);
  }
  return payload.data;
}

function dropboxPath(root: string, relative: string) {
  return `/${[root, relative].map((part) => part.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
}

async function claimJob(request: Request, env: Env, identity: BridgeIdentity) {
  if (request.headers.get("x-thot-os-vault-client") !== "explicit-v4") return json(request, { ok: false, error: "Update the THOT OS bridge extension before uploading." }, 428);
  const candidate = await env.DB.prepare(`
    SELECT j.id,a.basename,a.bytes,j.asset_id
    FROM vault_upload_jobs j JOIN assets a ON a.id=j.asset_id AND a.creator_id=j.creator_id
    WHERE j.creator_id=? AND j.account_id=? AND j.platform='fansly'
      AND (j.status='approved' OR (j.status='claimed' AND j.claimed_at<datetime('now','-2 minutes')))
    ORDER BY j.created_at LIMIT 1
  `).bind(identity.creator_id, identity.account_id).first<VaultJob>();
  if (!candidate) return json(request, { ok: true, job: null });
  const claimed = await env.DB.prepare(`
    UPDATE vault_upload_jobs SET status='claimed',claimed_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND account_id=? AND (status='approved' OR (status='claimed' AND claimed_at<datetime('now','-2 minutes')))
  `).bind(candidate.id, identity.creator_id, identity.account_id).run();
  if (!claimed.meta.changes) return json(request, { ok: true, job: null });
  await env.DB.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,event_type,detail) VALUES (?,?,?,'fansly-device','job_claimed','{}')").bind(crypto.randomUUID(), candidate.id, identity.creator_id).run();
  return json(request, { ok: true, job: { ...candidate, mediaUrl: `${new URL(request.url).origin}/jobs/${candidate.id}/media` } });
}

async function mediaRedirect(request: Request, env: Env, identity: BridgeIdentity, jobId: string) {
  const job = await env.DB.prepare(`
    SELECT a.relative_path,c.dropbox_root
    FROM vault_upload_jobs j
    JOIN assets a ON a.id=j.asset_id AND a.creator_id=j.creator_id
    JOIN creators c ON c.id=j.creator_id
    WHERE j.id=? AND j.creator_id=? AND j.account_id=? AND j.platform='fansly' AND j.status IN ('claimed','staged')
  `).bind(jobId, identity.creator_id, identity.account_id).first<{ relative_path: string; dropbox_root: string }>();
  if (!job) return json(request, { ok: false, error: "Vault media is not available for this device." }, 404);
  const temporary = await executeDropbox<{ link?: string }>(env, "DROPBOX_GET_TEMPORARY_LINK", { path: dropboxPath(job.dropbox_root, job.relative_path) });
  if (!temporary.link) return json(request, { ok: false, error: "Dropbox did not return the approved file." }, 502);
  return new Response(null, { status: 302, headers: { location: temporary.link, "cache-control": "no-store", ...cors(request) } });
}

async function recordReceipt(request: Request, env: Env, identity: BridgeIdentity, jobId: string) {
  const input = await request.json<{ status?: string; error?: string; receipt?: unknown }>();
  const status = input.status === "staged" ? "staged" : "failed";
  const receipt = JSON.stringify(input.receipt ?? {}).slice(0, 12000);
  const error = status === "failed" ? String(input.error || "Fansly staging failed.").slice(0, 2000) : null;
  const updated = await env.DB.prepare(`
    UPDATE vault_upload_jobs SET status=?,completed_at=CURRENT_TIMESTAMP,error=?,receipt=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND account_id=? AND platform='fansly' AND status='claimed'
  `).bind(status, error, receipt, jobId, identity.creator_id, identity.account_id).run();
  if (!updated.meta.changes) return json(request, { ok: false, error: "Vault job is no longer claimable." }, 409);
  await env.DB.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,event_type,detail) VALUES (?,?,?,'fansly-device',?,?)")
    .bind(crypto.randomUUID(), jobId, identity.creator_id, status === "staged" ? "file_staged" : "staging_failed", JSON.stringify({ error })).run();
  return json(request, { ok: true, status });
}

function canonicalFanslyThread(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value, "https://fansly.com");
    const path = parsed.pathname.replace(/\/+$/, "");
    return parsed.hostname === "fansly.com" && /^\/messages\/[^/]+$/.test(path) ? path : null;
  } catch { return null; }
}

async function ingestFanslyMessages(request: Request, env: Env, identity: BridgeIdentity) {
  const input = await request.json<{ platform?: string; threads?: BrowserThread[] }>();
  if (identity.creator_id !== "adelaide" || identity.account_id !== "adelaide-fansly-main" || identity.platform !== "fansly" || input.platform !== "fansly" || !Array.isArray(input.threads)) return json(request, { ok: false, error: "invalid_fansly_snapshot" }, 400);
  const threads = input.threads.slice(0, 100);
  let importedThreads = 0, importedMessages = 0, changedThreads = 0;
  for (const snapshot of threads) {
    const externalThreadId = canonicalFanslyThread(snapshot.externalThreadId);
    if (!externalThreadId) continue;
    const threadId = `fansly-${(await sha256(externalThreadId)).slice(0, 40)}`;
    const participantName = String(snapshot.participantName ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "Fansly conversation";
    const participantHandle = String(snapshot.participantHandle ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const unreadCount = Number(snapshot.unreadCount) > 0 ? 1 : 0;
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages.slice(-200) : [];
    const bodyOccurrences = new Map<string, number>();
    for (const item of messages) {
      const body = String(item.body ?? "").trim().slice(0, 20_000);
      if (body) bodyOccurrences.set(body, (bodyOccurrences.get(body) ?? 0) + 1);
    }
    const threadMutation = await env.DB.prepare(`INSERT INTO message_threads
      (id,creator_id,connection_id,external_thread_id,participant_name,participant_handle,subject,unread_count,last_message_at,status)
      VALUES (?,'adelaide','adelaide-messages-fansly',?,?,?,'Fansly conversation',?,NULL,'open')
      ON CONFLICT(id) DO UPDATE SET participant_name=CASE WHEN excluded.participant_name<>'Fansly conversation' THEN excluded.participant_name ELSE message_threads.participant_name END,
        participant_handle=CASE WHEN excluded.participant_handle<>'' THEN excluded.participant_handle ELSE message_threads.participant_handle END,
        unread_count=excluded.unread_count,updated_at=CURRENT_TIMESTAMP
      WHERE (excluded.participant_name<>'Fansly conversation' AND excluded.participant_name<>message_threads.participant_name)
        OR (excluded.participant_handle<>'' AND excluded.participant_handle<>message_threads.participant_handle)
        OR excluded.unread_count<>message_threads.unread_count`)
      .bind(threadId, externalThreadId, participantName, participantHandle, unreadCount).run();
    changedThreads += Number(threadMutation.meta.changes ?? 0);
    let threadMessageChanges = 0;
    for (const [index, item] of messages.entries()) {
      const body = String(item.body ?? "").trim().slice(0, 20_000);
      if (!body) continue;
      const direction = item.direction === "outbound" ? "outbound" : "inbound";
      const externalMessageId = String(item.externalMessageId ?? `${externalThreadId}:${direction}:${index}:${body}`).slice(0, 500);
      const senderType = direction === "outbound" ? "creator" : String(item.senderType ?? "fan").slice(0, 50);
      const inboundSyntheticPrefix = `${externalThreadId}-inbound-`;
      if (direction === "inbound" && bodyOccurrences.get(body) === 1 && externalMessageId.startsWith(inboundSyntheticPrefix)) {
        const previousOutboundId = externalMessageId.replace(inboundSyntheticPrefix, `${externalThreadId}-outbound-`);
        const repaired = await env.DB.prepare(`UPDATE messages SET external_message_id=?,direction='inbound',sender_type=?,body=?,sent_at=COALESCE(?,sent_at)
          WHERE creator_id='adelaide' AND thread_id=? AND external_message_id=? AND direction='outbound' AND delivery_status='observed'
            AND NOT EXISTS (SELECT 1 FROM messages existing WHERE existing.thread_id=? AND existing.external_message_id=?)`)
          .bind(externalMessageId, senderType, body, item.sentAt ?? null, threadId, previousOutboundId, threadId, externalMessageId).run();
        if (repaired.meta.changes) {
          const changes = Number(repaired.meta.changes);
          importedMessages += changes;
          threadMessageChanges += changes;
          continue;
        }
      }
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO messages
        (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
        VALUES (?,'adelaide',?,?,?,?,?,?,'observed')`)
        .bind(`fansly-message-${(await sha256(`${externalThreadId}:${externalMessageId}`)).slice(0, 40)}`, threadId, externalMessageId, direction, senderType, body, item.sentAt ?? null).run();
      const changes = Number(inserted.meta.changes ?? 0);
      importedMessages += changes;
      threadMessageChanges += changes;
    }
    if (threadMessageChanges > 0) await env.DB.prepare("UPDATE message_threads SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id='adelaide'").bind(threadId).run();
    const completed = Boolean(snapshot.observedOpen);
    const insertedState = await env.DB.prepare(`INSERT OR IGNORE INTO premium_thread_sync_state
      (thread_id,creator_id,status,attempts,last_completed_at,last_error,updated_at)
      VALUES (?,'adelaide',?,0,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,NULL,CURRENT_TIMESTAMP)`)
      .bind(threadId, completed ? "complete" : "pending", completed ? 1 : 0).run();
    if (!insertedState.meta.changes && completed) await env.DB.prepare(`UPDATE premium_thread_sync_state
      SET status='complete',attempts=0,last_completed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE thread_id=? AND creator_id='adelaide' AND (status<>'complete' OR last_completed_at IS NULL OR last_completed_at<datetime('now','-5 minutes'))`).bind(threadId).run();
    if (!insertedState.meta.changes && !completed) await env.DB.prepare(`UPDATE premium_thread_sync_state
      SET status='pending',updated_at=CURRENT_TIMESTAMP
      WHERE thread_id=? AND creator_id='adelaide' AND status='complete' AND last_completed_at<datetime('now','-10 minutes')`).bind(threadId).run();
    importedThreads++;
  }
  if (importedThreads > 0) await env.DB.prepare(`UPDATE messaging_connections
    SET status='connected',read_enabled=1,outbound_validated=1,last_synced_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id='adelaide-messages-fansly' AND creator_id='adelaide' AND (status<>'connected' OR read_enabled<>1 OR outbound_validated<>1 OR last_error IS NOT NULL OR last_synced_at IS NULL OR last_synced_at<datetime('now','-5 minutes'))`).run();
  if (importedMessages > 0 || changedThreads > 0) await env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,detail) VALUES (?,'adelaide','adelaide-messages-fansly','fansly_messages_synced','fansly-device',?)")
    .bind(crypto.randomUUID(), JSON.stringify({ importedThreads, importedMessages, changedThreads })).run();
  return json(request, { ok: true, importedThreads, importedMessages, changedThreads });
}

async function pendingFanslyThread(request: Request, env: Env, identity: BridgeIdentity) {
  if (request.method === "POST") {
    const input = await request.json<{ threadId?: string; error?: string }>();
    const threadId = String(input.threadId ?? "");
    await env.DB.prepare(`UPDATE premium_thread_sync_state SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP
      WHERE thread_id=? AND creator_id=? AND thread_id IN (SELECT id FROM message_threads WHERE creator_id=? AND connection_id='adelaide-messages-fansly')`)
      .bind(String(input.error ?? "Fansly conversation collection failed.").slice(0, 1000), threadId, identity.creator_id, identity.creator_id).run();
    return json(request, { ok: true });
  }
  const pending = await env.DB.prepare(`SELECT s.thread_id AS id,t.external_thread_id FROM premium_thread_sync_state s
    JOIN message_threads t ON t.id=s.thread_id AND t.creator_id=s.creator_id
    WHERE s.creator_id=? AND t.connection_id='adelaide-messages-fansly' AND s.status IN ('pending','failed') AND s.attempts<3
      AND (s.last_requested_at IS NULL OR s.last_requested_at<datetime('now','-55 seconds')) ORDER BY s.updated_at LIMIT 1`)
    .bind(identity.creator_id).first<{ id: string; external_thread_id: string }>();
  if (!pending) return json(request, { ok: true, thread: null });
  const claimed = await env.DB.prepare("UPDATE premium_thread_sync_state SET status='claimed',attempts=attempts+1,last_requested_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE thread_id=? AND creator_id=? AND status IN ('pending','failed')")
    .bind(pending.id, identity.creator_id).run();
  return json(request, { ok: true, thread: claimed.meta.changes ? pending : null });
}

async function nextFanslyOutbox(request: Request, env: Env, identity: BridgeIdentity) {
  const job = await env.DB.prepare(`SELECT d.id,t.external_thread_id FROM premium_message_drafts d
    JOIN message_threads t ON t.id=d.thread_id AND t.creator_id=d.creator_id
    JOIN messaging_connections c ON c.id=d.connection_id AND c.creator_id=d.creator_id
    WHERE d.creator_id=? AND c.account_id=? AND d.platform='fansly' AND d.status='approved'
      AND c.status='connected' AND c.write_enabled=1 AND c.outbound_validated=1 AND c.emergency_paused=0
    ORDER BY d.created_at LIMIT 1`)
    .bind(identity.creator_id, identity.account_id).first<{ id: string; external_thread_id: string }>();
  return json(request, { ok: true, job: job ? { id: job.id, externalThreadId: job.external_thread_id } : null });
}

async function fanslyOutbox(request: Request, env: Env, identity: BridgeIdentity) {
  if (request.method === "GET") {
    const externalThreadId = canonicalFanslyThread(new URL(request.url).searchParams.get("thread"));
    if (!externalThreadId) return json(request, { ok: true, job: null });
    const job = await env.DB.prepare(`SELECT d.id,d.body,t.external_thread_id FROM premium_message_drafts d
      JOIN message_threads t ON t.id=d.thread_id AND t.creator_id=d.creator_id
      JOIN messaging_connections c ON c.id=d.connection_id AND c.creator_id=d.creator_id
      WHERE d.creator_id=? AND c.account_id=? AND d.platform='fansly' AND d.status='approved' AND t.external_thread_id=?
        AND c.status='connected' AND c.write_enabled=1 AND c.outbound_validated=1 AND c.emergency_paused=0 ORDER BY d.created_at LIMIT 1`)
      .bind(identity.creator_id, identity.account_id, externalThreadId).first<{ id: string; body: string; external_thread_id: string }>();
    if (!job) return json(request, { ok: true, job: null });
    const claimed = await env.DB.prepare("UPDATE premium_message_drafts SET status='claimed',claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='approved'")
      .bind(job.id, identity.creator_id).run();
    return json(request, { ok: true, job: claimed.meta.changes ? job : null });
  }
  const input = await request.json<{ jobId?: string; sent?: boolean; error?: string; receipt?: unknown }>();
  const job = await env.DB.prepare(`SELECT d.id,d.thread_id,d.connection_id,d.body FROM premium_message_drafts d
    JOIN messaging_connections c ON c.id=d.connection_id AND c.creator_id=d.creator_id
    WHERE d.id=? AND d.creator_id=? AND c.account_id=? AND d.platform='fansly' AND d.status='claimed'`)
    .bind(String(input.jobId ?? ""), identity.creator_id, identity.account_id).first<{ id: string; thread_id: string; connection_id: string; body: string }>();
  if (!job) return json(request, { ok: false, error: "outbox_job_not_claimed" }, 409);
  const sent = input.sent === true;
  const error = sent ? null : String(input.error ?? "Fansly device send failed.").slice(0, 1000);
  const statements = [
    env.DB.prepare("UPDATE premium_message_drafts SET status=?,completed_at=CURRENT_TIMESTAMP,error=?,receipt=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
      .bind(sent ? "sent" : "failed", error, JSON.stringify(input.receipt ?? {}).slice(0, 12_000), job.id, identity.creator_id),
    env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,detail) VALUES (?,?,?,?,?,'fansly-device',?)")
      .bind(crypto.randomUUID(), identity.creator_id, job.connection_id, job.thread_id, sent ? "fansly_device_send_submitted" : "fansly_device_send_failed", JSON.stringify({ draftId: job.id, error })),
  ];
  if (sent) statements.push(
    env.DB.prepare(`INSERT OR IGNORE INTO messages (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
      VALUES (?,'adelaide',?,?,'outbound','agency',?,CURRENT_TIMESTAMP,'device_submitted')`).bind(`fansly-out-${job.id}`, job.thread_id, `device-${job.id}`, job.body),
    env.DB.prepare("UPDATE message_threads SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(job.thread_id, identity.creator_id),
  );
  await env.DB.batch(statements);
  return json(request, { ok: true, status: sent ? "sent" : "failed" });
}

function normaliseHandle(value: string) {
  return value.trim().replace(/^u\//i, "").replace(/^@/, "").toLowerCase();
}

async function claimRedditJob(request: Request, env: Env, identity: RedditBridgeIdentity) {
  if (request.headers.get("x-thot-os-reddit-client") !== "native-v1") return json(request, { ok: false, error: "Update the THOT OS bridge extension before posting." }, 428);
  const candidate = await env.DB.prepare(`
    SELECT p.id,p.asset_id,p.title,p.caption,p.content_rating,rc.name AS community_name,
      a.basename,a.bytes,a.extension,oa.handle AS expected_handle
    FROM social_posts p
    JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
    JOIN reddit_communities rc ON rc.id=p.community_id AND rc.creator_id=p.creator_id
    JOIN operational_accounts oa ON oa.id=p.account_id AND oa.creator_id=p.creator_id
    WHERE p.creator_id=? AND p.account_id=? AND p.platform='reddit' AND p.status='publishing'
      AND (p.device_claimed_at IS NULL OR p.device_claimed_at<datetime('now','-10 minutes'))
    ORDER BY COALESCE(p.scheduled_at,p.created_at) LIMIT 1
  `).bind(identity.creator_id, identity.account_id).first<RedditNativeJob>();
  if (!candidate) return json(request, { ok: true, job: null });
  const claimed = await env.DB.prepare(`
    UPDATE social_posts SET device_claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND account_id=? AND status='publishing'
      AND (device_claimed_at IS NULL OR device_claimed_at<datetime('now','-10 minutes'))
  `).bind(candidate.id, identity.creator_id, identity.account_id).run();
  if (!claimed.meta.changes) return json(request, { ok: true, job: null });
  await env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,?,'reddit-device','native_job_claimed','{}')")
    .bind(crypto.randomUUID(), candidate.id, identity.creator_id).run();
  return json(request, { ok: true, job: { ...candidate, mediaUrl: `${new URL(request.url).origin}/reddit/jobs/${encodeURIComponent(candidate.id)}/media` } });
}

async function redditMediaRedirect(request: Request, env: Env, identity: RedditBridgeIdentity, postId: string) {
  const media = await env.DB.prepare(`
    SELECT a.relative_path,c.dropbox_root
    FROM social_posts p JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id JOIN creators c ON c.id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.account_id=? AND p.platform='reddit' AND p.status='publishing' AND p.device_claimed_at IS NOT NULL
  `).bind(postId, identity.creator_id, identity.account_id).first<{ relative_path: string; dropbox_root: string }>();
  if (!media) return json(request, { ok: false, error: "Reddit media is not available for this paired device." }, 404);
  const temporary = await executeDropbox<{ link?: string }>(env, "DROPBOX_GET_TEMPORARY_LINK", { path: dropboxPath(media.dropbox_root, media.relative_path) });
  if (!temporary.link) return json(request, { ok: false, error: "Dropbox did not return the approved file." }, 502);
  return new Response(null, { status: 302, headers: { location: temporary.link, "cache-control": "no-store", ...cors(request) } });
}

async function recordRedditReceipt(request: Request, env: Env, identity: RedditBridgeIdentity, postId: string) {
  const input = await request.json<{ status?: string; error?: string; externalUrl?: string; externalPostId?: string; observedHandle?: string; uncertain?: boolean; receipt?: unknown }>();
  const post = await env.DB.prepare(`
    SELECT p.id,p.caption,p.title,p.status,oa.handle AS expected_handle,pc.connected_account_id
    FROM social_posts p JOIN operational_accounts oa ON oa.id=p.account_id AND oa.creator_id=p.creator_id
    LEFT JOIN provider_connections pc ON pc.creator_id=p.creator_id AND pc.service='reddit' AND pc.status='active'
    WHERE p.id=? AND p.creator_id=? AND p.account_id=? AND p.platform='reddit'
  `).bind(postId, identity.creator_id, identity.account_id).first<{ id: string; caption: string; title: string; status: string; expected_handle: string; connected_account_id: string | null }>();
  if (!post || post.status !== "publishing") return json(request, { ok: false, error: "Reddit job is no longer awaiting a device receipt." }, 409);
  if (normaliseHandle(input.observedHandle ?? "") !== normaliseHandle(post.expected_handle)) return json(request, { ok: false, error: "The signed-in Reddit browser does not match Adelaide’s configured account." }, 409);
  const receipt = JSON.stringify(input.receipt ?? {}).slice(0, 12000);
  const receiptRecord = input.receipt && typeof input.receipt === "object" && !Array.isArray(input.receipt) ? input.receipt as Record<string, unknown> : {};
  if (input.status !== "published") {
    const prefix = input.uncertain ? "Outcome uncertain; verify Reddit before retrying. " : "";
    const error = `${prefix}${String(input.error || "Native Reddit publishing failed.")}`.slice(0, 2000);
    await env.DB.batch([
      env.DB.prepare("UPDATE social_posts SET status='failed',error=?,device_receipt=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND account_id=? AND status='publishing'").bind(error, receipt, postId, identity.creator_id, identity.account_id),
      env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,?,'reddit-device','native_publish_failed',?)").bind(crypto.randomUUID(), postId, identity.creator_id, JSON.stringify({ error, uncertain: Boolean(input.uncertain) })),
    ]);
    return json(request, { ok: true, status: "failed" });
  }
  let externalUrl: URL;
  try { externalUrl = new URL(String(input.externalUrl ?? "")); }
  catch { return json(request, { ok: false, error: "Reddit did not return a valid post URL." }, 400); }
  const postMatch = externalUrl.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i);
  if (!/(^|\.)reddit\.com$/i.test(externalUrl.hostname) || !postMatch) return json(request, { ok: false, error: "The native receipt is not a Reddit post URL." }, 400);
  const externalPostId = String(input.externalPostId || `t3_${postMatch[1]}`);
  let warning = "";
  if (post.caption.trim() && post.caption.trim() !== post.title.trim() && receiptRecord.bodyFilled !== true) {
    if (!post.connected_account_id) warning = "Post published, but the caption comment could not be added because Reddit OAuth is unavailable.";
    else {
      try { await executeReddit(env, post.connected_account_id, "REDDIT_POST_REDDIT_COMMENT", { thing_id: externalPostId, text: post.caption }); }
      catch (error) { warning = `Post published, but the caption comment failed: ${error instanceof Error ? error.message : "Unknown error"}`; }
    }
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE social_posts SET status='published',published_at=CURRENT_TIMESTAMP,external_post_id=?,external_url=?,error=?,device_receipt=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND account_id=? AND status='publishing'").bind(externalPostId, externalUrl.toString(), warning || null, receipt, postId, identity.creator_id, identity.account_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,?,'reddit-device','native_publish_completed',?)").bind(crypto.randomUUID(), postId, identity.creator_id, JSON.stringify({ externalPostId, externalUrl: externalUrl.toString(), warning })),
    env.DB.prepare("UPDATE operational_accounts SET connection_status='connected',publishing_mode='local_bridge',publishing_authority='device_only',last_success_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,warning_level='none',warning_message='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(identity.account_id, identity.creator_id),
  ]);
  return json(request, { ok: true, status: "published", externalPostId, externalUrl: externalUrl.toString(), warning });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    try {
      const url = new URL(request.url);
      if (url.pathname === "/reddit" || url.pathname.startsWith("/reddit/")) {
        const identity = await authenticateReddit(request, env);
        if (!identity) return json(request, { ok: false, error: "unauthorized" }, 401);
        if (request.method === "GET" && url.pathname === "/reddit/status") {
          const account = await env.DB.prepare("SELECT handle FROM operational_accounts WHERE id=? AND creator_id=? AND platform='reddit'").bind(identity.account_id, identity.creator_id).first<{ handle: string }>();
          return json(request, { ok: true, paired: true, platform: "reddit", expected_handle: account?.handle ?? "", ...identity });
        }
        if (request.method === "GET" && url.pathname === "/reddit/jobs/claim") return claimRedditJob(request, env, identity);
        const media = url.pathname.match(/^\/reddit\/jobs\/([^/]+)\/media$/);
        if (request.method === "GET" && media) return redditMediaRedirect(request, env, identity, decodeURIComponent(media[1]));
        const receipt = url.pathname.match(/^\/reddit\/jobs\/([^/]+)\/receipt$/);
        if (request.method === "POST" && receipt) return recordRedditReceipt(request, env, identity, decodeURIComponent(receipt[1]));
        return json(request, { ok: false, error: "not_found" }, 404);
      }
      const identity = await authenticate(request, env);
      if (!identity) return json(request, { ok: false, error: "unauthorized" }, 401);
      if (request.method === "GET" && url.pathname === "/status") return json(request, { ok: true, paired: true, ...identity });
      if (request.method === "POST" && url.pathname === "/messages/ingest") return ingestFanslyMessages(request, env, identity);
      if ((request.method === "GET" || request.method === "POST") && url.pathname === "/messages/pending-threads") return pendingFanslyThread(request, env, identity);
      if (request.method === "GET" && url.pathname === "/messages/outbox/next") return nextFanslyOutbox(request, env, identity);
      if ((request.method === "GET" || request.method === "POST") && url.pathname === "/messages/outbox") return fanslyOutbox(request, env, identity);
      if (request.method === "GET" && url.pathname === "/jobs/claim") return claimJob(request, env, identity);
      const media = url.pathname.match(/^\/jobs\/([^/]+)\/media$/);
      if (request.method === "GET" && media) return mediaRedirect(request, env, identity, decodeURIComponent(media[1]));
      const receipt = url.pathname.match(/^\/jobs\/([^/]+)\/receipt$/);
      if (request.method === "POST" && receipt) return recordReceipt(request, env, identity, decodeURIComponent(receipt[1]));
      return json(request, { ok: false, error: "not_found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Vault bridge failed.";
      console.error(JSON.stringify({ event: "vault_bridge_error", message }));
      return json(request, { ok: false, error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
