type PublicLink = {
  id: string;
  label: string;
  destinationUrl: string;
  destinationHost: string;
};

type PublicAction = {
  id: "book" | "more";
  label: string;
  href: string;
};

type PublicProfileSnapshot = {
  schemaVersion: 1 | 2 | 3 | 4;
  publishedVersionId: string;
  creator: {
    slug: string;
    displayName: string;
    headline: string;
    bio: string;
  };
  links: PublicLink[];
  actions?: PublicAction[];
  appearance?: { themeKey: string; buttonStyle: string; backgroundMode: string; backgroundColor: string; primaryColor: string; textColor: string; cardColor: string; radiusScale: string };
  /**
   * These are opaque identifiers delivered by a separately configured media
   * Worker. They are never R2 keys, source upload IDs, or adult media values.
   */
  media?: Array<{ id: string; href: string; altText: string; contentType: "image/webp"; imageRole: "avatar" | "background"; checksum: string }>;
};

const CREATOR_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const LINK_ID = /^[a-zA-Z0-9_-]{1,120}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const THEME_KEYS = new Set(["thot-noir", "soft-pearl", "candy-pink", "lavender-dream", "sunset", "ocean", "forest", "crimson", "chrome", "clean-minimal"]);
const BUTTON_STYLES = new Set(["solid-rounded", "full-pill", "minimal-outline", "soft-card-icon", "elevated-shadow-tile"]);
const BACKGROUND_MODES = new Set(["solid", "gradient"]);
const RADIUS_SCALES = new Set(["compact", "comfortable", "round"]);
// These paths belong to the private THOT OS product surface, not the public
// link hub. Reserving them here means a future creator slug can never cause a
// public request for a dashboard path to resolve to a profile by accident.
const RESERVED_PRIVATE_PATHS = new Set([
  "accounts",
  "activity",
  "admin",
  "agents",
  "analytics",
  "approvals",
  "api",
  "auth",
  "automation",
  "calendar",
  "connections",
  "content",
  "creators",
  "finance",
  "go",
  "growth",
  "healthz",
  "health",
  "handoff",
  "launch-readiness",
  "library",
  "login",
  "logout",
  "messages",
  "migration",
  "money",
  "operations",
  "people",
  "public-profile",
  "publishing",
  "reddit",
  "reporting",
  "research",
  "schedule",
  "settings",
  "staging-qa",
  "vault",
  "voice",
]);

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function configuredActionBase(value: string | undefined) {
  if (!value) return null;
  const url = safeHttpsUrl(value);
  if (!url || url.pathname !== "/" || url.search || url.hash) return null;
  return url.origin;
}

function validActionUrl(value: unknown, actionId: PublicAction["id"], slug: string, env: Env) {
  const url = safeHttpsUrl(value);
  if (!url || url.username || url.password || url.search || url.hash) return false;
  if (actionId === "book") {
    const base = configuredActionBase(env.BOOKING_ACTION_BASE_URL);
    return Boolean(base && url.origin === base && url.pathname === `/book/${encodeURIComponent(slug)}`);
  }
  const safeProfileBase = configuredActionBase(env.SAFE_PUBLIC_PROFILE_BASE_URL);
  return Boolean(safeProfileBase && url.origin === safeProfileBase && url.pathname === `/${encodeURIComponent(slug)}/more`);
}

function configuredAdultGateHref(value: string | undefined, slug: string) {
  const base = configuredActionBase(value);
  return base ? `${base}/age/${encodeURIComponent(slug)}` : null;
}

function configuredPublicMediaBase(value: string | undefined) {
  return configuredActionBase(value);
}

function validPublicMediaUrl(value: unknown, slug: string, versionId: string, mediaId: string, env: Env) {
  const url = safeHttpsUrl(value);
  const base = configuredPublicMediaBase(env.PUBLIC_MEDIA_BASE_URL);
  return Boolean(url && base && !url.search && !url.hash && url.origin === base
    && url.pathname === `/media/${encodeURIComponent(slug)}/${encodeURIComponent(versionId)}/${encodeURIComponent(mediaId)}`);
}

