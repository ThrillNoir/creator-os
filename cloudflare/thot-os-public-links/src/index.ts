type PublicLink = {
  id: string;
  label: string;
  destinationUrl: string;
  destinationHost: string;
};

type PublicProfileSnapshot = {
  schemaVersion: 1;
  publishedVersionId: string;
  creator: {
    slug: string;
    displayName: string;
    headline: string;
    bio: string;
    avatarUrl?: string;
  };
  links: PublicLink[];
};

const CREATOR_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const LINK_ID = /^[a-zA-Z0-9_-]{1,120}$/;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function snapshotKey(slug: string) {
  return `public-profile:${slug}`;
}

function validSnapshot(value: unknown, requestedSlug: string): value is PublicProfileSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<PublicProfileSnapshot>;
  if (snapshot.schemaVersion !== 1 || !snapshot.publishedVersionId || !snapshot.creator || !Array.isArray(snapshot.links)) return false;
  const creator = snapshot.creator;
  if (creator.slug !== requestedSlug || !CREATOR_SLUG.test(creator.slug) || typeof creator.displayName !== "string" || typeof creator.headline !== "string" || typeof creator.bio !== "string") return false;
  if (creator.displayName.length < 1 || creator.displayName.length > 120 || creator.headline.length > 280 || creator.bio.length > 2000) return false;
  if (creator.avatarUrl !== undefined && !safeHttpsUrl(creator.avatarUrl)) return false;
  return snapshot.links.every((link) => {
    if (!link || typeof link !== "object" || !LINK_ID.test(link.id) || typeof link.label !== "string" || link.label.length < 1 || link.label.length > 80 || typeof link.destinationHost !== "string") return false;
    const destination = safeHttpsUrl(link.destinationUrl);
    return Boolean(destination && destination.hostname.toLowerCase() === link.destinationHost.toLowerCase());
  });
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
  return validSnapshot(snapshot, slug) ? snapshot : null;
}

function renderProfile(snapshot: PublicProfileSnapshot) {
  const avatar = snapshot.creator.avatarUrl
    ? `<img class="avatar" src="${escapeHtml(snapshot.creator.avatarUrl)}" alt="" width="96" height="96">`
    : "";
  const links = snapshot.links.map((link) => `<a class="link" href="/go/${encodeURIComponent(snapshot.creator.slug)}/${encodeURIComponent(link.id)}" rel="noreferrer">${escapeHtml(link.label)}<span aria-hidden="true">↗</span></a>`).join("\n");
  const title = escapeHtml(snapshot.creator.displayName);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>html{color-scheme:dark;background:#0d0c10}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;color:#f8f6fa;background:radial-gradient(circle at top,#2b1933,#0d0c10 55%)}main{width:min(100% - 2rem,36rem);padding:3rem 0;text-align:center}.avatar{display:block;border-radius:50%;object-fit:cover;margin:0 auto 1rem;border:1px solid #ffffff35}h1{margin:0;font-size:clamp(2rem,7vw,3rem)}p{margin:0.5rem auto;white-space:pre-line}.bio{color:#d7d0da;max-width:34rem}.links{display:grid;gap:.75rem;margin-top:2rem}.link{display:flex;justify-content:space-between;gap:1rem;align-items:center;border:1px solid #ffffff2f;border-radius:.85rem;padding:1rem 1.1rem;color:inherit;background:#ffffff0c;text-decoration:none;text-align:left}.link:hover,.link:focus-visible{background:#ffffff1c;border-color:#ffffff75;outline:0}.link span{opacity:.75}</style></head>
<body><main>${avatar}<h1>${title}</h1><p>${escapeHtml(snapshot.creator.headline)}</p><p class="bio">${escapeHtml(snapshot.creator.bio)}</p><nav class="links" aria-label="Links">${links}</nav></main></body></html>`;
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
    if (segments.length === 1 && CREATOR_SLUG.test(segments[0])) {
      const snapshot = await loadSnapshot(env, segments[0]);
      if (!snapshot) return textResponse("Not found", 404);
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
        env.LINK_EVENTS.writeDataPoint({ blobs: ["link_click", snapshot.creator.slug, link.id, destination.hostname.toLowerCase()], doubles: [1] });
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
