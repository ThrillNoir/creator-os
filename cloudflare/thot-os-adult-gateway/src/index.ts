import { livePublicHostGuard } from "../../shared/live-public-host.ts";
import { portfolioCss, renderPortfolio, validPortfolio, type PortfolioProjection } from "./portfolio.ts";

type AdultProfile = {
  schemaVersion: 1 | 2 | 3 | 4;
  publishedVersionId: string;
  creator: { slug: string; displayName: string; bio: string; safeProfileUrl: string };
  links: Array<{ id: string; label: string; destinationUrl: string; destinationHost: string }>;
  // Version 4 contains only a key from the isolated ADULT_MEDIA bucket. It
  // never accepts an authoring-bucket key and is never copied to the safe hub.
  media: Array<{ id: string; mediaKey?: string; checksum?: string; altText: string; contentType?: "image/webp"; imageRole?: "avatar" | "background" }>;
  appearance?: { themeKey: string; buttonStyle: string; backgroundMode: string; backgroundColor: string; primaryColor: string; textColor: string; cardColor: string; radiusScale: string };
};

type AgeSession = { slug: string; versionId: string; expiresAt: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ITEM_ID = /^[A-Za-z0-9_-]{1,120}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const SESSION_COOKIE = "__Host-thot-age";
const SESSION_MAX_AGE_SECONDS = 60 * 60;
const SHA256 = /^[a-f0-9]{64}$/i;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function toBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64(value: string) {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(standard), (character) => character.charCodeAt(0));
}

function profileKey(slug: string) { return `adult-profile:${slug}`; }

function hasOnlyKeys(value: object, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function securityHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self'; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow, noarchive",
  };
}

function page(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, { status, headers: { ...securityHeaders(), "content-type": "text/html; charset=utf-8", ...headers } });
}

function safeHttpsUrl(value: string, host: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.toLowerCase() === host.toLowerCase() ? url : null;
  } catch { return null; }
}

function safePublicProfileUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return Boolean(safeHttpsUrl(value, url.hostname));
  } catch { return false; }
}

function validAppearance(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const appearance = value as Partial<NonNullable<AdultProfile["appearance"]>>;
  return [appearance.backgroundColor, appearance.primaryColor, appearance.textColor, appearance.cardColor].every((color) => typeof color === "string" && HEX.test(color))
    && ["solid", "gradient"].includes(String(appearance.backgroundMode))
    && ["compact", "comfortable", "round"].includes(String(appearance.radiusScale))
    && ["solid-rounded", "full-pill", "minimal-outline", "soft-card-icon", "elevated-shadow-tile"].includes(String(appearance.buttonStyle));
}

function validAdultMediaKey(value: unknown, slug: string, versionId: string, attachmentId: string) {
  return typeof value === "string" && value === `adult-media/${slug}/${versionId}/${attachmentId}.webp`;
}

function validProfile(value: unknown, slug: string): value is AdultProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Partial<AdultProfile>;
  const versionId = profile.publishedVersionId;
  const mediaItems = profile.media;
  if (!hasOnlyKeys(profile, ["schemaVersion", "publishedVersionId", "creator", "links", "media", "appearance"]) || (profile.schemaVersion !== 1 && profile.schemaVersion !== 2 && profile.schemaVersion !== 3 && profile.schemaVersion !== 4) || typeof versionId !== "string" || !ITEM_ID.test(versionId) || !profile.creator || !hasOnlyKeys(profile.creator, ["slug", "displayName", "bio", "safeProfileUrl"]) || profile.creator.slug !== slug || !SLUG.test(slug) || typeof profile.creator.displayName !== "string" || typeof profile.creator.bio !== "string" || !safePublicProfileUrl(profile.creator.safeProfileUrl) || !Array.isArray(profile.links) || !Array.isArray(mediaItems) || profile.creator.displayName.length > 120 || profile.creator.bio.length > 2000) return false;
  if ((profile.schemaVersion === 2 || profile.schemaVersion === 3 || profile.schemaVersion === 4) && !validAppearance(profile.appearance)) return false;
  if (profile.schemaVersion === 1 && profile.appearance !== undefined) return false;
  const imageRoles = new Set<string>();
  return profile.links.every((link) => Boolean(link && typeof link === "object" && hasOnlyKeys(link, ["id", "label", "destinationUrl", "destinationHost"]) && ITEM_ID.test(link.id) && typeof link.label === "string" && link.label.length > 0 && link.label.length <= 80 && typeof link.destinationUrl === "string" && typeof link.destinationHost === "string" && safeHttpsUrl(link.destinationUrl, link.destinationHost)))
    && mediaItems.every((media) => {
      if (!media || typeof media !== "object" || !ITEM_ID.test(media.id) || typeof media.altText !== "string" || media.altText.length > 500) return false;
      // Older projections remain readable only if they contain no media. A
      // legacy private authoring key must never be served by this gateway.
      if (profile.schemaVersion !== 4) return mediaItems.length === 0;
      if (!hasOnlyKeys(media, ["id", "mediaKey", "checksum", "altText", "contentType", "imageRole"]) || media.contentType !== "image/webp" || (media.imageRole !== "avatar" && media.imageRole !== "background") || imageRoles.has(media.imageRole) || !SHA256.test(String(media.checksum)) || !validAdultMediaKey(media.mediaKey, slug, versionId, media.id)) return false;
      imageRoles.add(media.imageRole);
      return true;
    });
}