function validAppearance(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const appearance = value as Partial<NonNullable<PublicProfileSnapshot["appearance"]>>;
  return hasOnlyKeys(appearance, ["themeKey", "buttonStyle", "backgroundMode", "backgroundColor", "primaryColor", "textColor", "cardColor", "radiusScale"])
    && typeof appearance.themeKey === "string" && THEME_KEYS.has(appearance.themeKey)
    && typeof appearance.buttonStyle === "string" && BUTTON_STYLES.has(appearance.buttonStyle)
    && typeof appearance.backgroundMode === "string" && BACKGROUND_MODES.has(appearance.backgroundMode)
    && typeof appearance.radiusScale === "string" && RADIUS_SCALES.has(appearance.radiusScale)
    && typeof appearance.backgroundColor === "string" && HEX.test(appearance.backgroundColor)
    && typeof appearance.primaryColor === "string" && HEX.test(appearance.primaryColor)
    && typeof appearance.textColor === "string" && HEX.test(appearance.textColor)
    && typeof appearance.cardColor === "string" && HEX.test(appearance.cardColor);
}

function snapshotKey(slug: string) {
  return `public-profile:${slug}`;
}

/**
 * The public link hub deliberately has no media binding. Until a separately
 * configured media-delivery Worker exists, a public snapshot is text/link-only.
 * Version 4 allows only an environment-controlled public media URL; it never
 * accepts a source R2 key, an authoring attachment ID, or adult media value.
 */
function hasOnlyKeys(value: object, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isPublicCreatorSlug(value: string) {
  return CREATOR_SLUG.test(value) && !RESERVED_PRIVATE_PATHS.has(value);
}

function validSnapshot(value: unknown, requestedSlug: string, env: Env): value is PublicProfileSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<PublicProfileSnapshot>;
  const versionId = snapshot.publishedVersionId;
  if (!hasOnlyKeys(snapshot, ["schemaVersion", "publishedVersionId", "creator", "links", "actions", "appearance", "media"]) || (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== 2 && snapshot.schemaVersion !== 3 && snapshot.schemaVersion !== 4) || typeof versionId !== "string" || !LINK_ID.test(versionId) || !snapshot.creator || !Array.isArray(snapshot.links)) return false;
  const creator = snapshot.creator;
  if (!hasOnlyKeys(creator, ["slug", "displayName", "headline", "bio"]) || creator.slug !== requestedSlug || !CREATOR_SLUG.test(creator.slug) || typeof creator.displayName !== "string" || typeof creator.headline !== "string" || typeof creator.bio !== "string") return false;
  if (creator.displayName.length < 1 || creator.displayName.length > 120 || creator.headline.length > 280 || creator.bio.length > 2000) return false;
  if (!snapshot.links.every((link) => {
    if (!link || typeof link !== "object" || !hasOnlyKeys(link, ["id", "label", "destinationUrl", "destinationHost"]) || !LINK_ID.test(link.id) || typeof link.label !== "string" || link.label.length < 1 || link.label.length > 80 || typeof link.destinationHost !== "string") return false;
    const destination = safeHttpsUrl(link.destinationUrl);
    return Boolean(destination && destination.hostname.toLowerCase() === link.destinationHost.toLowerCase());
  })) return false;
  if (snapshot.schemaVersion === 1) return snapshot.actions === undefined && snapshot.appearance === undefined && snapshot.media === undefined;
  if (!Array.isArray(snapshot.actions) || snapshot.actions.length > 2) return false;
  const actionIds = new Set<string>();
  const actionsValid = snapshot.actions.every((action) => {
    if (!action || typeof action !== "object" || !hasOnlyKeys(action, ["id", "label", "href"]) || (action.id !== "book" && action.id !== "more") || actionIds.has(action.id) || typeof action.label !== "string" || action.label.length < 1 || action.label.length > 80) return false;
    actionIds.add(action.id);
    return validActionUrl(action.href, action.id, requestedSlug, env);
  });
  if (!actionsValid || (snapshot.schemaVersion === 2 ? snapshot.appearance !== undefined : !validAppearance(snapshot.appearance))) return false;
  if (snapshot.schemaVersion !== 4) return snapshot.media === undefined;
  if (!Array.isArray(snapshot.media) || snapshot.media.length > 2) return false;
  const imageRoles = new Set<string>();
  return snapshot.media.every((media) => Boolean(media && typeof media === "object" && hasOnlyKeys(media, ["id", "href", "altText", "contentType", "imageRole", "checksum"])
    && typeof media.id === "string" && LINK_ID.test(media.id)
    && typeof media.altText === "string" && media.altText.length <= 500
    && media.contentType === "image/webp" && (media.imageRole === "avatar" || media.imageRole === "background") && !imageRoles.has(media.imageRole)
    && typeof media.checksum === "string" && /^[a-f0-9]{64}$/i.test(media.checksum)
    && validPublicMediaUrl(media.href, requestedSlug, versionId, media.id, env)
    && (imageRoles.add(media.imageRole), true)));
}

