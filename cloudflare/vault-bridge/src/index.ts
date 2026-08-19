import { verifyRedditPostMetadata, type RedditPublicPost } from "./reddit-verification";
import { internalServiceAuditStatement, requireInternalServiceForCreator } from "../../shared/service-auth.ts";

type BridgeIdentity = { creator_id: string; account_id: string; profile_id: string; platform: "fansly" };
type RedditBridgeIdentity = { creator_id: string; account_id: string; profile_id: string };
type VaultJob = { id: string; basename: string; bytes: number; asset_id: string };
type BrowserMessage = { externalMessageId?: string; direction?: string; senderType?: string; body?: string; sentAt?: string };
type BrowserThread = { externalThreadId?: string; participantName?: string; participantHandle?: string; unreadCount?: number; observedOpen?: boolean; messages?: BrowserMessage[] };
type RedditNativeJob = {
  id: string; basename: string; bytes: number; extension: string; asset_id: string;
  title: string; caption: string; content_rating: "sfw" | "nsfw"; community_name: string;
  expected_handle: string;
};
type DropboxListEntry = { ".tag"?: string; name?: string; path_display?: string; path_lower?: string; id?: string; size?: number; server_modified?: string; rev?: string };
type DropboxListResult = { entries?: DropboxListEntry[]; has_more?: boolean; cursor?: string };
type DropboxConnection = { id: string; userId: string };
type DropboxThumbnail = { thumbnail?: { s3url?: string; name?: string }; content_type?: string };
type PreviewAsset = { id: string; relative_path: string; extension: string; dropbox_revision: string | null };
type PreviewQueueMessage = { creatorId: string; assetId: string; sourceRevision: string | null };
type PreviewJobAsset = PreviewAsset & { dropbox_root: string; preview_r2_key: string | null; job_revision: string | null; job_status: string };

const COMPOSIO_V31 = "https://backend.composio.dev/api/v3.1";
const COMPOSIO_V3 = "https://backend.composio.dev/api/v3";
const allowedOrigins = new Set(["https://fansly.com", "https://www.reddit.com", "https://reddit.com", "https://thot-os-staging.thot-os.workers.dev"]);

function cors(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": allowedOrigins.has(origin) ? origin : "https://fansly.com",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-thot-os-vault-client,x-thot-os-reddit-client,x-thot-os-installation-id",
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
  const tokenHash = await sha256(token);
  const identity = await env.DB.prepare(`SELECT bc.creator_id,bc.account_id,bc.profile_id,bc.platform
    FROM bridge_credentials bc JOIN browser_profiles bp ON bp.id=bc.profile_id AND bp.creator_id=bc.creator_id
    JOIN account_browser_profiles abp ON abp.creator_id=bc.creator_id AND abp.account_id=bc.account_id AND abp.profile_id=bc.profile_id
    WHERE bc.token_hash=? AND bc.platform='fansly' AND bc.status='active' AND bc.expires_at>CURRENT_TIMESTAMP AND bp.status<>'revoked'`).bind(tokenHash).first<BridgeIdentity>();
  if (identity && !await bindInstallation(request, env, identity.creator_id, identity.profile_id, tokenHash)) return null;
  if (identity) await env.DB.prepare("UPDATE bridge_credentials SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<datetime('now','-5 minutes'))").bind(tokenHash).run();
  return identity;
}