async function loadProfile(env: Env, slug: string) {
  const profile = await env.ADULT_PROFILES.get(profileKey(slug), "json");
  return validProfile(profile, slug) ? profile : null;
}

async function sessionKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(payload: string, secret: string) {
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), new TextEncoder().encode(payload));
  return toBase64(new Uint8Array(signature));
}

async function issueSession(slug: string, versionId: string, secret: string) {
  const payload = toBase64(new TextEncoder().encode(JSON.stringify({ slug, versionId, expiresAt: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS } satisfies AgeSession)));
  return `${payload}.${await sign(payload, secret)}`;
}

function cookieValue(request: Request, name: string) {
  const value = request.headers.get("cookie") ?? "";
  return value.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

async function validSession(request: Request, profile: AdultProfile, env: Env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  let validSignature = false;
  try {
    validSignature = await crypto.subtle.verify("HMAC", await sessionKey(env.AGE_SESSION_SECRET), fromBase64(signature), new TextEncoder().encode(payload));
  } catch { return false; }
  if (!validSignature) return false;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromBase64(payload))) as Partial<AgeSession>;
    return session.slug === profile.creator.slug && session.versionId === profile.publishedVersionId && typeof session.expiresAt === "number" && Number.isInteger(session.expiresAt) && session.expiresAt > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

type TurnstileVerification = { accepted: true } | { accepted: false; reason: "missing_token" | "oversized_token" | "origin_mismatch" | "siteverify_http_error" | "siteverify_invalid_response" | "challenge_rejected" | "action_mismatch" | "hostname_mismatch" };

/**
 * Some privacy-preserving browser contexts submit an ordinary same-origin
 * navigation with Origin: null. Accept that narrowly defined browser case,
 * while retaining the exact Origin check everywhere else. Fetch Metadata
 * request headers are browser-controlled and distinguish it from a
 * cross-site form post; Turnstile still validates the host and action.
 */
function sameOriginAgeConfirmation(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin === expectedOrigin) return true;
  return origin === "null"
    && request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("sec-fetch-mode") === "navigate"
    && request.headers.get("sec-fetch-dest") === "document";
}

/**
 * Only return fixed, safe reason codes: never the visitor token, Turnstile
 * response body, request headers, or any protected profile data.
 */
async function verifyTurnstile(token: string, request: Request, env: Env): Promise<TurnstileVerification> {
  if (!token) return { accepted: false, reason: "missing_token" };
  if (token.length > 2048) return { accepted: false, reason: "oversized_token" };
  if (!sameOriginAgeConfirmation(request)) return { accepted: false, reason: "origin_mismatch" };
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  } catch {
    return { accepted: false, reason: "siteverify_http_error" };
  }
  if (!response.ok) return { accepted: false, reason: "siteverify_http_error" };
  const result = await response.json().catch(() => null) as { success?: boolean; hostname?: string; action?: string } | null;
  if (!result) return { accepted: false, reason: "siteverify_invalid_response" };
  if (!result.success) return { accepted: false, reason: "challenge_rejected" };
  if (result.action !== "adult_access") return { accepted: false, reason: "action_mismatch" };
  if (env.TURNSTILE_EXPECTED_HOSTNAME && result.hostname !== env.TURNSTILE_EXPECTED_HOSTNAME) return { accepted: false, reason: "hostname_mismatch" };
  return { accepted: true };
}

function event(env: Env, profile: AdultProfile, name: string, item = "") {
  try { env.ADULT_EVENTS.writeDataPoint({ indexes: [profile.creator.slug], blobs: [name, item], doubles: [1] }); } catch { /* never block a visitor or log protected data */ }
}

function hexChecksum(value: ArrayBuffer | undefined) {
  return value ? Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
}