function securityHeaders() {
  return {
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
}

function textResponse(body: string, status: number, headers: HeadersInit = {}) {
  return new Response(body, { status, headers: { ...securityHeaders(), "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });
}

async function loadSnapshot(env: Env, slug: string) {
  const snapshot = await env.PUBLIC_LINKS.get(snapshotKey(slug), "json");
  return validSnapshot(snapshot, slug, env) ? snapshot : null;
}

function renderProfile(snapshot: PublicProfileSnapshot) {
  const appearance = snapshot.appearance ?? { buttonStyle: "solid-rounded", backgroundMode: "gradient", backgroundColor: "#0d0c10", primaryColor: "#7655f6", textColor: "#f8f6fa", cardColor: "#211a29", radiusScale: "comfortable" };
  const radius = appearance.radiusScale === "compact" ? ".45rem" : appearance.radiusScale === "round" ? "999px" : ".85rem";
  const buttonClass = appearance.buttonStyle === "full-pill" ? " pill" : appearance.buttonStyle === "minimal-outline" ? " outline" : appearance.buttonStyle === "soft-card-icon" ? " soft" : appearance.buttonStyle === "elevated-shadow-tile" ? " elevated" : "";
  const links = snapshot.links.map((link) => `<a class="link${buttonClass}" href="/go/${encodeURIComponent(snapshot.creator.slug)}/${encodeURIComponent(link.id)}" rel="noreferrer">${escapeHtml(link.label)}<span aria-hidden="true">↗</span></a>`).join("\n");
  const actions = snapshot.actions?.map((action) => `<a class="action" href="${escapeHtml(action.href)}" rel="noreferrer">${escapeHtml(action.label)}</a>`).join("\n") ?? "";
  const title = escapeHtml(snapshot.creator.displayName);
  const headline = snapshot.creator.headline ? `<p>${escapeHtml(snapshot.creator.headline)}</p>` : "";
  const bio = snapshot.creator.bio ? `<p class="bio">${escapeHtml(snapshot.creator.bio)}</p>` : "";
  const media = snapshot.media?.map((item) => `<img class="media media-${item.imageRole}" src="${escapeHtml(item.href)}" alt="${escapeHtml(item.altText)}" loading="lazy">`).join("\n") ?? "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>html{color-scheme:dark;background:${appearance.backgroundColor}}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;color:${appearance.textColor};background:${appearance.backgroundMode === "gradient" ? `linear-gradient(145deg,${appearance.backgroundColor},${appearance.primaryColor}33)` : appearance.backgroundColor}}main{width:min(100% - 2rem,36rem);padding:3rem 0;text-align:center}h1{margin:0;font-size:clamp(2rem,7vw,3rem)}p{margin:.5rem auto;white-space:pre-line}.bio{color:${appearance.textColor};opacity:.8;max-width:34rem}.media{display:block;width:100%;max-height:34rem;object-fit:cover;border-radius:${radius};margin:1rem 0;background:${appearance.cardColor}}.media-avatar{aspect-ratio:1;max-width:13rem;margin:1rem auto}.actions,.links{display:grid;gap:.75rem;margin-top:2rem}.action,.link{display:flex;justify-content:space-between;gap:1rem;align-items:center;border:1px solid ${appearance.textColor}2f;border-radius:${radius};padding:1rem 1.1rem;color:inherit;background:${appearance.cardColor};text-decoration:none;text-align:left}.action{justify-content:center;background:${appearance.primaryColor};color:${appearance.backgroundColor}}.link{background:${appearance.primaryColor};color:${appearance.backgroundColor}}.link.outline{background:transparent;border-color:${appearance.primaryColor};color:${appearance.textColor}}.link.soft{background:${appearance.cardColor};color:${appearance.textColor}}.link.elevated{box-shadow:0 6px 0 ${appearance.primaryColor}55}.action:hover,.action:focus-visible,.link:hover,.link:focus-visible{filter:brightness(1.08);outline:0}.link span{opacity:.75}</style></head>
<body><main><h1>${title}</h1>${media}${headline}${bio}${actions ? `<nav class="actions" aria-label="Creator actions">${actions}</nav>` : ""}${links ? `<nav class="links" aria-label="Links">${links}</nav>` : ""}</main></body></html>`;
}

function isStaticAssetPath(pathname: string) {
  return pathname === "/robots.txt" || pathname === "/favicon.ico" || pathname.startsWith("/assets/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return textResponse("Method not allowed", 405, { allow: "GET, HEAD" });
    const url = new URL(request.url);
    if (isStaticAssetPath(url.pathname)) return env.ASSETS.fetch(request);
    if (url.pathname === "/healthz") return textResponse("ok", 200, { "cache-control": "public, max-age=60" });

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 2 && isPublicCreatorSlug(segments[0]) && segments[1] === "more") {
      const snapshot = await loadSnapshot(env, segments[0]);
      const more = snapshot?.actions?.find((action) => action.id === "more");
      // The safe snapshot proves the action is currently eligible. The adult
      // origin is environment-owned; no request value, snapshot value, cookie,
      // or subrequest can select a different protected destination.
      const destination = snapshot && more ? configuredAdultGateHref(env.ADULT_GATEWAY_BASE_URL, snapshot.creator.slug) : null;
      if (!destination) return textResponse("Not found", 404);
      return new Response(null, {
        status: 302,
        headers: { ...securityHeaders(), "cache-control": "no-store", location: destination },
      });
    }

    if (segments.length === 1 && isPublicCreatorSlug(segments[0])) {
      const snapshot = await loadSnapshot(env, segments[0]);
      if (!snapshot) return textResponse("Not found", 404);
      if (request.method === "GET") {
        try {
          // A profile view is counted without storing a visitor ID, IP address,
          // user agent, referrer, or any other visitor-level dimension.
          env.LINK_EVENTS.writeDataPoint({ indexes: [snapshot.creator.slug], blobs: ["profile_view"], doubles: [1] });
        } catch (error) {
          console.warn(JSON.stringify({ event: "public_profile_analytics_write_failed", creatorSlug: snapshot.creator.slug, message: error instanceof Error ? error.message : "unknown" }));
        }
      }
      const body = renderProfile(snapshot);
      if (request.method === "HEAD") return new Response(null, { status: 200, headers: { ...securityHeaders(), "cache-control": "public, max-age=60" } });
      return new Response(body, { headers: { ...securityHeaders(), "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
    }

    if (segments.length === 3 && segments[0] === "go" && CREATOR_SLUG.test(segments[1]) && LINK_ID.test(segments[2])) {
      const snapshot = await loadSnapshot(env, segments[1]);
      const link = snapshot?.links.find((candidate) => candidate.id === segments[2]);
      const destination = link && safeHttpsUrl(link.destinationUrl);
      if (!snapshot || !link || !destination || destination.hostname.toLowerCase() !== link.destinationHost.toLowerCase()) return textResponse("Not found", 404);
      try {
        env.LINK_EVENTS.writeDataPoint({
          // Analytics Engine's index is the tenant boundary. The creator slug
          // is already the public profile identifier and is deliberately not
          // derived from visitor data.
          indexes: [snapshot.creator.slug],
          blobs: ["link_click", link.id, destination.hostname.toLowerCase()],
          doubles: [1],
        });
      } catch (error) {
        console.warn(JSON.stringify({ event: "public_link_analytics_write_failed", creatorSlug: snapshot.creator.slug, linkId: link.id, message: error instanceof Error ? error.message : "unknown" }));
      }
      return new Response(null, {
        status: 302,
        headers: { ...securityHeaders(), "cache-control": "no-store", location: destination.toString() },
      });
    }
    return textResponse("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