async function authenticateReddit(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 40) return null;
  const tokenHash = await sha256(token);
  const identity = await env.DB.prepare(`SELECT bc.creator_id,bc.account_id,bc.profile_id FROM bridge_credentials bc
    JOIN browser_profiles bp ON bp.id=bc.profile_id AND bp.creator_id=bc.creator_id
    JOIN account_browser_profiles abp ON abp.creator_id=bc.creator_id AND abp.account_id=bc.account_id AND abp.profile_id=bc.profile_id
    WHERE bc.token_hash=? AND bc.platform='reddit' AND bc.status='active' AND bc.expires_at>CURRENT_TIMESTAMP AND bp.status<>'revoked'`).bind(tokenHash).first<RedditBridgeIdentity>();
  if (identity && !await bindInstallation(request, env, identity.creator_id, identity.profile_id, tokenHash)) return null;
  if (identity) await env.DB.prepare("UPDATE bridge_credentials SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash).run();
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>THOT OS device pairing</title></head><body><main><h1>Pairing this Chrome profile…</h1><p>Keep the THOT OS extension enabled. This page contains no third-party scripts and will continue to the selected platform after verification.</p></main></body></html>`;
  return new Response(html, { headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  } });
}

async function getDropboxConnection(env: Env, creatorId: string): Promise<DropboxConnection> {
  const userId = `creator-os:${creatorId}:service:dropbox`;
  const query = new URLSearchParams({ toolkit_slugs: "dropbox", user_ids: userId, statuses: "ACTIVE", limit: "10" });
  const connectionResponse = await fetch(`${COMPOSIO_V31}/connected_accounts?${query}`, {
    headers: { "x-api-key": env.COMPOSIO_API_KEY },
  });
  const connectionPayload = await connectionResponse.json().catch(() => ({})) as {
    items?: Array<{ id?: string; user_id?: string; status?: string; toolkit?: { slug?: string } }>;
    error?: string | { message?: string };
  };
  const connection = connectionPayload.items?.find((item) => item.toolkit?.slug === "dropbox" && item.status === "ACTIVE" && item.user_id === userId && item.id);
  if (!connection) {
    const message = typeof connectionPayload.error === "string" ? connectionPayload.error : connectionPayload.error?.message;
    throw new Error(message || "No active creator-scoped Dropbox connection is available. Reconnect Dropbox before refreshing the catalogue.");
  }
  return { id: connection.id!, userId };
}

async function executeDropboxForConnection<T>(env: Env, connection: DropboxConnection, slug: string, args: Record<string, unknown>) {
  const response = await fetch(`${COMPOSIO_V31}/tools/execute/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.COMPOSIO_API_KEY },
    body: JSON.stringify({ connected_account_id: connection.id, user_id: connection.userId, version: "latest", arguments: args }),
  });
  const payload = await response.json().catch(() => ({})) as { successful?: boolean; data?: T; error?: string | { message?: string } };
  if (!response.ok || payload.successful === false || payload.data === undefined) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    if (message?.includes("path/not_found")) {
      throw new Error("Dropbox could not find this creator’s configured folder. Update the Dropbox folder path in Accounts & connections, then try again.");
    }
    throw new Error(message || `Dropbox request failed (${response.status}).`);
  }
  return payload.data;
}

async function executeDropbox<T>(env: Env, creatorId: string, slug: string, args: Record<string, unknown>) {
  return executeDropboxForConnection<T>(env, await getDropboxConnection(env, creatorId), slug, args);
}

async function startDropboxReconnect(request: Request, env: Env) {
  const input = await request.json().catch(() => null) as { creatorId?: unknown; callbackUrl?: unknown } | null;
  const creatorId = typeof input?.creatorId === "string" ? input.creatorId.trim() : "";
  const callbackUrl = typeof input?.callbackUrl === "string" ? input.callbackUrl.trim() : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(creatorId)) return json(request, { ok: false, error: "invalid_creator" }, 400);
  let callback: URL;
  try { callback = new URL(callbackUrl); } catch { return json(request, { ok: false, error: "invalid_callback" }, 400); }
  if (callback.protocol !== "https:" || callback.username || callback.password) return json(request, { ok: false, error: "invalid_callback" }, 400);
  let service;
  try {
    service = await requireInternalServiceForCreator(request, env.DB, creatorId, "thot-os-web-vault-catalogue", "vault.catalogue.connection.manage");
  } catch {
    return json(request, { ok: false, error: "unauthorized" }, 401);
  }
  await internalServiceAuditStatement(env.DB, service, "/catalogue/dropbox/reconnect").run();
  const connection = await getDropboxConnection(env, creatorId);
  const response = await fetch(`${COMPOSIO_V3}/connected_accounts/${encodeURIComponent(connection.id)}/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.COMPOSIO_API_KEY },
    body: JSON.stringify({ redirect_url: callback.toString() }),
  });
  const payload = await response.json().catch(() => ({})) as { redirect_url?: unknown; error?: string | { message?: string } };
  const redirectUrl = typeof payload.redirect_url === "string" ? payload.redirect_url : "";
  let redirect: URL | null = null;
  try { redirect = new URL(redirectUrl); } catch { /* validated below */ }
  if (!response.ok || !redirect || redirect.protocol !== "https:" || redirect.username || redirect.password) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    return json(request, { ok: false, error: message || "Dropbox reconnection could not be started." }, 502);
  }
  return json(request, { ok: true, redirectUrl: redirect.toString() });
}

async function executeReddit<T>(env: Env, creatorId: string, connectedAccountId: string, slug: string, args: Record<string, unknown>) {
  const response = await fetch(`${COMPOSIO_V31}/tools/execute/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.COMPOSIO_API_KEY },
    body: JSON.stringify({ connected_account_id: connectedAccountId, user_id: `creator-os:${creatorId}:service:reddit`, version: "latest", arguments: args }),
  });
  const payload = await response.json().catch(() => ({})) as { successful?: boolean; data?: T; error?: string | { message?: string } };
  if (!response.ok || payload.successful === false || payload.data === undefined) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || `${slug} failed (${response.status}).`);
  }
  return payload.data;
}

