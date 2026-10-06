import { getContentDownloadSession, claimContentDownloadLink, inspectContentDownloadLink, getExpiredDownloadCreator } from "../../thot-os-next/src/lib/content-download-links.ts";
import { safePublicProfileUrl } from "../../thot-os-next/src/lib/profile-public-url.ts";
import { parseSingleRange } from "../../thot-os-next/src/lib/source-media-algorithms.ts";
import { immutableR2IdentityMatches } from "../../shared/source-media-integrity.ts";

type Link = { title: string; byteCount: number; mimeType: string; expiresAt: string; creatorName?: string | null; customMessage?: string | null };
type Session = Link & { objectKey: string; r2Version: string | null; r2Etag: string | null };
type Env = { DB: D1Database; LIBRARY_MEDIA: R2Bucket; ENABLED?: string; SAFE_PUBLIC_PROFILE_BASE_URL?: string };

const TOKEN = /^[A-Za-z0-9_-]{16,256}$/;

function securityHeaders(extra: HeadersInit = {}) {
  return new Headers({
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
    ...extra,
  });
}

function unavailable(status = 404) { return new Response("Not found", { status, headers: securityHeaders({ "content-type": "text/plain; charset=utf-8" }) }); }
function tokenFrom(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  if ((parts.length !== 2 && (parts.length !== 3 || parts[2] !== "download")) || parts[0] !== "d" || !TOKEN.test(parts[1])) return null;
  return parts[1];
}
function html(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function cookieName(token: string) { return `download_session_${token}`; }
function sessionCookie(request: Request, token: string) {
  const prefix = `${cookieName(token)}=`;
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) ?? null;
}
function loopback(hostname: string) { return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"; }
function cookie(url: URL, token: string, value: string, expiresAt: string) {
  return `${cookieName(token)}=${value}; Path=/d/${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; ${loopback(url.hostname) ? "" : "Secure; "}Expires=${new Date(expiresAt).toUTCString()}`;
}
function filename(title: string, mimeType: string) {
  const cleaned = title.replace(/[\\/\r\n"]/g, " ").replace(/[^\x20-\x7e]/g, "_").trim().slice(0, 120);
  const extension = ({ "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } as Record<string, string>)[mimeType] ?? "video";
  return `${cleaned || "download"}.${extension}`;
}

async function randomToken() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function size(bytes: number) { return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`; }

function expiryLabel(value: string) {
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

const DOWNLOAD_CSS = `:root{color-scheme:light;--ink:hsl(344 12% 11%);--muted:hsl(344 7% 38%);--line:var(--ink);--pink:hsl(344 100% 82%);--paper:hsl(344 14% 97%)}*{box-sizing:border-box}body{min-height:100vh;margin:0;padding:24px;display:grid;place-items:center;background-color:var(--paper);background-image:linear-gradient(#211f2010 1px,transparent 1px),linear-gradient(90deg,#211f2010 1px,transparent 1px);background-size:24px 24px;color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.download{width:min(100%,34rem);padding:clamp(24px,7vw,48px);border:3px solid var(--ink);background:var(--paper);box-shadow:8px 8px 0 var(--ink)}.wordmark{margin:0 0 30px;padding:12px;border:3px solid var(--ink);background:var(--pink);font-size:.78rem;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.creator{overflow-wrap:anywhere;margin:0 0 10px;color:var(--muted);font-size:.95rem}.download h1{margin:0;overflow-wrap:anywhere;font-size:clamp(1.65rem,7vw,2.3rem);line-height:1.12;letter-spacing:-.035em}.message{white-space:pre-wrap;overflow-wrap:anywhere;margin:24px 0 0;padding:16px;border-left:3px solid var(--ink);background:white}.details{margin:14px 0 0;color:var(--muted);font-size:.92rem}.expiry{margin:28px 0 0;padding-top:18px;border-top:3px solid var(--ink);color:var(--muted);font-size:.9rem}.expiry strong{color:var(--ink)}form{margin:24px 0 0}button,.resume{display:inline-flex;min-height:50px;align-items:center;justify-content:center;padding:12px 22px;border:3px solid var(--ink);background:var(--pink);box-shadow:4px 4px 0 var(--ink);color:var(--ink);font:inherit;font-weight:850;text-decoration:none;cursor:pointer}button:hover,.resume:hover{box-shadow:none;transform:translate(4px,4px)}button:focus-visible,.resume:focus-visible{outline:3px solid var(--ink);outline-offset:5px}@media(max-width:360px){body{padding:12px}.download{padding:22px 18px}}`;

function stylesheet() {
  return new Response(DOWNLOAD_CSS, { headers: securityHeaders({ "content-type": "text/css; charset=utf-8" }) });
}

async function metadata(request: Request, env: Env, token: string) {
  const link = await inspectContentDownloadLink(env.DB, { token }) as Link | null;
  const session = !link && sessionCookie(request, token) ? await getContentDownloadSession(env.DB, { linkToken: token, sessionToken: sessionCookie(request, token)! }) as Session | null : null;
  const item = link ?? session;
  if (!item) {
    const creator = await getExpiredDownloadCreator(env.DB, { token }) as { creatorName: string; creatorSlug: string } | null;
    if (!creator) return unavailable();
    const profileUrl = safePublicProfileUrl(env.SAFE_PUBLIC_PROFILE_BASE_URL, creator.creatorSlug);
    const explore = profileUrl
      ? `Explore more from <a href="${html(profileUrl)}" rel="noreferrer">${html(creator.creatorName)}</a>.`
      : `Explore more from ${html(creator.creatorName)}.`;
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/download.css"><title>Download unavailable</title></head><body><main class="download"><p class="wordmark">THOT OS</p><h1>This download is unavailable</h1><p class="details">This download link or session has expired.</p><p class="expiry">${explore}</p></main></body></html>`;
    return new Response(body, { headers: securityHeaders({ "content-type": "text/html; charset=utf-8" }) });
  }
  const action = `/d/${encodeURIComponent(token)}`;
  const actionHtml = session ? `<a class="resume" href="${action}/download">Resume download</a>` : `<form method="post" action="${action}"><input type="hidden" name="intent" value="download"><button type="submit">Download</button></form>`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/download.css"><title>Download</title></head><body><main class="download"><p class="wordmark">THOT OS</p>${item.creatorName ? `<p class="creator">Shared by ${html(item.creatorName)}</p>` : ""}<h1>${html(item.title)}</h1>${item.customMessage ? `<p class="message">${html(item.customMessage)}</p>` : ""}<p class="details">${html(size(item.byteCount))} · ${html(item.mimeType)}</p><p class="expiry"><strong>${session ? "Resume session expires" : "Download link expires"}:</strong> ${html(expiryLabel(item.expiresAt))}${session ? "" : ". Starting a download creates one browser session. If that cookie is lost, ask the creator for a new link."}</p>${actionHtml}</main></body></html>`;
  return new Response(body, { headers: securityHeaders({ "content-type": "text/html; charset=utf-8", "referrer-policy": "same-origin" }) });
}

async function intent(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return false;
  if (Number(request.headers.get("content-length")) > 1024) return false;
  const reader = request.body?.getReader(); if (!reader) return false;
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 1024) { await reader.cancel(); return false; } chunks.push(chunk.value); }
  const body = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new URLSearchParams(new TextDecoder().decode(body)).get("intent") === "download";
}

async function redeem(request: Request, env: Env, url: URL, token: string) {
  if (request.headers.get("origin") !== url.origin) return unavailable(403);
  if (!await intent(request)) return unavailable(400);
  const claim = await claimContentDownloadLink(env.DB, { token, sessionToken: await randomToken() }) as (Link & { sessionToken: string }) | null;
  if (!claim) return unavailable();
  return new Response(null, { status: 303, headers: securityHeaders({ location: `/d/${encodeURIComponent(token)}/download`, "set-cookie": cookie(url, token, claim.sessionToken, claim.expiresAt) }) });
}

async function download(request: Request, env: Env, token: string) {
  const sessionToken = sessionCookie(request, token);
  if (!sessionToken) return unavailable();
  const session = await getContentDownloadSession(env.DB, { linkToken: token, sessionToken }) as Session | null;
  if (!session) return unavailable();
  const expected = { byte_count: session.byteCount, r2_version: session.r2Version, r2_etag: session.r2Etag };
  const head = await env.LIBRARY_MEDIA.head(session.objectKey);
  if (!immutableR2IdentityMatches(expected, head)) return unavailable();
  const rangeValue = request.headers.get("range");
  const range = parseSingleRange(rangeValue, session.byteCount);
  if (range === "invalid") return new Response(null, { status: 416, headers: securityHeaders({ "accept-ranges": "bytes", "content-range": `bytes */${session.byteCount}` }) });
  const object = await env.LIBRARY_MEDIA.get(session.objectKey, { onlyIf: { etagMatches: session.r2Etag! }, ...(range ? { range } : {}) });
  if (!object || !("body" in object) || !immutableR2IdentityMatches(expected, object)) return unavailable();
  const length = range?.length ?? session.byteCount;
  const headers = securityHeaders({ "accept-ranges": "bytes", "content-disposition": `attachment; filename="${filename(session.title, session.mimeType)}"`, "content-length": String(length), "content-type": session.mimeType });
  if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${session.byteCount}`);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.ENABLED !== "true") return unavailable();
    const url = new URL(request.url); const token = tokenFrom(url);
    if (url.pathname === "/download.css" && !url.search && !url.hash && request.method === "GET") return stylesheet();
    if (!token || url.search || url.hash) return unavailable();
    const isDownload = url.pathname === `/d/${token}/download`;
    if (isDownload && request.method === "GET") return download(request, env, token);
    if (!isDownload && request.method === "GET") return metadata(request, env, token);
    if (!isDownload && request.method === "POST") return redeem(request, env, url, token);
    return new Response("Method not allowed", { status: 405, headers: securityHeaders({ allow: isDownload ? "GET" : "GET, POST" }) });
  },
} satisfies ExportedHandler<Env>;
