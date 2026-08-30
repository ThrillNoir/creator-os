import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";
import { immutableR2IdentityMatches } from "../../shared/source-media-integrity.ts";

type BridgeIdentity = { creator_id: string; account_id: string; profile_id: string; platform: "fansly" };
type VaultJob = { id: string; basename: string; bytes: number; asset_id: string };
type BrowserMessage = { externalMessageId?: string; direction?: string; senderType?: string; body?: string; sentAt?: string };
type BrowserThread = { externalThreadId?: string; participantName?: string; participantHandle?: string; unreadCount?: number; observedOpen?: boolean; messages?: BrowserMessage[] };
type PreviewQueueMessage = { creatorId: string; assetId: string; sourceRevision: string };

const allowedOrigins = new Set(["https://fansly.com", "https://thot-os-staging.thot-os.workers.dev"]);

function cors(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": allowedOrigins.has(origin) ? origin : "https://fansly.com",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-thot-os-vault-client,x-thot-os-installation-id",
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

type LibraryObject = { object_key: string; byte_count: number; verified_mime_type: string; sha256: string; r2_version: string | null; r2_etag: string | null };
type ResolvedCreatorMedia = { object: R2ObjectBody; record: LibraryObject };

async function resolveCreatorMedia(env: Env, creatorId: string, assetId: string): Promise<ResolvedCreatorMedia> {
  const record = await env.DB.prepare(`SELECT o.object_key,o.byte_count,o.verified_mime_type,o.sha256,o.r2_version,o.r2_etag
    FROM asset_storage_objects o JOIN assets a ON a.id=o.asset_id AND a.creator_id=o.creator_id
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    WHERE o.creator_id=? AND o.asset_id=? AND o.provider='r2' AND o.storage_role='canonical_original'
      AND o.bucket_role='library_media' AND o.ingest_status='verified' AND o.object_key=a.media_r2_key
      AND o.byte_count=a.bytes AND a.source_available=1 ORDER BY o.verified_at DESC LIMIT 1`)
    .bind(creatorId, assetId).first<LibraryObject>();
  if (!record || !record.r2_version || !record.r2_etag) throw new Error("r2_source_media_not_available");
  const object = await env.LIBRARY_MEDIA.get(record.object_key, { onlyIf: { etagMatches: record.r2_etag } });
  if (!object || !("body" in object) || !immutableR2IdentityMatches(record, object)) throw new Error("r2_source_media_integrity_failed");
  return { object, record };
}

function resolvedMediaResponse(request: Request, media: ResolvedCreatorMedia) {
  const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff", ...cors(request) });
  media.object.writeHttpMetadata(headers);
  headers.set("content-type", media.record.verified_mime_type);
  headers.set("content-length", String(media.record.byte_count));
  headers.set("content-disposition", "attachment");
  return new Response(media.object.body, { status: 200, headers });
}

async function authenticate(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 40) return null;
  const tokenHash = await sha256(token);
  const identity = await env.DB.prepare(`SELECT bc.creator_id,bc.account_id,bc.profile_id,bc.platform
    FROM bridge_credentials bc JOIN browser_profiles bp ON bp.id=bc.profile_id AND bp.creator_id=bc.creator_id
    JOIN account_browser_profiles abp ON abp.creator_id=bc.creator_id AND abp.account_id=bc.account_id AND abp.profile_id=bc.profile_id
    WHERE bc.token_hash=? AND bc.platform='fansly' AND bc.status='active' AND bc.expires_at>CURRENT_TIMESTAMP AND bp.status<>'revoked'`).bind(tokenHash).first<BridgeIdentity>();
  if (identity && !await bindInstallation(request, env, identity.creator_id, identity.profile_id, tokenHash)) return null;
  if (identity) await env.DB.prepare("UPDATE bridge_credentials SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<datetime('now','-5 minutes'))").bind(tokenHash).run();
  return identity;
}

