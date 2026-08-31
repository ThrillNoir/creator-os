import { findPublishedImage, imageMimeType, parseMediaLease, parseRedditFlairChoices, parseRedditMediaReceipt, parseRedditPostRequirements, redditApiErrors, redditProfileCommunityName, redditSubmissionWebsocketUrl, type RedditMediaReceipt } from "./reddit-api";

type UnknownRecord = Record<string, unknown>;
import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";
import { immutableR2IdentityMatches } from "../../shared/source-media-integrity.ts";
type DuePost = {
  id: string; creator_id: string; account_id: string; asset_id: string; title: string; caption: string;
  content_rating: "sfw" | "nsfw"; relative_path: string; basename: string; extension: string; bytes: number;
  community_id: number | null; community_name: string | null; flair_required: number | null; allows_nsfw: number | null;
  reddit_flair_id: string | null; reddit_flair_text: string | null;
};

const COMPOSIO_V3 = "https://backend.composio.dev/api/v3";
const COMPOSIO_V31 = "https://backend.composio.dev/api/v3.1";
const MAX_REDDIT_IMAGE_BYTES = 20 * 1024 * 1024;

class OutcomeUncertainError extends Error {}

async function waitForRedditMediaReceipt(websocketUrl: string, timeoutMs = 30_000): Promise<RedditMediaReceipt> {
  const socket = new WebSocket(websocketUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(); } catch {}
      callback();
    };
    const timeout = setTimeout(() => finish(() => reject(new OutcomeUncertainError("Reddit did not finish processing the uploaded image within 30 seconds."))), timeoutMs);
    socket.addEventListener("message", (event) => {
      try {
        const receipt = parseRedditMediaReceipt(event.data);
        finish(() => resolve(receipt));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    socket.addEventListener("error", () => finish(() => reject(new OutcomeUncertainError("Reddit's media receipt channel failed."))));
    socket.addEventListener("close", () => finish(() => reject(new OutcomeUncertainError("Reddit closed the media receipt channel before confirming the post."))));
  });
}

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

async function composioProxy<T>(env: Env, connectedAccountId: string, endpoint: string, method: "GET" | "POST" = "GET") {
  const response = await jsonRequest<{ status: number; data?: T }>(`${COMPOSIO_V31}/tools/execute/proxy`, env.COMPOSIO_API_KEY, {
    method: "POST",
    body: JSON.stringify({ connected_account_id: connectedAccountId, endpoint, method }),
  });
  if (response.status < 200 || response.status >= 300 || response.data === undefined) {
    throw new Error(`Reddit API request failed (${response.status}).`);
  }
  return response.data;
}

async function redditIdentity(env: Env, connectedAccountId: string) {
  const identity = await composioProxy<{ id?: string; name?: string }>(env, connectedAccountId, "/api/v1/me");
  if (!identity.id || !identity.name) throw new Error("Reddit identity could not be verified.");
  return { id: identity.id, name: identity.name };
}

async function executeReddit<T>(env: Env, creatorId: string, connectedAccountId: string, slug: string, args: Record<string, unknown>) {
  const response = await jsonRequest<{ successful?: boolean; data?: T; error?: string | { message?: string } }>(
    `${COMPOSIO_V31}/tools/execute/${slug}`, env.COMPOSIO_API_KEY,
    { method: "POST", body: JSON.stringify({ connected_account_id: connectedAccountId, user_id: `creator-os:${creatorId}:service:reddit`, version: "latest", arguments: args }) },
  );
  if (response.successful === false || response.data === undefined) {
    const message = typeof response.error === "string" ? response.error : response.error?.message;
    throw new Error(message || `${slug} failed.`);
  }
  return response.data;
}

type CanonicalR2Source = { object_key: string; byte_count: number; verified_mime_type: string; sha256: string; r2_version: string; r2_etag: string };

