type UnknownRecord = Record<string, unknown>;
type DuePost = {
  id: string; creator_id: string; asset_id: string; title: string; caption: string;
  content_rating: "sfw" | "nsfw"; relative_path: string; dropbox_root: string;
  community_name: string; flair_required: number; allows_nsfw: number;
};

const COMPOSIO_V3 = "https://backend.composio.dev/api/v3";
const COMPOSIO_V31 = "https://backend.composio.dev/api/v3.1";
const CREATOR_ID = "adelaide";
const REDDIT_USER_ID = "creator-os:adelaide:service:reddit";

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

async function redditIdentity(env: Env, connectedAccountId: string) {
  const response = await jsonRequest<{ status: number; data?: { id?: string; name?: string } }>(
    `${COMPOSIO_V31}/tools/execute/proxy`, env.COMPOSIO_API_KEY,
    { method: "POST", body: JSON.stringify({ connected_account_id: connectedAccountId, endpoint: "/api/v1/me", method: "GET" }) },
  );
  if (response.status < 200 || response.status >= 300 || !response.data?.id || !response.data.name) {
    throw new Error("Reddit identity could not be verified.");
  }
  return response.data;
}

async function markFailed(env: Env, post: DuePost, message: string, uncertain = false) {
  const safeMessage = `${uncertain ? "Outcome uncertain; verify Reddit before retrying. " : ""}${message}`.slice(0, 2000);
  await env.DB.batch([
    env.DB.prepare("UPDATE social_posts SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(safeMessage, post.id, post.creator_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,?,'reddit-scheduler','publish_failed',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ error: safeMessage, uncertain })),
  ]);
}

async function publishPost(env: Env, post: DuePost) {
  const connection = await env.DB.prepare("SELECT connected_account_id,status FROM provider_connections WHERE creator_id=? AND service='reddit'").bind(post.creator_id).first<{ connected_account_id: string; status: string }>();
  if (!connection || connection.status !== "active") throw new Error("Reddit is not connected. Reconnect it in Operations.");
  if (post.flair_required) throw new Error(`r/${post.community_name} requires flair; choose flair before scheduling.`);
  if (post.content_rating === "nsfw" && !post.allows_nsfw) throw new Error(`r/${post.community_name} is not recorded as allowing NSFW posts.`);
  await env.DB.batch([
    env.DB.prepare("UPDATE social_posts SET error=NULL,device_claimed_at=NULL,device_receipt='{}',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='publishing'").bind(post.id, post.creator_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,event_type,detail) VALUES (?,?,?,'reddit-scheduler','native_delivery_queued',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ community: post.community_name, contentRating: post.content_rating })),
  ]);
  return { published: false, failed: false, queued: true };
}

async function loadPost(env: Env, postId: string) {
  return env.DB.prepare(`
    SELECT p.id,p.creator_id,p.asset_id,p.title,p.caption,p.content_rating,a.relative_path,c.dropbox_root,
      rc.name AS community_name,rc.flair_required,rc.allows_nsfw
    FROM social_posts p
    JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
    JOIN creators c ON c.id=p.creator_id
    JOIN reddit_communities rc ON rc.id=p.community_id AND rc.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.platform='reddit' AND p.status='scheduled' AND p.approved_at IS NOT NULL
  `).bind(postId, CREATOR_ID).first<DuePost>();
}

async function claimAndPublish(env: Env, post: DuePost) {
  const claim = await env.DB.prepare("UPDATE social_posts SET status='publishing',claimed_at=CURRENT_TIMESTAMP,last_attempt_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='scheduled'").bind(post.id, post.creator_id).run();
  if (!claim.meta.changes) return { claimed: false, published: false, failed: false, queued: false };
  try {
    const result = await publishPost(env, post);
    return { claimed: true, ...result };
  } catch (error) {
    await markFailed(env, post, error instanceof Error ? error.message : "Reddit publishing failed.");
    return { claimed: true, published: false, failed: true, queued: false };
  }
}

async function publishOne(request: Request, env: Env) {
  const input = await request.json<{ postId?: string }>();
  if (!input.postId) return Response.json({ ok: false, error: "missing_post_id" }, { status: 400 });
  const post = await loadPost(env, input.postId);
  if (!post) return Response.json({ ok: false, error: "post_not_publishable" }, { status: 409 });
  const result = await claimAndPublish(env, post);
  const current = await env.DB.prepare("SELECT status,external_post_id,external_url,error FROM social_posts WHERE id=? AND creator_id=?").bind(input.postId, CREATOR_ID).first();
  return Response.json({ ok: result.queued || result.published, ...result, post: current }, { status: result.queued || result.published ? 202 : 409 });
}

