type Surface = "profile" | "media" | "booking" | "adult";

const HOSTS: Record<Surface, { live: string; old?: string; apex?: string }> = {
  profile: { live: "www.thathuboverthere.com", old: "public-profile-staging.thathuboverthere.com", apex: "thathuboverthere.com" },
  media: { live: "www.thathuboverthere.com", old: "public-profile-staging.thathuboverthere.com" },
  booking: { live: "booking.thathuboverthere.com", old: "booking-staging.thathuboverthere.com" },
  adult: { live: "more.thathuboverthere.com", old: "more-staging.thathuboverthere.com" },
};

function redirect(request: Request, host: string) {
  const url = new URL(request.url);
  url.protocol = "https:";
  url.hostname = host;
  url.port = "";
  return new Response(null, { status: 302, headers: { location: url.toString(), "cache-control": "no-store" } });
}

function restart(request: Request, host: string, surface: Surface, slug: string) {
  const url = new URL(request.url);
  url.protocol = "https:";
  url.hostname = host;
  url.port = "";
  if (surface === "adult") url.pathname = `/age/${encodeURIComponent(slug)}`;
  const href = url.toString().replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return new Response(`<!doctype html><title>Restart required</title><p>This form has moved.</p><a href="${href}">Restart</a>`, {
    status: 400,
    headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" },
  });
}

export function livePublicHostGuard(request: Request, env: unknown, surface: Surface, slug?: string): Response | null {
  const host = new URL(request.url).hostname.toLowerCase();
  const expected = HOSTS[surface];
  const configured = (env as { LIVE_PUBLIC_CREATOR_SLUGS?: string }).LIVE_PUBLIC_CREATOR_SLUGS;
  const allowed = new Set((configured ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (host === expected.apex) {
    return slug && allowed.has(slug) && (request.method === "GET" || request.method === "HEAD")
      ? redirect(request, expected.live)
      : new Response("Not found", { status: 404 });
  }
  if (host === expected.old) {
    if (request.method === "GET" || request.method === "HEAD") return redirect(request, expected.live);
    return slug ? restart(request, expected.live, surface, slug) : new Response("Not found", { status: 404 });
  }
  if (host !== expected.live || !slug) return null;
  return allowed.has(slug) ? null : new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
}
