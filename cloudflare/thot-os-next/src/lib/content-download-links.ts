export type DownloadActor = { creatorId: string; email: string };
type LinkObject = { id: string; creator_id: string; asset_id: string; title: string; object_key: string; byte_count: number; mime_type: string; sha256: string; r2_version: string; r2_etag: string; expires_at: string };
type LinkListItem = { id: string; title: string; created_at: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const actorRoles = "'agency_admin','operator','creator'";

function timestamp(value?: string) {
  const time = value ? Date.parse(value) : Date.now();
  if (!Number.isFinite(time)) throw new Error("Invalid timestamp.");
  return new Date(time).toISOString();
}

function after(now: string, milliseconds: number) { return new Date(Date.parse(now) + milliseconds).toISOString(); }
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function randomId() { return crypto.randomUUID(); }
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function validToken(value: string) { return /^[0-9a-f]{64}$/i.test(value); }
function validActor(actor: DownloadActor) { return Boolean(actor.creatorId && actor.email && actor.email.length <= 254); }

const activeIssuer = `EXISTS (
  SELECT 1 FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email)
  WHERE m.creator_id=l.creator_id AND lower(m.user_email)=lower(l.created_by)
    AND m.status='active' AND u.status='active' AND m.role IN (${actorRoles})
)`;
const currentEligibility = `
  JOIN creators cr ON cr.id=l.creator_id AND cr.status='active'
  JOIN assets a ON a.id=l.asset_id AND a.creator_id=l.creator_id AND a.source_available=1
  JOIN asset_storage_objects o ON o.id=l.storage_object_id AND o.creator_id=l.creator_id AND o.asset_id=l.asset_id
    AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
    AND o.object_key=l.object_key AND o.byte_count=l.byte_count AND o.verified_mime_type=l.mime_type
    AND o.sha256=l.sha256 AND o.r2_version=l.r2_version AND o.r2_etag=l.r2_etag
  JOIN asset_media_authorities ma ON ma.asset_id=l.asset_id AND ma.creator_id=l.creator_id
    AND ma.authority_kind='r2_native' AND ma.canonical_storage_object_id=l.storage_object_id
    AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
  JOIN asset_video_playback_states vp ON vp.asset_id=l.asset_id AND vp.creator_id=l.creator_id
    AND vp.canonical_storage_object_id=l.storage_object_id
    AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')
  JOIN asset_classifications c ON c.asset_id=l.asset_id AND c.creator_id=l.creator_id AND c.safety IN ('sfw','nsfw') AND c.is_multi=0
`;
const availableLink = `${currentEligibility} WHERE ${activeIssuer}
  AND l.token_hash=? AND l.redeemed_at IS NULL AND l.revoked_at IS NULL AND unixepoch(l.expires_at)>unixepoch(?)
  AND NOT EXISTS (SELECT 1 FROM asset_people ap WHERE ap.creator_id=l.creator_id AND ap.asset_id=l.asset_id)`;

export async function createContentDownloadLink(DB: D1Database, input: { actor: DownloadActor; assetId: string; title: string; sharingConfirmed: boolean; now?: string; token?: string; id?: string }) {
  const now = timestamp(input.now);
  const title = input.title.trim();
  if (!validActor(input.actor) || !input.assetId || input.sharingConfirmed !== true || !title || title.length > 120) throw new Error("Download link is not eligible.");
  const token = input.token ?? randomToken();
  if (!validToken(token)) throw new Error("Invalid download token.");
  const tokenHash = await sha256(token);
  const id = input.id ?? randomId();
  const expiresAt = after(now, DAY_MS);
  const source = await DB.prepare(`SELECT o.id AS storage_object_id,o.object_key,o.byte_count,o.verified_mime_type,o.sha256,o.r2_version,o.r2_etag
    FROM assets a JOIN creators cr ON cr.id=a.creator_id AND cr.status='active'
    JOIN asset_storage_objects o ON o.asset_id=a.id AND o.creator_id=a.creator_id
    JOIN asset_media_authorities ma ON ma.asset_id=a.id AND ma.creator_id=a.creator_id AND ma.authority_kind='r2_native' AND ma.canonical_storage_object_id=o.id
      AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
    JOIN asset_video_playback_states vp ON vp.asset_id=a.id AND vp.creator_id=a.creator_id AND vp.canonical_storage_object_id=o.id
    JOIN asset_classifications c ON c.asset_id=a.id AND c.creator_id=a.creator_id
    WHERE a.id=? AND a.creator_id=? AND a.source_available=1 AND c.safety IN ('sfw','nsfw') AND c.is_multi=0
      AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
      AND o.verified_mime_type LIKE 'video/%' AND o.r2_version IS NOT NULL AND o.r2_etag IS NOT NULL
      AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed')
      AND EXISTS (SELECT 1 FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email)
        WHERE m.creator_id=a.creator_id AND lower(m.user_email)=lower(?) AND m.status='active' AND u.status='active' AND m.role IN (${actorRoles}))
      AND NOT EXISTS (SELECT 1 FROM asset_people ap WHERE ap.creator_id=a.creator_id AND ap.asset_id=a.id)
    LIMIT 1`).bind(input.assetId, input.actor.creatorId, input.actor.email).first<{ storage_object_id: string; object_key: string; byte_count: number; verified_mime_type: string; sha256: string; r2_version: string; r2_etag: string }>();
  if (!source) throw new Error("Download link is not eligible.");
  await DB.prepare(`INSERT INTO content_download_links
    (id,creator_id,asset_id,storage_object_id,title,object_key,byte_count,mime_type,sha256,r2_version,r2_etag,token_hash,expires_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, input.actor.creatorId, input.assetId, source.storage_object_id, title, source.object_key, source.byte_count, source.verified_mime_type, source.sha256, source.r2_version, source.r2_etag, tokenHash, expiresAt, input.actor.email.toLowerCase(), now).run();
  return { id, token, expiresAt };
}

export async function inspectContentDownloadLink(DB: D1Database, input: { token: string; now?: string }) {
  if (!validToken(input.token)) return null;
  const now = timestamp(input.now);
  const tokenHash = await sha256(input.token);
  const link = await DB.prepare(`SELECT l.id,l.creator_id,l.asset_id,l.title,l.object_key,l.byte_count,l.mime_type,l.sha256,l.r2_version,l.r2_etag,l.expires_at FROM content_download_links l ${availableLink}`)
    .bind(tokenHash, now).first<LinkObject>();
  return link ? { id: link.id, creatorId: link.creator_id, assetId: link.asset_id, title: link.title, byteCount: link.byte_count, mimeType: link.mime_type, expiresAt: link.expires_at } : null;
}

export async function claimContentDownloadLink(DB: D1Database, input: { token: string; now?: string; sessionToken?: string; sessionId?: string }) {
  if (!validToken(input.token)) return null;
  const now = timestamp(input.now);
  const tokenHash = await sha256(input.token);
  const sessionToken = input.sessionToken ?? randomToken();
  if (!validToken(sessionToken)) throw new Error("Invalid session token.");
  const sessionId = input.sessionId ?? randomId();
  const sessionHash = await sha256(sessionToken);
  const sessionExpiresAt = after(now, HOUR_MS);
  const link = await DB.prepare(`UPDATE content_download_links AS l
    SET redeemed_at=?,session_id=?,session_token_hash=?,session_expires_at=?
    WHERE l.token_hash=? AND l.redeemed_at IS NULL AND l.revoked_at IS NULL AND unixepoch(l.expires_at)>unixepoch(?)
      AND EXISTS (SELECT 1 FROM creators cr WHERE cr.id=l.creator_id AND cr.status='active')
      AND EXISTS (SELECT 1 FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email)
        WHERE m.creator_id=l.creator_id AND lower(m.user_email)=lower(l.created_by) AND m.status='active' AND u.status='active' AND m.role IN (${actorRoles}))
      AND EXISTS (SELECT 1 FROM assets a JOIN asset_storage_objects o ON o.id=l.storage_object_id AND o.creator_id=l.creator_id AND o.asset_id=l.asset_id
        JOIN asset_media_authorities ma ON ma.asset_id=l.asset_id AND ma.creator_id=l.creator_id AND ma.authority_kind='r2_native' AND ma.canonical_storage_object_id=l.storage_object_id
          AND ma.state IN ('canonical_verified','preview_ready','preview_failed')
        JOIN asset_video_playback_states vp ON vp.asset_id=l.asset_id AND vp.creator_id=l.creator_id AND vp.canonical_storage_object_id=l.storage_object_id
        JOIN asset_classifications c ON c.asset_id=l.asset_id AND c.creator_id=l.creator_id
        WHERE a.id=l.asset_id AND a.creator_id=l.creator_id AND a.source_available=1 AND c.safety IN ('sfw','nsfw') AND c.is_multi=0
          AND o.provider='r2' AND o.storage_role='canonical_original' AND o.bucket_role='library_media' AND o.ingest_status='verified'
          AND o.object_key=l.object_key AND o.byte_count=l.byte_count AND o.verified_mime_type=l.mime_type AND o.sha256=l.sha256 AND o.r2_version=l.r2_version AND o.r2_etag=l.r2_etag
          AND vp.state IN ('canonical_verified','processing_queued','processing','playback_ready','processing_failed'))
      AND NOT EXISTS (SELECT 1 FROM asset_people ap WHERE ap.creator_id=l.creator_id AND ap.asset_id=l.asset_id)
    RETURNING id,title,byte_count,mime_type,session_expires_at`).bind(now, sessionId, sessionHash, sessionExpiresAt, tokenHash, now)
    .first<{ id: string; title: string; byte_count: number; mime_type: string; session_expires_at: string }>();
  return link ? { linkId: link.id, sessionToken, expiresAt: link.session_expires_at, title: link.title, byteCount: link.byte_count, mimeType: link.mime_type } : null;
}

export async function getContentDownloadSession(DB: D1Database, input: { linkToken: string; sessionToken: string; now?: string }) {
  if (!validToken(input.linkToken) || !validToken(input.sessionToken)) return null;
  const now = timestamp(input.now);
  const [tokenHash, sessionHash] = await Promise.all([sha256(input.linkToken), sha256(input.sessionToken)]);
  const link = await DB.prepare(`SELECT l.id,l.creator_id,l.asset_id,l.title,l.object_key,l.byte_count,l.mime_type,l.sha256,l.r2_version,l.r2_etag,l.session_expires_at FROM content_download_links l ${currentEligibility}
    WHERE ${activeIssuer} AND l.token_hash=? AND l.session_token_hash=? AND l.revoked_at IS NULL
      AND unixepoch(l.session_expires_at)>unixepoch(?)
      AND NOT EXISTS (SELECT 1 FROM asset_people ap WHERE ap.creator_id=l.creator_id AND ap.asset_id=l.asset_id)`).bind(tokenHash, sessionHash, now).first<LinkObject & { session_expires_at: string }>();
  return link ? { linkId: link.id, creatorId: link.creator_id, assetId: link.asset_id, title: link.title, objectKey: link.object_key, byteCount: link.byte_count, mimeType: link.mime_type, sha256: link.sha256, r2Version: link.r2_version, r2Etag: link.r2_etag, expiresAt: link.session_expires_at } : null;
}

async function activeActor(DB: D1Database, actor: DownloadActor) {
  if (!validActor(actor)) return false;
  return Boolean(await DB.prepare(`SELECT 1 FROM creator_memberships m JOIN users u ON lower(u.email)=lower(m.user_email) JOIN creators c ON c.id=m.creator_id
    WHERE m.creator_id=? AND lower(m.user_email)=lower(?) AND m.status='active' AND u.status='active' AND c.status='active' AND m.role IN (${actorRoles}) LIMIT 1`).bind(actor.creatorId, actor.email).first());
}

export async function revokeContentDownloadLink(DB: D1Database, input: { actor: DownloadActor; linkId: string; now?: string }) {
  if (!await activeActor(DB, input.actor)) return false;
  const result = await DB.prepare("UPDATE content_download_links SET revoked_at=COALESCE(revoked_at,?),revoked_by=COALESCE(revoked_by,?) WHERE id=? AND creator_id=?").bind(timestamp(input.now), input.actor.email.toLowerCase(), input.linkId, input.actor.creatorId).run();
  return Boolean(result.meta?.changes);
}

export async function listContentDownloadLinks(DB: D1Database, input: { actor: DownloadActor; assetId: string; now?: string }) {
  if (!await activeActor(DB, input.actor) || !input.assetId) return [];
  const now = timestamp(input.now);
  const rows = await DB.prepare(`SELECT id,title,created_at,expires_at,redeemed_at,revoked_at FROM content_download_links
    WHERE creator_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 20`).bind(input.actor.creatorId, input.assetId).all<LinkListItem>();
  return rows.results.map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, expiresAt: row.expires_at, status: row.revoked_at ? "revoked" : row.redeemed_at ? "redeemed" : Date.parse(row.expires_at) <= Date.parse(now) ? "expired" : "active" }));
}