async function listDropboxFiles(env: Env, creatorId: string, path: string) {
  let page = await executeDropbox<DropboxListResult>(env, creatorId, "DROPBOX_LIST_FILES_IN_FOLDER", {
    path,
    recursive: true,
    include_deleted: false,
    limit: 2000,
  });
  const entries = [...(page.entries ?? [])];
  // Dropbox listings are cursor-paginated. Do not index a partial catalogue: either
  // collect every page or leave the existing catalogue unchanged.
  for (let pageNumber = 1; page.has_more; pageNumber += 1) {
    if (!page.cursor || pageNumber >= 50) throw new Error("Dropbox returned an incomplete catalogue; no changes were applied.");
    page = await executeDropbox<DropboxListResult>(env, creatorId, "DROPBOX_LIST_FOLDER_CONTINUE", { cursor: page.cursor });
    entries.push(...(page.entries ?? []));
  }
  return entries;
}

function dropboxPath(root: string, relative: string) {
  return `/${[root, relative].map((part) => part.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
}

function filenameClass(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, "");
  if (/^_?(DSC|DIK|MG|ABC)[_-]?\d/i.test(stem)) return "camera";
  if (stem.length >= 75 && /[_-]/.test(stem)) return "descriptive";
  return "other";
}

function relativeDropboxPath(root: string, entry: DropboxListEntry) {
  const path = entry.path_display || entry.path_lower || "";
  const normalizedRoot = `/${root.replace(/^\/+|\/+$/g, "")}`.replace(/\/$/, "");
  if (!path || !path.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return null;
  return path.slice(normalizedRoot.length + 1);
}

async function refreshDropboxCatalogue(request: Request, env: Env) {
  const input = await request.json().catch(() => null) as { creatorId?: unknown } | null;
  const creatorId = typeof input?.creatorId === "string" ? input.creatorId.trim() : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(creatorId)) return json(request, { ok: false, error: "invalid_creator" }, 400);
  let service;
  try {
    service = await requireInternalServiceForCreator(request, env.DB, creatorId, "thot-os-web-vault-catalogue", "vault.catalogue.refresh");
  } catch {
    return json(request, { ok: false, error: "unauthorized" }, 401);
  }
  const creator = await env.DB.prepare("SELECT dropbox_root FROM creators WHERE id=? AND status='active'").bind(creatorId).first<{ dropbox_root: string | null }>();
  if (!creator?.dropbox_root) return json(request, { ok: false, error: "Dropbox root is not configured for this creator." }, 409);
  await internalServiceAuditStatement(env.DB, service, "/catalogue/refresh").run();
  const entries = await listDropboxFiles(env, creatorId, creator.dropbox_root);
  const supported = new Set(["jpg", "jpeg", "png", "webp", "heic", "mov", "mp4"]);
  const files = entries.flatMap((entry) => {
    if (entry[".tag"] !== "file") return [];
    const relativePath = relativeDropboxPath(creator.dropbox_root!, entry);
    const basename = entry.name?.trim() || "";
    const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!relativePath || !basename || !supported.has(extension) || !entry.server_modified) return [];
    return [{ entry, relativePath, basename, extension }];
  });
  const now = new Date().toISOString();
  const updates = files.map(({ entry, relativePath, basename, extension }) => env.DB.prepare(`INSERT INTO assets
    (id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,repeated_basename,source_available,indexed_at,dropbox_revision)
    VALUES (?,?,?,?,?,?,?,?,0,1,?,?)
    -- The tenant-integrity layer also enforces (id,creator_id). Reconcile that
    -- stable Dropbox identity before the creator/path key so a move updates its row.
    ON CONFLICT(id,creator_id) DO UPDATE SET relative_path=excluded.relative_path,basename=excluded.basename,extension=excluded.extension,bytes=excluded.bytes,
      modified_at=excluded.modified_at,filename_class=excluded.filename_class,source_available=1,indexed_at=excluded.indexed_at,
      preview_r2_key=CASE WHEN assets.dropbox_revision IS excluded.dropbox_revision THEN assets.preview_r2_key ELSE NULL END,
      dropbox_revision=excluded.dropbox_revision
    ON CONFLICT(id) DO UPDATE SET relative_path=excluded.relative_path,basename=excluded.basename,extension=excluded.extension,bytes=excluded.bytes,
      modified_at=excluded.modified_at,filename_class=excluded.filename_class,source_available=1,indexed_at=excluded.indexed_at,
      preview_r2_key=CASE WHEN assets.dropbox_revision IS excluded.dropbox_revision THEN assets.preview_r2_key ELSE NULL END,
      dropbox_revision=excluded.dropbox_revision
      WHERE assets.creator_id=excluded.creator_id
    ON CONFLICT(creator_id,relative_path) DO UPDATE SET basename=excluded.basename,extension=excluded.extension,bytes=excluded.bytes,
      modified_at=excluded.modified_at,filename_class=excluded.filename_class,source_available=1,indexed_at=excluded.indexed_at,
      preview_r2_key=CASE WHEN assets.dropbox_revision IS excluded.dropbox_revision THEN assets.preview_r2_key ELSE NULL END,
      dropbox_revision=excluded.dropbox_revision`)
    .bind(`dropbox:${creatorId}:${entry.id || relativePath}`, creatorId, relativePath, basename, extension, Math.max(0, Math.floor(entry.size || 0)), entry.server_modified, filenameClass(basename), now, entry.rev || null));
  for (let index = 0; index < updates.length; index += 80) await env.DB.batch(updates.slice(index, index + 80));
  // Listing completed before any write, so it is safe to hide source files that
  // were not observed in this catalogue generation. Keep their metadata and
  // private preview objects for audit/recovery, but never offer them for use.
  await env.DB.prepare(`UPDATE assets SET source_available=0
    WHERE creator_id=? AND source_available=1 AND indexed_at<>?`).bind(creatorId, now).run();
  const previews = await enqueueDropboxPreviews(env, creatorId);
  return json(request, { ok: true, assets: files.length, previews });
}

function isJpeg(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  return view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff;
}

async function enqueueDropboxPreviews(env: Env, creatorId: string) {
  const candidates = await env.DB.prepare(`SELECT a.id,a.relative_path,a.extension,a.dropbox_revision FROM assets a
    LEFT JOIN asset_preview_jobs j ON j.creator_id=a.creator_id AND j.asset_id=a.id
    WHERE a.creator_id=? AND a.source_available=1 AND a.preview_r2_key IS NULL
      AND lower(a.extension) IN ('jpg','jpeg','png','webp','heic','mov','mp4')
      AND (j.asset_id IS NULL OR j.status='failed'
        OR (j.status='processing' AND j.updated_at<datetime('now','-15 minutes'))
        OR NOT (j.source_revision IS a.dropbox_revision))
    ORDER BY a.modified_at DESC`).bind(creatorId).all<PreviewAsset>();
  const queued = candidates.results;
  for (let offset = 0; offset < queued.length; offset += 80) {
    const statements = queued.slice(offset, offset + 80).flatMap((asset) => {
      const message = { creatorId, assetId: asset.id, sourceRevision: asset.dropbox_revision } satisfies PreviewQueueMessage;
      const idempotencyKey = `preview-dispatch:${creatorId}:${asset.id}:${asset.dropbox_revision ?? "unversioned"}`;
      return [
        env.DB.prepare(`INSERT INTO asset_preview_jobs
          (id,creator_id,asset_id,source_revision,status,attempts,last_error,queued_at,started_at,completed_at,updated_at)
          VALUES (?,?,?,?,'queued',0,NULL,CURRENT_TIMESTAMP,NULL,NULL,CURRENT_TIMESTAMP)
          ON CONFLICT(creator_id,asset_id) DO UPDATE SET source_revision=excluded.source_revision,status='queued',attempts=0,
            last_error=NULL,queued_at=CURRENT_TIMESTAMP,started_at=NULL,completed_at=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(`preview:${creatorId}:${asset.id}`, creatorId, asset.id, asset.dropbox_revision),
        env.DB.prepare(`INSERT INTO operation_outbox
          (id,creator_id,operation_type,idempotency_key,payload,status,attempts,next_attempt_at,last_error,created_at,updated_at)
          VALUES (?,?,?,?,?,'pending',0,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(idempotency_key) DO UPDATE SET payload=excluded.payload,status='pending',next_attempt_at=CURRENT_TIMESTAMP,
            last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
          .bind(crypto.randomUUID(), creatorId, "preview_dispatch", idempotencyKey, JSON.stringify(message)),
      ];
    });
    await env.DB.batch(statements);
  }
  // Queue delivery is at-least-once.  The durable outbox is committed before a
  // send attempt and is marked delivered only afterwards; replaying a message
  // is safe because the preview consumer claims by creator, asset and revision.
  const pending = await env.DB.prepare(`SELECT id,payload FROM operation_outbox
    WHERE creator_id=? AND operation_type='preview_dispatch' AND status='pending'
      AND unixepoch(next_attempt_at)<=unixepoch(CURRENT_TIMESTAMP)
    ORDER BY created_at LIMIT 500`).bind(creatorId).all<{ id: string; payload: string }>();
  for (let offset = 0; offset < pending.results.length; offset += 100) {
    const batch = pending.results.slice(offset, offset + 100);
    const valid = batch.flatMap((outbox) => {
      try {
        const message = JSON.parse(outbox.payload) as unknown;
        return validPreviewMessage(message) ? [{ outboxId: outbox.id, message }] : [];
      } catch {
        return [];
      }
    });
    const invalid = batch.filter((outbox) => !valid.some((item) => item.outboxId === outbox.id));
    if (invalid.length) await env.DB.batch(invalid.map((outbox) => env.DB.prepare(`UPDATE operation_outbox
      SET status='failed',last_error='Invalid preview outbox payload.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND status='pending'`)
      .bind(outbox.id, creatorId)));
    if (!valid.length) continue;
    await env.PREVIEW_QUEUE.sendBatch(valid.map(({ message }) => ({
      body: message,
      contentType: "json" as const,
    })));
    await env.DB.batch(valid.map(({ outboxId }) => env.DB.prepare(`UPDATE operation_outbox
      SET status='delivered',attempts=attempts+1,delivered_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND creator_id=? AND status='pending'`).bind(outboxId, creatorId)));
  }
  const counts = await env.DB.prepare(`SELECT
      SUM(CASE WHEN a.preview_r2_key IS NOT NULL THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN j.status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN j.status='processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN j.status='failed' THEN 1 ELSE 0 END) AS failed
    FROM assets a LEFT JOIN asset_preview_jobs j ON j.creator_id=a.creator_id AND j.asset_id=a.id
    WHERE a.creator_id=? AND a.source_available=1
      AND lower(a.extension) IN ('jpg','jpeg','png','webp','heic','mov','mp4')`).bind(creatorId)
    .first<{ ready: number | null; queued: number | null; processing: number | null; failed: number | null }>();
  return { ready: counts?.ready ?? 0, queued: counts?.queued ?? 0, processing: counts?.processing ?? 0, failed: counts?.failed ?? 0 };
}