async function processDue(env: Env, triggerType: string) {
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO scheduler_runs (id,service,trigger_type,status) VALUES (?,'reddit',?,'running')").bind(runId, triggerType).run();
  let claimed = 0, published = 0, failed = 0;
  try {
    const due = await env.DB.prepare(`
      SELECT p.id,p.creator_id,p.asset_id,p.title,p.caption,p.content_rating,a.relative_path,c.dropbox_root,
        rc.name AS community_name,rc.flair_required,rc.allows_nsfw
      FROM social_posts p
      JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
      JOIN creators c ON c.id=p.creator_id
      JOIN reddit_communities rc ON rc.id=p.community_id AND rc.creator_id=p.creator_id
      WHERE p.creator_id=? AND p.platform='reddit' AND p.status='scheduled' AND p.approved_at IS NOT NULL
        AND p.scheduled_at IS NOT NULL AND unixepoch(p.scheduled_at)<=unixepoch(CURRENT_TIMESTAMP)
      ORDER BY p.scheduled_at LIMIT 5
    `).bind(CREATOR_ID).all<DuePost>();
    for (const post of due.results) {
      const result = await claimAndPublish(env, post);
      if (!result.claimed) continue;
      claimed++;
      if (result.published) published++;
      if (result.failed) failed++;
    }
    await env.DB.prepare("UPDATE scheduler_runs SET status='completed',completed_at=CURRENT_TIMESTAMP,claimed_count=?,published_count=?,failed_count=? WHERE id=?").bind(claimed, published, failed, runId).run();
    console.log(JSON.stringify({ event: "reddit_scheduler_run", runId, claimed, published, failed }));
    return { ok: true, runId, claimed, published, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduler run failed.";
    await env.DB.prepare("UPDATE scheduler_runs SET status='failed',completed_at=CURRENT_TIMESTAMP,claimed_count=?,published_count=?,failed_count=?,error=? WHERE id=?").bind(claimed, published, failed, message.slice(0, 2000), runId).run();
    console.error(JSON.stringify({ event: "reddit_scheduler_error", runId, message }));
    throw error;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function startConnection(request: Request, env: Env) {
  const input = await request.json<{ callbackUrl?: string; actor?: string }>();
  if (!input.callbackUrl?.startsWith("https://thot-os-staging.thot-os.workers.dev/")) return Response.json({ ok: false, error: "invalid_callback" }, { status: 400 });
  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const callback = new URL(input.callbackUrl);
  callback.searchParams.set("state", state);
  const link = await jsonRequest<{ redirect_url: string; connected_account_id: string; expires_at?: string }>(
    `${COMPOSIO_V3}/connected_accounts/link`, env.COMPOSIO_API_KEY,
    { method: "POST", body: JSON.stringify({ auth_config_id: env.COMPOSIO_REDDIT_AUTH_CONFIG_ID, user_id: REDDIT_USER_ID, alias: `adelaide-reddit-${Date.now().toString(36)}`, callback_url: callback.toString() }) },
  );
  await env.DB.prepare("INSERT INTO provider_connection_attempts (id,creator_id,service,state_hash,connected_account_id,status,expires_at) VALUES (?,?,'reddit',?,?,'pending',?)")
    .bind(crypto.randomUUID(), CREATOR_ID, await sha256(state), link.connected_account_id, link.expires_at ?? new Date(Date.now() + 10 * 60_000).toISOString()).run();
  return Response.json({ ok: true, redirectUrl: link.redirect_url });
}

async function completeConnection(request: Request, env: Env) {
  const input = await request.json<{ state?: string }>();
  if (!input.state) return Response.json({ ok: false, error: "missing_state" }, { status: 400 });
  const stateHash = await sha256(input.state);
  const attempt = await env.DB.prepare("SELECT id,connected_account_id,expires_at FROM provider_connection_attempts WHERE creator_id=? AND service='reddit' AND state_hash=? AND status='pending'").bind(CREATOR_ID, stateHash).first<{ id: string; connected_account_id: string; expires_at: string }>();
  if (!attempt || new Date(attempt.expires_at).getTime() < Date.now()) return Response.json({ ok: false, error: "invalid_or_expired_state" }, { status: 400 });
  try {
    const account = await jsonRequest<{ status?: string }>(`${COMPOSIO_V3}/connected_accounts/${attempt.connected_account_id}`, env.COMPOSIO_API_KEY);
    if (account.status !== "ACTIVE") throw new Error(`Reddit authorization is ${account.status ?? "not active"}.`);
    const identity = await redditIdentity(env, attempt.connected_account_id);
    const expected = await env.DB.prepare("SELECT handle FROM operational_accounts WHERE creator_id=? AND platform='reddit' ORDER BY label LIMIT 1").bind(CREATOR_ID).first<{ handle: string }>();
    if (expected?.handle && expected.handle.replace(/^u\//i, "").toLowerCase() !== identity.name!.toLowerCase()) throw new Error(`Authorized u/${identity.name}, but Adelaide's configured account is ${expected.handle}.`);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO provider_connections (creator_id,service,connected_account_id,composio_user_id,status,external_account_id,display_name,identity_confirmed_at,last_error,updated_at) VALUES (?,'reddit',?,?,'active',?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP) ON CONFLICT(creator_id,service) DO UPDATE SET connected_account_id=excluded.connected_account_id,composio_user_id=excluded.composio_user_id,status='active',external_account_id=excluded.external_account_id,display_name=excluded.display_name,identity_confirmed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP").bind(CREATOR_ID, attempt.connected_account_id, REDDIT_USER_ID, identity.id, `u/${identity.name}`),
      env.DB.prepare("UPDATE provider_connection_attempts SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(attempt.id),
      env.DB.prepare(`UPDATE operational_accounts SET handle=?,connection_status='connected',publishing_mode='local_bridge',publishing_authority='device_only',
        warning_level=CASE WHEN EXISTS (SELECT 1 FROM reddit_bridge_tokens WHERE creator_id=? AND status='active' AND expires_at>CURRENT_TIMESTAMP AND last_seen_at IS NOT NULL) THEN 'none' ELSE 'attention' END,
        warning_message=CASE WHEN EXISTS (SELECT 1 FROM reddit_bridge_tokens WHERE creator_id=? AND status='active' AND expires_at>CURRENT_TIMESTAMP AND last_seen_at IS NOT NULL) THEN '' ELSE 'Pair Adelaide’s signed Reddit browser for native scheduled posts.' END,
        external_identity_confirmed_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND platform='reddit'`).bind(`u/${identity.name}`, CREATOR_ID, CREATOR_ID, CREATOR_ID),
    ]);
    return Response.json({ ok: true, displayName: `u/${identity.name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reddit connection failed.";
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_connection_attempts SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message.slice(0, 2000), attempt.id),
      env.DB.prepare("UPDATE operational_accounts SET connection_status='needs_reconnection',publishing_authority='blocked',warning_level='blocked',warning_message=?,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND platform='reddit'").bind(message.slice(0, 500), CREATOR_ID),
    ]);
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

async function status(env: Env) {
  const [connection, lastRun, due] = await Promise.all([
    env.DB.prepare("SELECT status,display_name,identity_confirmed_at,last_error,updated_at FROM provider_connections WHERE creator_id=? AND service='reddit'").bind(CREATOR_ID).first(),
    env.DB.prepare("SELECT status,started_at,completed_at,claimed_count,published_count,failed_count,error FROM scheduler_runs WHERE service='reddit' ORDER BY started_at DESC LIMIT 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM social_posts WHERE creator_id=? AND platform='reddit' AND status='scheduled' AND unixepoch(scheduled_at)<=unixepoch(CURRENT_TIMESTAMP)").bind(CREATOR_ID).first<{ count: number }>(),
  ]);
  return Response.json({ ok: true, connection, lastRun, due: due?.count ?? 0 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/connections/reddit/start") return startConnection(request, env);
      if (request.method === "POST" && url.pathname === "/connections/reddit/complete") return completeConnection(request, env);
      if (request.method === "POST" && url.pathname === "/posts/reddit/publish") return publishOne(request, env);
      if (request.method === "POST" && url.pathname === "/run") return Response.json(await processDue(env, "service"));
      if (request.method === "GET" && url.pathname === "/status") return status(env);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: "reddit_scheduler_request_error", path: url.pathname, message: error instanceof Error ? error.message : "Unknown error" }));
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Request failed." }, { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processDue(env, "cron"));
  },
} satisfies ExportedHandler<Env>;