async function bindInstallation(request: Request, env: Env, creatorId: string, profileId: string, tokenHash: string) {
  const installationId = request.headers.get("x-thot-os-installation-id")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)) return false;
  const profile = await env.DB.prepare("SELECT installation_id FROM browser_profiles WHERE id=? AND creator_id=? AND installation_id=? AND status<>'revoked'").bind(profileId, creatorId, installationId).first<{ installation_id: string }>();
  if (!profile) return false;
  await env.DB.batch([
    env.DB.prepare("UPDATE browser_profiles SET status='paired',last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND installation_id=?").bind(profileId, creatorId, installationId),
    env.DB.prepare("UPDATE account_browser_profiles SET verified_at=COALESCE(verified_at,CURRENT_TIMESTAMP) WHERE profile_id=? AND creator_id=?").bind(profileId, creatorId),
  ]);
  return Boolean(await env.DB.prepare("SELECT 1 AS valid FROM bridge_credentials WHERE token_hash=? AND profile_id=? AND creator_id=? AND status='active'").bind(tokenHash, profileId, creatorId).first());
}

function pairingPage() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>THOT OS device pairing</title></head><body><main><h1>Pairing this Chrome profile…</h1><p>Keep the THOT OS extension enabled. This page contains no third-party scripts and will continue to Fansly after verification.</p></main></body></html>`;
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
  } });
}

async function sourceMediaHealth(request: Request, env: Env) {
  const input: { creatorId?: string } = await request.json<{ creatorId?: string }>().catch(() => ({}));
  const creatorId = String(input.creatorId ?? "");
  if (!creatorId) return json(request, { ok: false, error: "creator_scope_required" }, 400);
  const service = await requireInternalServiceForCreator(request, env.DB, creatorId, "thot-os-web-vault", "vault.source_media.health");
  await internalServiceAuditStatement(env.DB, service, "/internal/source-media/health").run();
  const record = await env.DB.prepare(`SELECT o.object_key,o.byte_count,o.verified_mime_type,o.sha256,o.r2_version,o.r2_etag
    FROM asset_storage_objects o JOIN assets a ON a.id=o.asset_id AND a.creator_id=o.creator_id
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    WHERE o.creator_id=? AND o.ingest_status='verified' AND o.object_key=a.media_r2_key AND a.source_available=1
    ORDER BY o.verified_at DESC LIMIT 1`).bind(creatorId).first<LibraryObject>();
  let probe = true;
  if (record?.r2_etag) {
    const object = await env.LIBRARY_MEDIA.head(record.object_key);
    probe = Boolean(object && immutableR2IdentityMatches(record, object));
  }
  return json(request, { ok: probe, sourceMediaCapability: "r2-source-v2", reasonCode: probe ? "ready" : "r2_source_media_integrity_failed", bindings: { libraryMedia: true } }, probe ? 200 : 503);
}

function validPreviewMessage(value: unknown): value is PreviewQueueMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return typeof input.creatorId === "string" && input.creatorId.length > 0 && typeof input.assetId === "string" && input.assetId.length > 0
    && typeof input.sourceRevision === "string" && input.sourceRevision.length > 0;
}

async function recordPreviewFailure(env: Env, input: PreviewQueueMessage, message: string, status: "queued" | "failed") {
  await env.DB.batch([
    env.DB.prepare("UPDATE asset_preview_jobs SET status=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND asset_id=? AND source_revision=?")
      .bind(status, message.slice(0, 1000), input.creatorId, input.assetId, input.sourceRevision),
    env.DB.prepare("UPDATE asset_media_authorities SET state=?,preview_failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND asset_id=? AND authority_kind='r2_native'")
      .bind(status === "failed" ? "preview_failed" : "canonical_verified", message.slice(0, 200), input.creatorId, input.assetId),
  ]);
}

async function processPreviewMessage(env: Env, input: PreviewQueueMessage) {
  const asset = await env.DB.prepare(`SELECT o.object_key,o.r2_etag,o.sha256,a.preview_r2_key,j.status AS job_status,j.source_revision
    FROM assets a JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native'
    JOIN asset_storage_objects o ON o.asset_id=a.id AND o.creator_id=a.creator_id AND o.ingest_status='verified' AND o.object_key=a.media_r2_key
    JOIN asset_preview_jobs j ON j.asset_id=a.id AND j.creator_id=a.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.source_available=1`).bind(input.assetId, input.creatorId)
    .first<{ object_key: string; r2_etag: string; sha256: string; preview_r2_key: string | null; job_status: string; source_revision: string }>();
  if (!asset || asset.source_revision !== input.sourceRevision || asset.preview_r2_key || asset.job_status === "done") return;
  const claimed = await env.DB.prepare("UPDATE asset_preview_jobs SET status='processing',attempts=attempts+1,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND asset_id=? AND source_revision=? AND status IN ('queued','failed')")
    .bind(input.creatorId, input.assetId, input.sourceRevision).run();
  if (!claimed.meta.changes) return;
  const source = await env.LIBRARY_MEDIA.get(asset.object_key, { onlyIf: { etagMatches: asset.r2_etag } });
  if (!source || !("body" in source)) throw new Error("r2_source_media_not_available");
  const transformed = await env.IMAGES.input(source.body).transform({ width: 720, height: 720, fit: "scale-down" }).output({ format: "image/jpeg", quality: 84, anim: false });
  const bytes = await new Response(transformed.image()).arrayBuffer();
  if (!bytes.byteLength) throw new Error("native_preview_empty");
  const objectId = await sha256(`${input.creatorId}:${input.assetId}`);
  const key = `creators/${input.creatorId}/assets/${objectId}/previews/${asset.sha256}.jpg`;
  await env.PREVIEWS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg", cacheControl: "private, no-store" }, customMetadata: { creator_id: input.creatorId, asset_id: input.assetId, source_sha256: asset.sha256, derivative: "native_preview_v1" } });
  await env.DB.batch([
    env.DB.prepare("UPDATE assets SET preview_r2_key=? WHERE id=? AND creator_id=? AND preview_r2_key IS NULL").bind(key, input.assetId, input.creatorId),
    env.DB.prepare("UPDATE asset_media_authorities SET state='preview_ready',preview_failure_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND authority_kind='r2_native'").bind(input.assetId, input.creatorId),
    env.DB.prepare("UPDATE asset_preview_jobs SET status='done',completed_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE asset_id=? AND creator_id=? AND source_revision=?").bind(input.assetId, input.creatorId, input.sourceRevision),
  ]);
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
  await env.DB.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:fansly-device','service','job_claimed','{}')").bind(crypto.randomUUID(), candidate.id, identity.creator_id).run();
  return json(request, { ok: true, job: { ...candidate, mediaUrl: `${new URL(request.url).origin}/jobs/${candidate.id}/media` } });
}

async function mediaRedirect(request: Request, env: Env, identity: BridgeIdentity, jobId: string) {
  const job = await env.DB.prepare(`
    SELECT j.asset_id
    FROM vault_upload_jobs j
    JOIN assets a ON a.id=j.asset_id AND a.creator_id=j.creator_id
    WHERE j.id=? AND j.creator_id=? AND j.account_id=? AND j.platform='fansly' AND j.status IN ('claimed','staged')
  `).bind(jobId, identity.creator_id, identity.account_id).first<{ asset_id: string }>();
  if (!job) return json(request, { ok: false, error: "Vault media is not available for this device." }, 404);
  return resolvedMediaResponse(request, await resolveCreatorMedia(env, identity.creator_id, job.asset_id));
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
  await env.DB.prepare("INSERT INTO vault_upload_events (id,job_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:fansly-device','service',?,?)")
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
  if (identity.platform !== "fansly" || input.platform !== "fansly" || !Array.isArray(input.threads)) return json(request, { ok: false, error: "invalid_fansly_snapshot" }, 400);
  const connection = await env.DB.prepare("SELECT id FROM messaging_connections WHERE creator_id=? AND account_id=? AND platform='fansly'").bind(identity.creator_id, identity.account_id).first<{ id: string }>();
  if (!connection) return json(request, { ok: false, error: "fansly_connection_not_configured" }, 409);
  const threads = input.threads.slice(0, 100);
  let importedThreads = 0, importedMessages = 0, changedThreads = 0;
  for (const snapshot of threads) {
    const externalThreadId = canonicalFanslyThread(snapshot.externalThreadId);
    if (!externalThreadId) continue;
    const existingThread = await env.DB.prepare("SELECT id FROM message_threads WHERE creator_id=? AND connection_id=? AND external_thread_id=? LIMIT 1")
      .bind(identity.creator_id, connection.id, externalThreadId).first<{ id: string }>();
    // Reuse Adelaide's existing natural-key row; namespace every new id by creator.
    const threadId = existingThread?.id ?? `fansly-${(await sha256(`${identity.creator_id}:${externalThreadId}`)).slice(0, 40)}`;
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
      VALUES (?,?,?,?,?,?,'Fansly conversation',?,NULL,'open')
      ON CONFLICT(id) DO UPDATE SET participant_name=CASE WHEN excluded.participant_name<>'Fansly conversation' THEN excluded.participant_name ELSE message_threads.participant_name END,
        participant_handle=CASE WHEN excluded.participant_handle<>'' THEN excluded.participant_handle ELSE message_threads.participant_handle END,
        unread_count=excluded.unread_count,updated_at=CURRENT_TIMESTAMP
      WHERE (excluded.participant_name<>'Fansly conversation' AND excluded.participant_name<>message_threads.participant_name)
        OR (excluded.participant_handle<>'' AND excluded.participant_handle<>message_threads.participant_handle)
        OR excluded.unread_count<>message_threads.unread_count`)
      .bind(threadId, identity.creator_id, connection.id, externalThreadId, participantName, participantHandle, unreadCount).run();
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
          WHERE creator_id=? AND thread_id=? AND external_message_id=? AND direction='outbound' AND delivery_status='observed'
            AND NOT EXISTS (SELECT 1 FROM messages existing WHERE existing.thread_id=? AND existing.external_message_id=?)`)
          .bind(externalMessageId, senderType, body, item.sentAt ?? null, identity.creator_id, threadId, previousOutboundId, threadId, externalMessageId).run();
        if (repaired.meta.changes) {
          const changes = Number(repaired.meta.changes);
          importedMessages += changes;
          threadMessageChanges += changes;
          continue;
        }
      }
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO messages
        (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
        VALUES (?,?,?,?,?,?,?,?, 'observed')`)
        .bind(`fansly-message-${(await sha256(`${identity.creator_id}:${externalThreadId}:${externalMessageId}`)).slice(0, 40)}`, identity.creator_id, threadId, externalMessageId, direction, senderType, body, item.sentAt ?? null).run();
      const changes = Number(inserted.meta.changes ?? 0);
      importedMessages += changes;
      threadMessageChanges += changes;
    }
    if (threadMessageChanges > 0) await env.DB.prepare("UPDATE message_threads SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(threadId, identity.creator_id).run();
    const completed = Boolean(snapshot.observedOpen);
    const insertedState = await env.DB.prepare(`INSERT OR IGNORE INTO premium_thread_sync_state
      (thread_id,creator_id,status,attempts,last_completed_at,last_error,updated_at)
      VALUES (?,?,?,0,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,NULL,CURRENT_TIMESTAMP)`)
      .bind(threadId, identity.creator_id, completed ? "complete" : "pending", completed ? 1 : 0).run();
    if (!insertedState.meta.changes && completed) await env.DB.prepare(`UPDATE premium_thread_sync_state
      SET status='complete',attempts=0,last_completed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE thread_id=? AND creator_id=? AND (status<>'complete' OR last_completed_at IS NULL OR last_completed_at<datetime('now','-5 minutes'))`).bind(threadId, identity.creator_id).run();
    if (!insertedState.meta.changes && !completed) await env.DB.prepare(`UPDATE premium_thread_sync_state
      SET status='pending',updated_at=CURRENT_TIMESTAMP
      WHERE thread_id=? AND creator_id=? AND status='complete' AND last_completed_at<datetime('now','-10 minutes')`).bind(threadId, identity.creator_id).run();
    importedThreads++;
  }
  if (importedThreads > 0) await env.DB.prepare(`UPDATE messaging_connections
    SET status='connected',read_enabled=1,outbound_validated=1,last_synced_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND (status<>'connected' OR read_enabled<>1 OR outbound_validated<>1 OR last_error IS NOT NULL OR last_synced_at IS NULL OR last_synced_at<datetime('now','-5 minutes'))`).bind(connection.id, identity.creator_id).run();
  if (importedMessages > 0 || changedThreads > 0) await env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,event_type,actor,actor_role,detail) VALUES (?,?,?,'fansly_messages_synced','service:vault-bridge','service',?)")
    .bind(crypto.randomUUID(), identity.creator_id, connection.id, JSON.stringify({ importedThreads, importedMessages, changedThreads })).run();
  return json(request, { ok: true, importedThreads, importedMessages, changedThreads });
}