async function generateDropboxPreview(env: Env, connection: DropboxConnection, creatorId: string, root: string, asset: PreviewAsset) {
  const thumbnail = await executeDropboxForConnection<DropboxThumbnail>(env, connection, "DROPBOX_GET_THUMBNAIL", {
    path: dropboxPath(root, asset.relative_path), size: "w480h320", format: "jpeg", mode: "bestfit",
  });
  const sourceUrl = thumbnail.thumbnail?.s3url;
  if (!sourceUrl) throw new Error("Dropbox did not return a preview URL.");
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:") throw new Error("Dropbox returned an unsafe preview URL.");
  const response = await fetch(url, { headers: { accept: "image/jpeg" } });
  const length = Number(response.headers.get("content-length") || "0");
  if (!response.ok || (Number.isFinite(length) && length > 5_000_000)) throw new Error("Dropbox preview download was unavailable.");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 5_000_000 || !isJpeg(bytes)) throw new Error("Dropbox returned an invalid preview image.");
  const objectId = await sha256(`${creatorId}:${asset.id}`);
  const revisionId = await sha256(asset.dropbox_revision ?? "unversioned");
  const key = `creators/${creatorId}/assets/${objectId}/previews/${revisionId}.jpg`;
  await env.PREVIEWS.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "private, max-age=86400" },
    customMetadata: { creatorId, assetId: asset.id, revision: asset.dropbox_revision || "" },
  });
  const updated = await env.DB.prepare(`UPDATE assets SET preview_r2_key=?
    WHERE id=? AND creator_id=? AND preview_r2_key IS NULL AND dropbox_revision IS ?`)
    .bind(key, asset.id, creatorId, asset.dropbox_revision).run();
  return Boolean(updated.meta.changes);
}