async function approvedRedditImage(env: Env, post: DuePost) {
  if (!env.LIBRARY_MEDIA) throw new Error("r2_source_media_binding_missing");
  const record = await env.DB.prepare(`SELECT o.object_key,o.byte_count,o.verified_mime_type,o.sha256,o.r2_version,o.r2_etag
    FROM asset_storage_objects o JOIN assets a ON a.id=o.asset_id AND a.creator_id=o.creator_id
    WHERE o.creator_id=? AND o.asset_id=? AND o.provider='r2' AND o.storage_role='canonical_original'
      AND o.bucket_role='library_media' AND o.ingest_status='verified'
      AND o.object_key=a.media_r2_key AND o.byte_count=a.bytes AND a.source_available=1
      AND EXISTS (SELECT 1 FROM asset_media_authorities ma WHERE ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native')
      AND o.r2_version IS NOT NULL AND o.r2_etag IS NOT NULL
    ORDER BY o.verified_at DESC LIMIT 1`).bind(post.creator_id, post.asset_id).first<CanonicalR2Source>();
  if (!record) throw new Error("r2_source_media_not_available");
  const object = await env.LIBRARY_MEDIA.get(record.object_key, { onlyIf: { etagMatches: record.r2_etag } });
  if (!object || !("body" in object) || !immutableR2IdentityMatches(record, object)) throw new Error("r2_source_media_integrity_failed");
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== record.byte_count) throw new Error("r2_source_media_integrity_failed");
  return { bytes, mimeType: imageMimeType(post.basename, record.verified_mime_type), source: "r2" as const };
}