function validAdultMediaObject(object: R2ObjectBody, profile: AdultProfile, media: AdultProfile["media"][number]) {
  const metadata = object.customMetadata;
  return object.httpMetadata?.contentType === "image/webp"
    && metadata?.creatorSlug === profile.creator.slug
    && metadata.versionId === profile.publishedVersionId
    && metadata.attachmentId === media.id
    && metadata.surface === "adult_profile"
    && metadata.imageRole === media.imageRole
    && metadata.checksum === media.checksum
    && hexChecksum(object.checksums.sha256) === media.checksum;
}

function gate(profile: AdultProfile, siteKey: string) {
  const name = profile.creator.displayName ? `More from ${escapeHtml(profile.creator.displayName)}` : "More from this creator";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><style>body{font:16px/1.5 system-ui,sans-serif;background:#100c16;color:#fbf8fe;margin:0}.card{max-width:32rem;margin:3rem auto;padding:1.25rem}button,a{font:inherit;padding:.8rem 1rem;border-radius:.55rem}.yes{border:0;background:#c5a4ff;color:#170c24;font-weight:700;width:100%}.no{display:block;color:inherit;text-align:center;margin-top:.8rem}</style></head><body><main class="card"><h1>Are you 18 or older?</h1><p>This area may contain adult-oriented creator links and images.</p><form method="post" action="/age/${encodeURIComponent(profile.creator.slug)}/confirm"><div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-action="adult_access"></div><button class="yes" type="submit">Yes, continue</button></form><a class="no" href="${escapeHtml(profile.creator.safeProfileUrl)}">No, go back</a></main></body></html>`;
}

function adultPage(profile: AdultProfile, portfolio?: PortfolioProjection, url?: URL) {
  const appearance = profile.appearance ?? { buttonStyle: "solid-rounded", backgroundMode: "gradient", backgroundColor: "#100c16", primaryColor: "#c5a4ff", textColor: "#fbf8fe", cardColor: "#261d30", radiusScale: "comfortable" };
  const radius = appearance.radiusScale === "compact" ? ".45rem" : appearance.radiusScale === "round" ? "999px" : ".75rem";
  const style = appearance.buttonStyle === "minimal-outline" ? "outline" : appearance.buttonStyle === "soft-card-icon" ? "soft" : appearance.buttonStyle === "elevated-shadow-tile" ? "elevated" : appearance.buttonStyle === "full-pill" ? "pill" : "";
  const media = profile.media.map((item, index) => `<figure id="media-${index}"><img src="/media/${encodeURIComponent(profile.creator.slug)}/${encodeURIComponent(item.id)}" alt="${escapeHtml(item.altText)}" loading="lazy"><figcaption>${index + 1} of ${profile.media.length}</figcaption></figure>`).join("");
  const controls = profile.media.length > 1 ? `<nav class="carousel-controls" aria-label="Carousel controls">${profile.media.map((_, index) => `<a href="#media-${index}" aria-label="Show image ${index + 1}">${index + 1}</a>`).join("")}</nav>` : "";
  const links = profile.links.map((link) => `<a class="link ${style}" href="/r/${encodeURIComponent(profile.creator.slug)}/${encodeURIComponent(link.id)}" rel="noreferrer">${escapeHtml(link.label)}<span aria-hidden="true">↗</span></a>`).join("");
  const title = escapeHtml(profile.creator.displayName || "Creator");
  const bio = profile.creator.bio ? `<p>${escapeHtml(profile.creator.bio)}</p>` : "";
  const gallery = media ? `<section aria-label="Image carousel"><div class="carousel">${media}</div>${controls}</section>` : "";
  const portfolioHtml = portfolio ? renderPortfolio(portfolio, url?.searchParams.get("section") ?? null, url?.searchParams.get("genre") ?? null, url?.searchParams.get("request") === "sent") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;background:${appearance.backgroundMode === "gradient" ? `linear-gradient(145deg,${appearance.backgroundColor},${appearance.primaryColor}33)` : appearance.backgroundColor};color:${appearance.textColor};margin:0}.card{max-width:${portfolio ? "72rem" : "36rem"};margin:0 auto;padding:2rem 1rem}h1{margin:0}.carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:.75rem;margin:1.5rem 0}.carousel figure{flex:0 0 100%;scroll-snap-align:center;margin:0}.carousel img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:${radius};background:${appearance.cardColor}}.carousel figcaption{font-size:.8rem;opacity:.7}.carousel-controls{display:flex;gap:.75rem}.carousel-controls a,.link{border:1px solid ${appearance.textColor}66;border-radius:${radius};padding:.65rem;color:inherit;text-decoration:none}.links{display:grid;gap:.75rem;margin-top:1.5rem}.link{display:flex;justify-content:space-between;background:${appearance.primaryColor};color:${appearance.backgroundColor}}.link.outline{background:transparent;border-color:${appearance.primaryColor};color:${appearance.textColor}}.link.soft{background:${appearance.cardColor};color:${appearance.textColor}}.link.elevated{box-shadow:0 5px 0 ${appearance.primaryColor}55}.link.pill{border-radius:999px}${portfolio ? portfolioCss : ""}</style></head><body><main class="card" style="--portfolio-accent:${appearance.primaryColor};--portfolio-bg:${appearance.backgroundColor}"><h1>${title}</h1>${bio}${gallery}<nav class="links" aria-label="Creator links">${links}</nav>${portfolioHtml}</main></body></html>`;
}

export function createAdultGateway(loadPortfolio?: (slug: string, versionId: string) => Promise<unknown>): ExportedHandler<Env> {
return {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const liveSlug = parts[0] === "age" || parts[0] === "media" || parts[0] === "r" ? parts[1] : parts[0];
    const guarded = livePublicHostGuard(request, env, "adult", liveSlug);
    if (guarded) return guarded;
    if (request.method === "GET" && parts.length === 2 && parts[0] === "age" && SLUG.test(parts[1])) {
      const profile = await loadProfile(env, parts[1]);
      if (!profile) return page("Not found", 404);
      event(env, profile, "age_gate_view");
      return page(gate(profile, env.TURNSTILE_SITE_KEY));
    }
    if (request.method === "POST" && parts.length === 3 && parts[0] === "age" && SLUG.test(parts[1]) && parts[2] === "confirm") {
      const profile = await loadProfile(env, parts[1]);
      const form = await request.formData().catch(() => null);
      if (!profile) return page("Unable to confirm access", 400);
      const verification = await verifyTurnstile(String(form?.get("cf-turnstile-response") ?? ""), request, env);
      if (!verification.accepted) {
        console.warn(JSON.stringify({ event: "adult_age_confirmation_rejected", reason: verification.reason, creatorSlug: profile.creator.slug }));
        return page("Unable to confirm access", 400);
      }
      event(env, profile, "age_gate_completed");
      return new Response(null, { status: 303, headers: { ...securityHeaders(), location: `/${encodeURIComponent(profile.creator.slug)}`, "set-cookie": `${SESSION_COOKIE}=${await issueSession(profile.creator.slug, profile.publishedVersionId, env.AGE_SESSION_SECRET)}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Lax` } });
    }
    if (request.method === "GET" && parts.length === 1 && SLUG.test(parts[0])) {
      const profile = await loadProfile(env, parts[0]);
      if (!profile || !await validSession(request, profile, env)) return page("Not found", 404);
      event(env, profile, "adult_profile_view");
      let portfolio: PortfolioProjection | undefined;
      if (loadPortfolio) {
        try {
          const candidate = await loadPortfolio(profile.creator.slug, profile.publishedVersionId);
          if (validPortfolio(candidate, profile.creator.slug, profile.publishedVersionId)) portfolio = candidate;
        } catch { /* A portfolio outage cannot bypass the age gate or break the profile. */ }
      }
      return page(adultPage(profile, portfolio, url));
    }
    if (request.method === "GET" && parts.length === 3 && parts[0] === "media" && SLUG.test(parts[1]) && ITEM_ID.test(parts[2])) {
      const profile = await loadProfile(env, parts[1]);
      const media = profile?.media.find((item) => item.id === parts[2]);
      if (!profile || !media || !await validSession(request, profile, env)) return page("Not found", 404);
      // validProfile accepts media only in the v4 isolated-media shape.
      const object = await env.ADULT_MEDIA.get(media.mediaKey!);
      if (!object || profile.schemaVersion !== 4 || !validAdultMediaObject(object, profile, media)) return page("Not found", 404);
      event(env, profile, "adult_media_view", media.id);
      return new Response(object.body, { headers: { ...securityHeaders(), "content-type": "image/webp", etag: `"${media.checksum}"` } });
    }
    if (request.method === "GET" && parts.length === 3 && parts[0] === "r" && SLUG.test(parts[1]) && ITEM_ID.test(parts[2])) {
      const profile = await loadProfile(env, parts[1]);
      const link = profile?.links.find((item) => item.id === parts[2]);
      const destination = link && safeHttpsUrl(link.destinationUrl, link.destinationHost);
      if (!profile || !link || !destination || !await validSession(request, profile, env)) return page("Not found", 404);
      event(env, profile, "adult_link_click", link.id);
      return new Response(null, { status: 302, headers: { ...securityHeaders(), location: destination.toString() } });
    }
    return page("Not found", 404);
  },
};
}

export default createAdultGateway();