function validPreviewMessage(value: unknown): value is PreviewQueueMessage {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<PreviewQueueMessage>;
  return typeof input.creatorId === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(input.creatorId)
    && typeof input.assetId === "string" && input.assetId.length > 0 && input.assetId.length <= 500
    && (input.sourceRevision === null || typeof input.sourceRevision === "string");
}

function permanentPreviewFailure(message: string) {
  return /path\/not_found|could not find|unsafe preview URL|invalid preview image|No active creator-scoped Dropbox connection/i.test(message);
}

async function processPreviewMessage(env: Env, input: PreviewQueueMessage) {
  const asset = await env.DB.prepare(`SELECT a.id,a.relative_path,a.extension,a.dropbox_revision,a.preview_r2_key,
      c.dropbox_root,j.source_revision AS job_revision,j.status AS job_status
    FROM assets a JOIN creators c ON c.id=a.creator_id
    JOIN asset_preview_jobs j ON j.creator_id=a.creator_id AND j.asset_id=a.id
    WHERE a.id=? AND a.creator_id=? AND a.source_available=1 AND c.status='active'`)
    .bind(input.assetId, input.creatorId).first<PreviewJobAsset>();
  if (!asset || !(asset.job_revision === input.sourceRevision) || !(asset.dropbox_revision === input.sourceRevision)) return;
  if (asset.preview_r2_key) {
    await env.DB.prepare("UPDATE asset_preview_jobs SET status='ready',last_error=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND asset_id=? AND source_revision IS ?")
      .bind(input.creatorId, input.assetId, input.sourceRevision).run();
    return;
  }
  const claimed = await env.DB.prepare(`UPDATE asset_preview_jobs SET status='processing',attempts=attempts+1,
      started_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE creator_id=? AND asset_id=? AND source_revision IS ? AND status='queued'`)
    .bind(input.creatorId, input.assetId, input.sourceRevision).run();
  if (!claimed.meta.changes) return;
  const connection = await getDropboxConnection(env, input.creatorId);
  await generateDropboxPreview(env, connection, input.creatorId, asset.dropbox_root, asset);
  await env.DB.prepare(`UPDATE asset_preview_jobs SET status='ready',last_error=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE creator_id=? AND asset_id=? AND source_revision IS ?`)
    .bind(input.creatorId, input.assetId, input.sourceRevision).run();
}