async function markFailed(env: Env, post: DuePost, message: string, uncertain = false) {
  const safeMessage = `${uncertain ? "Outcome uncertain; verify Reddit before retrying. " : ""}${message}`.slice(0, 2000);
  await env.DB.batch([
    env.DB.prepare("UPDATE social_posts SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(safeMessage, post.id, post.creator_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:reddit-scheduler','service','publish_failed',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ error: safeMessage, uncertain })),
    env.DB.prepare(`UPDATE external_operation_receipts
      SET status=CASE WHEN status='confirmed' THEN 'confirmed' ELSE ? END,verification_detail=?,updated_at=CURRENT_TIMESTAMP
      WHERE operation_id=? AND creator_id=? AND provider='reddit'`)
      .bind(uncertain ? "uncertain" : "failed", JSON.stringify({ error: safeMessage, uncertain }), `social-publish:reddit:${post.id}`, post.creator_id),
    env.DB.prepare(`UPDATE operation_outbox SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND creator_id=? AND status<>'delivered'`)
      .bind(safeMessage, `social-publish:reddit:${post.id}`, post.creator_id),
  ]);
}

async function beginRedditPublish(env: Env, post: DuePost) {
  const operationId = `social-publish:reddit:${post.id}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO operation_outbox
      (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(idempotency_key) DO UPDATE SET status=CASE WHEN operation_outbox.status='delivered' THEN 'delivered' ELSE 'pending' END,
        attempts=operation_outbox.attempts+1,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(operationId, post.creator_id, "social_publish", operationId, JSON.stringify({ postId: post.id, platform: "reddit" })),
    env.DB.prepare(`INSERT INTO external_operation_receipts
      (id,creator_id,operation_id,provider,status,verification_detail,created_at,updated_at)
      VALUES (?,?,?,'reddit','pending','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(operation_id,provider) DO UPDATE SET status=CASE WHEN external_operation_receipts.status='confirmed' THEN 'confirmed' ELSE 'pending' END,
        verification_detail='{}',updated_at=CURRENT_TIMESTAMP`)
      .bind(`external-receipt:reddit:${post.id}`, post.creator_id, operationId),
  ]);
  return operationId;
}

async function publishPost(env: Env, post: DuePost) {
  const profileTarget = post.community_id === null;
  if (!profileTarget && !post.community_name) throw new Error("Reddit post target is missing.");
  if (!profileTarget && post.flair_required && !post.reddit_flair_id) throw new Error(`r/${post.community_name} requires flair; refresh its requirements and choose a flair before scheduling.`);
  if (!profileTarget && post.content_rating === "nsfw" && !post.allows_nsfw) throw new Error(`r/${post.community_name} is not recorded as allowing NSFW posts.`);
  if (post.bytes > MAX_REDDIT_IMAGE_BYTES) throw new Error("Reddit images must be 20 MB or smaller.");
  const connection = await env.DB.prepare(`SELECT pc.connected_account_id,pc.status
    FROM provider_connections pc JOIN operational_accounts oa ON oa.id=pc.account_id
    WHERE pc.creator_id=? AND pc.service='reddit' AND pc.account_id=? AND oa.platform='reddit' AND oa.is_active=1`)
    .bind(post.creator_id, post.account_id).first<{ connected_account_id: string; status: string }>();
  if (!connection || connection.status !== "active") throw new Error("Reddit is not connected through Composio. Reconnect it in Operations.");
  const identity = await redditIdentity(env, connection.connected_account_id);
  const expected = await env.DB.prepare("SELECT handle,external_identity_confirmed_at FROM operational_accounts WHERE id=? AND creator_id=? AND platform='reddit' AND is_active=1").bind(post.account_id, post.creator_id).first<{ handle: string; external_identity_confirmed_at: string | null }>();
  if (!expected) throw new Error("Reddit post account is missing or inactive.");
  if (profileTarget && (!expected.handle || !expected.external_identity_confirmed_at)) throw new Error("The selected Reddit account is not verified for profile publishing.");
  if (expected?.handle && expected.handle.replace(/^u\//i, "").toLowerCase() !== identity.name.toLowerCase()) {
    throw new Error(`Composio is authorized as u/${identity.name}, not ${expected.handle}. Reconnect the correct account.`);
  }
  const destinationCommunity = profileTarget ? redditProfileCommunityName(identity.name) : post.community_name!;

  const source = await approvedRedditImage(env, post);
  const image = source.bytes;
  if (!image.byteLength || image.byteLength > MAX_REDDIT_IMAGE_BYTES) throw new Error("The approved Reddit image is empty or larger than 20 MB.");
  const mimeType = source.mimeType;
  const operationId = await beginRedditPublish(env, post);
  const leaseQuery = new URLSearchParams({ filepath: post.basename, mimetype: mimeType });
  const lease = parseMediaLease(await composioProxy<unknown>(env, connection.connected_account_id, `/api/media/asset.json?${leaseQuery}`, "POST"));
  const upload = new FormData();
  for (const field of lease.uploadFields) upload.append(field.name, field.value);
  upload.append("file", new Blob([image], { type: mimeType }), post.basename);
  const uploadResponse = await fetch(lease.uploadUrl, { method: "POST", body: upload });
  if (!uploadResponse.ok) throw new Error(`Reddit media upload failed (${uploadResponse.status}).`);

  const submittedAt = Date.now();
  const submitQuery = new URLSearchParams({
    api_type: "json", kind: "image", nsfw: String(post.content_rating === "nsfw"), raw_json: "1", resubmit: "true",
    sendreplies: "true", sr: destinationCommunity, title: post.title, url: lease.mediaUrl, validate_on_submit: "true",
  });
  if (post.reddit_flair_id) submitQuery.set("flair_id", post.reddit_flair_id);
  let submission: unknown;
  try {
    submission = await composioProxy<unknown>(env, connection.connected_account_id, `/api/submit?${submitQuery}`, "POST");
  } catch (error) {
    throw new OutcomeUncertainError(`Reddit submission response was interrupted: ${error instanceof Error ? error.message : "network error"}.`);
  }
  const apiErrors = redditApiErrors(submission);
  if (apiErrors.length) throw new Error(`Reddit rejected the post: ${apiErrors.join("; ")}`);

  let mediaReceipt: RedditMediaReceipt | null = null;
  const websocketUrl = redditSubmissionWebsocketUrl(submission);
  if (websocketUrl) mediaReceipt = await waitForRedditMediaReceipt(websocketUrl);

  let published = null;
  try {
    for (let attempt = 0; attempt < 5 && !published; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 1_000));
      const endpoint = mediaReceipt
        ? `/api/info?id=${encodeURIComponent(mediaReceipt.externalPostId)}&raw_json=1`
        : profileTarget
          ? `/user/${encodeURIComponent(identity.name)}/submitted?limit=50&raw_json=1`
          : `/r/${encodeURIComponent(post.community_name!)}/new?limit=50&raw_json=1`;
      const listing = await composioProxy<unknown>(env, connection.connected_account_id, endpoint);
      published = findPublishedImage({ children: listing, expectedAuthor: identity.name, expectedCommunity: destinationCommunity, expectedProfileUsername: profileTarget ? identity.name : null, expectedTitle: post.title, submittedAfterMs: submittedAt, expectedFlairId: profileTarget ? null : post.reddit_flair_id });
    }
  } catch (error) {
    throw new OutcomeUncertainError(`Reddit accepted the image submission, but receipt verification failed: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
  if (!published?.permalink) throw new OutcomeUncertainError("Reddit accepted the image submission, but THOT OS could not verify its public receipt.");
  const externalPostId = mediaReceipt?.externalPostId || published.name || `t3_${published.id}`;
  const externalUrl = mediaReceipt?.externalUrl || `https://www.reddit.com${published.permalink}`;
  let commentReceipt: unknown = null;
  if (post.caption.trim()) {
    try {
      commentReceipt = await executeReddit(env, post.creator_id, connection.connected_account_id, "REDDIT_POST_REDDIT_COMMENT", { thing_id: externalPostId, text: post.caption.trim() });
    } catch (error) {
      console.error(JSON.stringify({ event: "reddit_first_comment_failed", postId: post.id, message: error instanceof Error ? error.message : "Unknown error" }));
    }
  }
  const completion = [
    env.DB.prepare(`UPDATE social_posts SET status='published',external_post_id=?,external_url=?,published_at=CURRENT_TIMESTAMP,error=NULL,
      device_claimed_at=NULL,device_receipt=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='publishing'`)
      .bind(externalPostId, externalUrl, JSON.stringify({ method: "composio_reddit_api", nativeMedia: true, author: identity.name, targetType: profileTarget ? "profile" : "subreddit", community: destinationCommunity, accountId: post.account_id, flairId: profileTarget ? null : post.reddit_flair_id, flairText: profileTarget ? null : post.reddit_flair_text, firstCommentRequested: Boolean(post.caption.trim()), firstCommentRecorded: Boolean(commentReceipt) }), post.id, post.creator_id),
    env.DB.prepare("UPDATE operational_accounts SET last_success_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,warning_level='none',warning_message='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND platform='reddit'").bind(post.account_id, post.creator_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:reddit-scheduler','service','api_publish_completed',?)").bind(crypto.randomUUID(), post.id, post.creator_id, JSON.stringify({ externalPostId, externalUrl, targetType: profileTarget ? "profile" : "subreddit", community: destinationCommunity, accountId: post.account_id })),
    env.DB.prepare("UPDATE external_operation_receipts SET status='confirmed',provider_operation_id=?,verification_detail=?,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE operation_id=? AND creator_id=? AND provider='reddit'")
      .bind(externalPostId, JSON.stringify({ externalPostId, externalUrl, targetType: profileTarget ? "profile" : "subreddit", community: destinationCommunity, accountId: post.account_id }), operationId, post.creator_id),
    env.DB.prepare("UPDATE operation_outbox SET status='delivered',delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?")
      .bind(operationId, post.creator_id),
  ];
  try {
    await env.DB.batch(completion);
  } catch (error) {
    throw new OutcomeUncertainError(`Reddit returned ${externalPostId}, but THOT OS could not durably record the receipt: ${error instanceof Error ? error.message : "database failure"}.`);
  }
  return { published: true, failed: false, queued: false };
}

async function loadPost(env: Env, creatorId: string, postId: string) {
  return env.DB.prepare(`
    SELECT p.id,p.creator_id,p.account_id,p.asset_id,p.community_id,p.title,p.caption,p.content_rating,p.reddit_flair_id,p.reddit_flair_text,a.relative_path,a.basename,a.extension,a.bytes,
      rc.name AS community_name,rc.flair_required,rc.allows_nsfw
    FROM social_posts p
    JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
    LEFT JOIN reddit_communities rc ON rc.id=p.community_id AND rc.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.platform='reddit' AND p.status='scheduled' AND p.approved_at IS NOT NULL
      AND (p.community_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM social_post_events profile_event
        WHERE profile_event.post_id=p.id AND profile_event.creator_id=p.creator_id
          AND json_extract(profile_event.detail,'$.targetType')='profile'
      ))
  `).bind(postId, creatorId).first<DuePost>();
}

async function claimAndPublish(env: Env, post: DuePost) {
  const claim = await env.DB.prepare("UPDATE social_posts SET status='publishing',claimed_at=CURRENT_TIMESTAMP,last_attempt_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='scheduled'").bind(post.id, post.creator_id).run();
  if (!claim.meta.changes) return { claimed: false, published: false, failed: false, queued: false };
  try {
    const result = await publishPost(env, post);
    return { claimed: true, ...result };
  } catch (error) {
    await markFailed(env, post, error instanceof Error ? error.message : "Reddit publishing failed.", error instanceof OutcomeUncertainError);
    return { claimed: true, published: false, failed: true, queued: false };
  }
}

async function publishOne(request: Request, env: Env) {
  const input = await request.json<{ postId?: string; creatorId?: string }>();
  if (!input.postId || !input.creatorId) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const post = await loadPost(env, input.creatorId, input.postId);
  if (!post) return Response.json({ ok: false, error: "post_not_publishable" }, { status: 409 });
  const result = await claimAndPublish(env, post);
  const current = await env.DB.prepare("SELECT status,external_post_id,external_url,error FROM social_posts WHERE id=? AND creator_id=?").bind(input.postId, input.creatorId).first();
  return Response.json({ ok: result.queued || result.published, ...result, post: current }, { status: result.queued || result.published ? 202 : 409 });
}

async function processDue(env: Env, triggerType: string) {
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO scheduler_runs (id,service,trigger_type,status) VALUES (?,'reddit',?,'running')").bind(runId, triggerType).run();
  let claimed = 0, published = 0, failed = 0;
  try {
    const due = await env.DB.prepare(`
      SELECT p.id,p.creator_id,p.account_id,p.asset_id,p.community_id,p.title,p.caption,p.content_rating,p.reddit_flair_id,p.reddit_flair_text,a.relative_path,a.basename,a.extension,a.bytes,
        rc.name AS community_name,rc.flair_required,rc.allows_nsfw
      FROM social_posts p
      JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
      LEFT JOIN reddit_communities rc ON rc.id=p.community_id AND rc.creator_id=p.creator_id
      WHERE p.platform='reddit' AND p.status='scheduled' AND p.approved_at IS NOT NULL
        AND (p.community_id IS NOT NULL OR EXISTS (
          SELECT 1 FROM social_post_events profile_event
          WHERE profile_event.post_id=p.id AND profile_event.creator_id=p.creator_id
            AND json_extract(profile_event.detail,'$.targetType')='profile'
        ))
        AND p.scheduled_at IS NOT NULL AND unixepoch(p.scheduled_at)<=unixepoch(CURRENT_TIMESTAMP)
      ORDER BY p.scheduled_at LIMIT 5
    `).all<DuePost>();
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

async function refreshCommunityFlairs(request: Request, env: Env) {
  const input = await request.json<{ creatorId?: string; accountId?: string; communityId?: number }>();
  const creatorId = String(input.creatorId ?? "");
  const communityId = Number(input.communityId);
  if (!creatorId || !input.accountId || !Number.isInteger(communityId) || communityId < 1) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const [community, connection] = await Promise.all([
    env.DB.prepare("SELECT id,name FROM reddit_communities WHERE id=? AND creator_id=? AND status='active'").bind(communityId, creatorId).first<{ id: number; name: string }>(),
    env.DB.prepare("SELECT pc.connected_account_id,pc.status FROM provider_connections pc JOIN operational_accounts oa ON oa.id=pc.account_id WHERE pc.creator_id=? AND pc.service='reddit' AND pc.account_id=? AND oa.platform='reddit' AND oa.is_active=1").bind(creatorId, input.accountId).first<{ connected_account_id: string; status: string }>(),
  ]);
  if (!community) return Response.json({ ok: false, error: "community_not_found" }, { status: 404 });
  if (!connection || connection.status !== "active") return Response.json({ ok: false, error: "Reddit is not connected through Composio." }, { status: 409 });
  try {
    const [requirementsPayload, selectorPayload] = await Promise.all([
      composioProxy<unknown>(env, connection.connected_account_id, `/api/v1/${encodeURIComponent(community.name)}/post_requirements?raw_json=1`),
      composioProxy<unknown>(env, connection.connected_account_id, `/r/${encodeURIComponent(community.name)}/api/flairselector?is_newlink=true&raw_json=1`, "POST"),
    ]);
    const requirements = parseRedditPostRequirements(requirementsPayload);
    const flairs = parseRedditFlairChoices(selectorPayload);
    const statements = [
      env.DB.prepare("UPDATE reddit_community_flairs SET active=0,fetched_at=CURRENT_TIMESTAMP WHERE creator_id=? AND community_id=?").bind(creatorId, community.id),
      env.DB.prepare("UPDATE reddit_communities SET flair_required=?,flairs_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(requirements.flairRequired ? 1 : 0, community.id, creatorId),
      env.DB.prepare("INSERT INTO reddit_community_events (id,community_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:reddit-scheduler','service','flairs_refreshed',?)")
        .bind(crypto.randomUUID(), community.id, creatorId, JSON.stringify({ flairRequired: requirements.flairRequired, selectableCount: flairs.length })),
      ...flairs.map((flair) => env.DB.prepare(`INSERT INTO reddit_community_flairs
        (creator_id,community_id,flair_id,flair_text,text_editable,active,fetched_at) VALUES (?,?,?,?,?,1,CURRENT_TIMESTAMP)
        ON CONFLICT(creator_id,community_id,flair_id) DO UPDATE SET flair_text=excluded.flair_text,text_editable=excluded.text_editable,active=1,fetched_at=CURRENT_TIMESTAMP`)
        .bind(creatorId, community.id, flair.id, flair.text, flair.textEditable ? 1 : 0)),
    ];
    await env.DB.batch(statements);
    return Response.json({ ok: true, communityId: community.id, communityName: community.name, flairRequired: requirements.flairRequired, flairs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reddit flair refresh failed.";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function startConnection(request: Request, env: Env) {
  const input = await request.json<{ callbackUrl?: string; creatorId?: string; accountId?: string }>();
  if (!input.callbackUrl?.startsWith("https://thot-os-staging.thot-os.workers.dev/") || !input.creatorId || !input.accountId) return Response.json({ ok: false, error: "invalid_connection_scope" }, { status: 400 });
  const account = await env.DB.prepare("SELECT id FROM operational_accounts WHERE id=? AND creator_id=? AND platform='reddit' AND is_active=1").bind(input.accountId, input.creatorId).first();
  if (!account) return Response.json({ ok: false, error: "creator_account_not_found" }, { status: 404 });
  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const callback = new URL(input.callbackUrl);
  callback.searchParams.set("state", state);
  const link = await jsonRequest<{ redirect_url: string; connected_account_id: string; expires_at?: string }>(
    `${COMPOSIO_V3}/connected_accounts/link`, env.COMPOSIO_API_KEY,
    { method: "POST", body: JSON.stringify({ auth_config_id: env.COMPOSIO_REDDIT_AUTH_CONFIG_ID, user_id: `creator-os:${input.creatorId}:service:reddit`, alias: `${input.creatorId}-reddit-${Date.now().toString(36)}`, callback_url: callback.toString() }) },
  );
  await env.DB.prepare("INSERT INTO provider_connection_attempts (id,creator_id,service,account_id,state_hash,connected_account_id,status,expires_at) VALUES (?,?,'reddit',?,?,?,'pending',?)")
    .bind(crypto.randomUUID(), input.creatorId, input.accountId, await sha256(state), link.connected_account_id, link.expires_at ?? new Date(Date.now() + 10 * 60_000).toISOString()).run();
  return Response.json({ ok: true, redirectUrl: link.redirect_url });
}

async function completeConnection(request: Request, env: Env) {
  const input = await request.json<{ state?: string; creatorId?: string }>();
  if (!input.state || !input.creatorId) return Response.json({ ok: false, error: "missing_scope" }, { status: 400 });
  const stateHash = await sha256(input.state);
  const attempt = await env.DB.prepare("SELECT id,account_id,connected_account_id,expires_at FROM provider_connection_attempts WHERE creator_id=? AND service='reddit' AND state_hash=? AND status='pending'").bind(input.creatorId, stateHash).first<{ id: string; account_id: string; connected_account_id: string; expires_at: string }>();
  if (!attempt || new Date(attempt.expires_at).getTime() < Date.now()) return Response.json({ ok: false, error: "invalid_or_expired_state" }, { status: 400 });
  try {
    const account = await jsonRequest<{ status?: string }>(`${COMPOSIO_V3}/connected_accounts/${attempt.connected_account_id}`, env.COMPOSIO_API_KEY);
    if (account.status !== "ACTIVE") throw new Error(`Reddit authorization is ${account.status ?? "not active"}.`);
    const identity = await redditIdentity(env, attempt.connected_account_id);
    const expected = await env.DB.prepare("SELECT handle FROM operational_accounts WHERE id=? AND creator_id=? AND platform='reddit' AND is_active=1").bind(attempt.account_id, input.creatorId).first<{ handle: string }>();
    if (!expected) throw new Error("Reddit account is missing or inactive.");
    if (!expected.handle || expected.handle.replace(/^u\//i, "").toLowerCase() !== identity.name.toLowerCase()) throw new Error(`Authorized u/${identity.name}, but the configured creator account is ${expected.handle || "not configured"}.`);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO provider_connections (creator_id,service,account_id,connected_account_id,composio_user_id,status,external_account_id,display_name,identity_confirmed_at,last_error,updated_at) VALUES (?,'reddit',?,?,?,'active',?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP) ON CONFLICT(creator_id,service,account_id) DO UPDATE SET connected_account_id=excluded.connected_account_id,composio_user_id=excluded.composio_user_id,status='active',external_account_id=excluded.external_account_id,display_name=excluded.display_name,identity_confirmed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP")
        .bind(input.creatorId, attempt.account_id, attempt.connected_account_id, `creator-os:${input.creatorId}:service:reddit`, identity.id, `u/${identity.name}`),
      env.DB.prepare("UPDATE provider_connection_attempts SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(attempt.id),
      env.DB.prepare(`UPDATE operational_accounts SET handle=?,connection_status='connected',publishing_mode='scheduled_api',publishing_authority='confirmed',
        warning_level='none',warning_message='',external_identity_confirmed_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND platform='reddit'`).bind(`u/${identity.name}`, attempt.account_id, input.creatorId),
      env.DB.prepare("INSERT INTO identity_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail) VALUES (?,?,?,'service','reddit_connection_verified','reddit',?)").bind(crypto.randomUUID(), input.creatorId, "service:thot-os-web-reddit", JSON.stringify({ displayName: `u/${identity.name}` })),
    ]);
    return Response.json({ ok: true, accountId: attempt.account_id, displayName: `u/${identity.name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reddit connection failed.";
    await env.DB.batch([
      env.DB.prepare("UPDATE provider_connection_attempts SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message.slice(0, 2000), attempt.id),
      env.DB.prepare("UPDATE operational_accounts SET connection_status='needs_reconnection',publishing_authority='blocked',warning_level='blocked',warning_message=?,last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND platform='reddit'").bind(message.slice(0, 500), attempt.account_id, input.creatorId),
    ]);
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

async function status(env: Env, creatorId: string) {
  const [connection, lastRun, due] = await Promise.all([
    env.DB.prepare("SELECT account_id,status,display_name,identity_confirmed_at,last_error,updated_at FROM provider_connections WHERE creator_id=? AND service='reddit'").bind(creatorId).all(),
    env.DB.prepare("SELECT status,started_at,completed_at,claimed_count,published_count,failed_count,error FROM scheduler_runs WHERE service='reddit' ORDER BY started_at DESC LIMIT 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM social_posts WHERE creator_id=? AND platform='reddit' AND status='scheduled' AND unixepoch(scheduled_at)<=unixepoch(CURRENT_TIMESTAMP)").bind(creatorId).first<{ count: number }>(),
  ]);
  return Response.json({ ok: true, connections: connection.results, lastRun, due: due?.count ?? 0 });
}

const routeCapabilities: Record<string, string> = {
  "POST /connections/reddit/start": "reddit.connection.manage",
  "POST /connections/reddit/complete": "reddit.connection.manage",
  "POST /communities/reddit/flairs/refresh": "reddit.communities.read",
  "POST /posts/reddit/publish": "reddit.publish.execute",
  "GET /status": "reddit.status.read",
};

async function authenticatedCreatorId(request: Request, env: Env, url: URL, capability: string) {
  const candidate = request.method === "GET"
    ? url.searchParams.get("creator")
    : (await request.clone().json<{ creatorId?: unknown }>()).creatorId;
  if (typeof candidate !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(candidate)) throw new Error("Creator scope is required.");
  const service = await requireInternalServiceForCreator(request, env.DB, candidate, "thot-os-web-reddit", capability);
  await internalServiceAuditStatement(env.DB, service, url.pathname).run();
  return candidate;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const capability = routeCapabilities[`${request.method} ${url.pathname}`];
      if (!capability) return new Response("Not found", { status: 404 });
      let creatorId: string;
      try {
        creatorId = await authenticatedCreatorId(request, env, url, capability);
      } catch {
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
      if (request.method === "POST" && url.pathname === "/connections/reddit/start") return startConnection(request, env);
      if (request.method === "POST" && url.pathname === "/connections/reddit/complete") return completeConnection(request, env);
      if (request.method === "POST" && url.pathname === "/communities/reddit/flairs/refresh") return refreshCommunityFlairs(request, env);
      if (request.method === "POST" && url.pathname === "/posts/reddit/publish") return publishOne(request, env);
      if (request.method === "POST" && url.pathname === "/run") return new Response("Not found", { status: 404 });
      if (request.method === "GET" && url.pathname === "/status") return status(env, creatorId);
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