async function pendingFanslyThread(request: Request, env: Env, identity: BridgeIdentity) {
  const connection = await env.DB.prepare("SELECT id FROM messaging_connections WHERE creator_id=? AND account_id=? AND platform='fansly'").bind(identity.creator_id, identity.account_id).first<{ id: string }>();
  if (!connection) return json(request, { ok: false, error: "fansly_connection_not_configured" }, 409);
  if (request.method === "POST") {
    const input = await request.json<{ threadId?: string; error?: string }>();
    const threadId = String(input.threadId ?? "");
    await env.DB.prepare(`UPDATE premium_thread_sync_state SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP
      WHERE thread_id=? AND creator_id=? AND thread_id IN (SELECT id FROM message_threads WHERE creator_id=? AND connection_id=?)`)
      .bind(String(input.error ?? "Fansly conversation collection failed.").slice(0, 1000), threadId, identity.creator_id, identity.creator_id, connection.id).run();
    return json(request, { ok: true });
  }
  const pending = await env.DB.prepare(`SELECT s.thread_id AS id,t.external_thread_id FROM premium_thread_sync_state s
    JOIN message_threads t ON t.id=s.thread_id AND t.creator_id=s.creator_id
    WHERE s.creator_id=? AND t.connection_id=? AND s.status IN ('pending','failed') AND s.attempts<3
      AND (s.last_requested_at IS NULL OR s.last_requested_at<datetime('now','-55 seconds')) ORDER BY s.updated_at LIMIT 1`)
    .bind(identity.creator_id, connection.id).first<{ id: string; external_thread_id: string }>();
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
    env.DB.prepare("INSERT INTO messaging_audit_events (id,creator_id,connection_id,thread_id,event_type,actor,actor_role,detail) VALUES (?,?,?,?,?,'service:fansly-device','service',?)")
      .bind(crypto.randomUUID(), identity.creator_id, job.connection_id, job.thread_id, sent ? "fansly_device_send_submitted" : "fansly_device_send_failed", JSON.stringify({ draftId: job.id, error })),
  ];
  if (sent) statements.push(
    env.DB.prepare(`INSERT OR IGNORE INTO messages (id,creator_id,thread_id,external_message_id,direction,sender_type,body,sent_at,delivery_status)
      VALUES (?,?,?,?, 'outbound','agency',?,CURRENT_TIMESTAMP,'device_submitted')`).bind(`fansly-out-${job.id}`, identity.creator_id, job.thread_id, `device-${job.id}`, job.body),
    env.DB.prepare("UPDATE message_threads SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(job.thread_id, identity.creator_id),
  );
  await env.DB.batch(statements);
  return json(request, { ok: true, status: sent ? "sent" : "failed" });
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/pair") return pairingPage();
      if (request.method === "POST" && url.pathname === "/internal/source-media/health") return sourceMediaHealth(request, env);
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
  async queue(batch: MessageBatch<PreviewQueueMessage>, env: Env): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => {
      const input = message.body;
      if (!validPreviewMessage(input)) { message.ack(); return; }
      if (batch.queue === "thot-os-preview-dlq-staging") {
        await recordPreviewFailure(env, input, "Preview generation exhausted its automatic retries.", "failed");
        message.ack();
        return;
      }
      try {
        await processPreviewMessage(env, input);
        message.ack();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Preview generation failed.";
        await recordPreviewFailure(env, input, detail, "queued");
        message.retry({ delaySeconds: Math.min(30 * (2 ** Math.max(0, message.attempts - 1)), 900) });
      }
    }));
  },
} satisfies ExportedHandler<Env, PreviewQueueMessage>;