async function recordPreviewFailure(env: Env, input: PreviewQueueMessage, message: string, status: "queued" | "failed") {
  await env.DB.prepare(`UPDATE asset_preview_jobs SET status=?,last_error=?,completed_at=CASE WHEN ?='failed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
      updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND asset_id=? AND source_revision IS ?`)
    .bind(status, message.slice(0, 1000), status, input.creatorId, input.assetId, input.sourceRevision).run();
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
    SELECT a.relative_path,c.dropbox_root
    FROM vault_upload_jobs j
    JOIN assets a ON a.id=j.asset_id AND a.creator_id=j.creator_id
    JOIN creators c ON c.id=j.creator_id
    WHERE j.id=? AND j.creator_id=? AND j.account_id=? AND j.platform='fansly' AND j.status IN ('claimed','staged')
  `).bind(jobId, identity.creator_id, identity.account_id).first<{ relative_path: string; dropbox_root: string }>();
  if (!job) return json(request, { ok: false, error: "Vault media is not available for this device." }, 404);
  const temporary = await executeDropbox<{ link?: string }>(env, identity.creator_id, "DROPBOX_GET_TEMPORARY_LINK", { path: dropboxPath(job.dropbox_root, job.relative_path) });
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
      AND oa.publishing_mode='local_bridge' AND oa.publishing_authority='device_only'
      AND (p.device_claimed_at IS NULL OR p.device_claimed_at<datetime('now','-10 minutes'))
    ORDER BY COALESCE(p.scheduled_at,p.created_at) LIMIT 1
  `).bind(identity.creator_id, identity.account_id).first<RedditNativeJob>();
  if (!candidate) return json(request, { ok: true, job: null });
  const claimed = await env.DB.prepare(`
    UPDATE social_posts SET device_claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND creator_id=? AND account_id=? AND status='publishing'
      AND (device_claimed_at IS NULL OR device_claimed_at<datetime('now','-10 minutes'))
      AND EXISTS (
        SELECT 1 FROM operational_accounts oa
        WHERE oa.id=social_posts.account_id AND oa.creator_id=social_posts.creator_id
          AND oa.platform='reddit' AND oa.publishing_mode='local_bridge' AND oa.publishing_authority='device_only'
      )
  `).bind(candidate.id, identity.creator_id, identity.account_id).run();
  if (!claimed.meta.changes) return json(request, { ok: true, job: null });
  await env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:reddit-device','service','native_job_claimed','{}')")
    .bind(crypto.randomUUID(), candidate.id, identity.creator_id).run();
  return json(request, { ok: true, job: { ...candidate, mediaUrl: `${new URL(request.url).origin}/reddit/jobs/${encodeURIComponent(candidate.id)}/media` } });
}

async function redditMediaResponse(request: Request, env: Env, identity: RedditBridgeIdentity, postId: string) {
  const media = await env.DB.prepare(`
    SELECT a.relative_path,c.dropbox_root
    FROM social_posts p
    JOIN assets a ON a.id=p.asset_id AND a.creator_id=p.creator_id
    JOIN creators c ON c.id=p.creator_id
    JOIN operational_accounts oa ON oa.id=p.account_id AND oa.creator_id=p.creator_id
    WHERE p.id=? AND p.creator_id=? AND p.account_id=? AND p.platform='reddit' AND p.status='publishing' AND p.device_claimed_at IS NOT NULL
      AND oa.publishing_mode='local_bridge' AND oa.publishing_authority='device_only'
  `).bind(postId, identity.creator_id, identity.account_id).first<{ relative_path: string; dropbox_root: string }>();
  if (!media) return json(request, { ok: false, error: "Reddit media is not available for this paired device." }, 404);
  const temporary = await executeDropbox<{ link?: string }>(env, identity.creator_id, "DROPBOX_GET_TEMPORARY_LINK", { path: dropboxPath(media.dropbox_root, media.relative_path) });
  if (!temporary.link) return json(request, { ok: false, error: "Dropbox did not return the approved file." }, 502);
  const source = await fetch(temporary.link);
  if (!source.ok || !source.body) return json(request, { ok: false, error: `Dropbox media download failed (${source.status}).` }, 502);
  return new Response(source.body, {
    status: 200,
    headers: {
      "content-type": source.headers.get("content-type") ?? "application/octet-stream",
      ...(source.headers.get("content-length") ? { "content-length": source.headers.get("content-length")! } : {}),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...cors(request),
    },
  });
}

async function verifyRedditNativePost(externalUrl: URL, externalId: string, post: { title: string; expected_handle: string; community_name: string }, deviceMetadata?: RedditPublicPost) {
  let published: RedditPublicPost | undefined;
  let status = 0;
  for (let attempt = 0; attempt < 6 && !published; attempt += 1) {
    const response = await fetch(`https://www.reddit.com/comments/${encodeURIComponent(externalId)}.json?raw_json=1`, {
      headers: { accept: "application/json", "user-agent": "THOT-OS-Receipt-Verifier/1.0" },
    });
    status = response.status;
    if (response.ok) {
      const payload = await response.json().catch(() => null) as Array<{ data?: { children?: Array<{ data?: RedditPublicPost }> } }> | null;
      published = payload?.[0]?.data?.children?.[0]?.data;
    }
    if (!published && attempt < 5 && (response.ok || response.status === 404 || response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else if (!published) break;
  }
  if (!published && deviceMetadata) published = deviceMetadata;
  if (!published && status && status !== 200) throw new Error(`Reddit receipt verification returned ${status}.`);
  if (!published) throw new Error("Reddit did not return the submitted post metadata.");
  return { ...verifyRedditPostMetadata(published, externalId, post), verifiedUrl: externalUrl.toString() };
}

async function recordRedditReceipt(request: Request, env: Env, identity: RedditBridgeIdentity, postId: string) {
  const input = await request.json<{ status?: string; error?: string; externalUrl?: string; externalPostId?: string; observedHandle?: string; uncertain?: boolean; receipt?: unknown }>();
  const post = await env.DB.prepare(`
    SELECT p.id,p.caption,p.title,p.status,rc.name AS community_name,oa.handle AS expected_handle,
      oa.publishing_mode,oa.publishing_authority,pc.connected_account_id
    FROM social_posts p JOIN operational_accounts oa ON oa.id=p.account_id AND oa.creator_id=p.creator_id
    JOIN reddit_communities rc ON rc.id=p.community_id AND rc.creator_id=p.creator_id
    LEFT JOIN provider_connections pc ON pc.creator_id=p.creator_id AND pc.service='reddit' AND pc.status='active'
    WHERE p.id=? AND p.creator_id=? AND p.account_id=? AND p.platform='reddit'
  `).bind(postId, identity.creator_id, identity.account_id).first<{ id: string; caption: string; title: string; status: string; community_name: string; expected_handle: string; publishing_mode: string; publishing_authority: string; connected_account_id: string | null }>();
  if (!post || post.status !== "publishing" || post.publishing_mode !== "local_bridge" || post.publishing_authority !== "device_only") {
    return json(request, { ok: false, error: "Reddit publishing is owned by the API and is not awaiting a device receipt." }, 409);
  }
  const observedHandle = normaliseHandle(input.observedHandle ?? "");
  const expectedHandle = normaliseHandle(post.expected_handle);
  if (input.status === "published" && observedHandle !== expectedHandle) return json(request, { ok: false, error: "The signed-in Reddit browser does not match this creator’s configured account." }, 409);
  const receipt = JSON.stringify(input.receipt ?? {}).slice(0, 12000);
  const receiptRecord = input.receipt && typeof input.receipt === "object" && !Array.isArray(input.receipt) ? input.receipt as Record<string, unknown> : {};
  if (input.status !== "published") {
    const identityWarning = observedHandle && observedHandle !== expectedHandle ? `The paired browser reported u/${observedHandle}, expected u/${expectedHandle}. ` : "";
    const uncertaintyWarning = input.uncertain ? "Outcome uncertain; verify Reddit before retrying. " : "";
    const error = `${identityWarning}${uncertaintyWarning}${String(input.error || "Native Reddit publishing failed.")}`.slice(0, 2000);
    await env.DB.batch([
      env.DB.prepare("UPDATE social_posts SET status='failed',error=?,device_receipt=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND account_id=? AND status='publishing'").bind(error, receipt, postId, identity.creator_id, identity.account_id),
      env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:reddit-device','service','native_publish_failed',?)").bind(crypto.randomUUID(), postId, identity.creator_id, JSON.stringify({ error, uncertain: Boolean(input.uncertain) })),
    ]);
    return json(request, { ok: true, status: "failed" });
  }
  let externalUrl: URL;
  try { externalUrl = new URL(String(input.externalUrl ?? "")); }
  catch { return json(request, { ok: false, error: "Reddit did not return a valid post URL." }, 400); }
  const postMatch = externalUrl.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i);
  if (!/(^|\.)reddit\.com$/i.test(externalUrl.hostname) || !postMatch) return json(request, { ok: false, error: "The native receipt is not a Reddit post URL." }, 400);
  const redditId = postMatch[1];
  const externalPostId = `t3_${redditId}`;
  const deviceMetadata = receiptRecord.redditMetadata && typeof receiptRecord.redditMetadata === "object" && !Array.isArray(receiptRecord.redditMetadata)
    ? receiptRecord.redditMetadata as RedditPublicPost
    : undefined;
  const verification = await verifyRedditNativePost(externalUrl, redditId, post, deviceMetadata);
  if (!verification.nativeMedia) {
    const error = "Reddit created a text or link post without the approved native media. THOT OS did not accept it as published.";
    await env.DB.batch([
      env.DB.prepare("UPDATE social_posts SET status='failed',external_post_id=?,external_url=?,error=?,device_receipt=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND account_id=? AND status='publishing'").bind(externalPostId, externalUrl.toString(), error, receipt, postId, identity.creator_id, identity.account_id),
      env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:reddit-device','service','native_publish_rejected',?)").bind(crypto.randomUUID(), postId, identity.creator_id, JSON.stringify({ externalPostId, externalUrl: externalUrl.toString(), error, isSelf: verification.published.is_self === true, domain: verification.published.domain ?? null })),
    ]);
    return json(request, { ok: true, status: "failed", error, externalPostId, externalUrl: externalUrl.toString() });
  }
  let warning = "";
  if (post.caption.trim() && post.caption.trim() !== post.title.trim() && receiptRecord.bodyFilled !== true) {
    if (!post.connected_account_id) warning = "Post published, but the caption comment could not be added because Reddit OAuth is unavailable.";
    else {
      try { await executeReddit(env, identity.creator_id, post.connected_account_id, "REDDIT_POST_REDDIT_COMMENT", { thing_id: externalPostId, text: post.caption }); }
      catch (error) { warning = `Post published, but the caption comment failed: ${error instanceof Error ? error.message : "Unknown error"}`; }
    }
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE social_posts SET status='published',published_at=CURRENT_TIMESTAMP,external_post_id=?,external_url=?,error=?,device_receipt=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=? AND account_id=? AND status='publishing'").bind(externalPostId, externalUrl.toString(), warning || null, receipt, postId, identity.creator_id, identity.account_id),
    env.DB.prepare("INSERT INTO social_post_events (id,post_id,creator_id,actor,actor_role,event_type,detail) VALUES (?,?,?,'service:reddit-device','service','native_publish_completed',?)").bind(crypto.randomUUID(), postId, identity.creator_id, JSON.stringify({ externalPostId, externalUrl: externalUrl.toString(), warning })),
    env.DB.prepare("UPDATE operational_accounts SET connection_status='connected',publishing_mode='local_bridge',publishing_authority='device_only',last_success_at=CURRENT_TIMESTAMP,last_checked_at=CURRENT_TIMESTAMP,warning_level='none',warning_message='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND creator_id=?").bind(identity.account_id, identity.creator_id),
  ]);
  return json(request, { ok: true, status: "published", externalPostId, externalUrl: externalUrl.toString(), warning });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/pair") return pairingPage();
      if (request.method === "POST" && url.pathname === "/catalogue/refresh") return refreshDropboxCatalogue(request, env);
      if (request.method === "POST" && url.pathname === "/catalogue/dropbox/reconnect") return startDropboxReconnect(request, env);
      if (url.pathname === "/reddit" || url.pathname.startsWith("/reddit/")) {
        const identity = await authenticateReddit(request, env);
        if (!identity) return json(request, { ok: false, error: "unauthorized" }, 401);
        if (request.method === "GET" && url.pathname === "/reddit/status") {
          const account = await env.DB.prepare("SELECT handle,publishing_mode,publishing_authority FROM operational_accounts WHERE id=? AND creator_id=? AND platform='reddit'").bind(identity.account_id, identity.creator_id).first<{ handle: string; publishing_mode: string; publishing_authority: string }>();
          const devicePublishing = account?.publishing_mode === "local_bridge" && account.publishing_authority === "device_only";
          return json(request, { ok: true, paired: devicePublishing, platform: "reddit", expected_handle: account?.handle ?? "", publishing_mode: account?.publishing_mode ?? "", ...identity });
        }
        if (request.method === "GET" && url.pathname === "/reddit/jobs/claim") return claimRedditJob(request, env, identity);
        const media = url.pathname.match(/^\/reddit\/jobs\/([^/]+)\/media$/);
        if (request.method === "GET" && media) return redditMediaResponse(request, env, identity, decodeURIComponent(media[1]));
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
  async queue(batch: MessageBatch<PreviewQueueMessage>, env: Env): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => {
      const input = message.body;
      if (!validPreviewMessage(input)) {
        console.error(JSON.stringify({ event: "dropbox_preview_invalid_message", messageId: message.id }));
        message.ack();
        return;
      }
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
        console.warn(JSON.stringify({ event: "dropbox_preview_retry", creatorId: input.creatorId, assetId: input.assetId, attempt: message.attempts, message: detail }));
        if (permanentPreviewFailure(detail)) {
          await recordPreviewFailure(env, input, detail, "failed");
          message.ack();
        } else {
          await recordPreviewFailure(env, input, detail, "queued");
          message.retry({ delaySeconds: Math.min(30 * (2 ** Math.max(0, message.attempts - 1)), 900) });
        }
      }
    }));
  },
} satisfies ExportedHandler<Env, PreviewQueueMessage>;
