import { isPublicCreatorSlug } from "../../shared/public-profile-slug.ts";
import { livePublicHostGuard } from "../../shared/live-public-host.ts";

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
  schemaVersion: 1 | 2 | 3 | 4 | 5;
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
  media?: Array<{ id: string; href: string; altText: string; contentType: "image/webp"; imageRole: "avatar" | "background" | "gallery"; checksum: string; position?: number }>;
};

type PublicAmaProjection = {
  schemaVersion: 1;
  creatorSlug: string;
  publishedProfileVersionId: string;
  cards: Array<{
    id: string;
    question: string;
    answer: string;
    publishedAt: string;
    safety: "sfw";
  }>;
};

type AmaEnv = Env & {
  AMA_SERVICE?: Fetcher;
  AMA_TURNSTILE_SITE_KEY?: string;
  AMA_RATE_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> };
};

const LINK_ID = /^[a-zA-Z0-9_-]{1,120}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const THEME_KEYS = new Set(["thot-noir", "soft-pearl", "candy-pink", "lavender-dream", "sunset", "ocean", "forest", "crimson", "chrome", "clean-minimal"]);
const BUTTON_STYLES = new Set(["solid-rounded", "full-pill", "minimal-outline", "soft-card-icon", "elevated-shadow-tile"]);
const BACKGROUND_MODES = new Set(["solid", "gradient"]);
const RADIUS_SCALES = new Set(["compact", "comfortable", "round"]);

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

function validSnapshot(value: unknown, requestedSlug: string, env: Env): value is PublicProfileSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<PublicProfileSnapshot>;
  const versionId = snapshot.publishedVersionId;
  if (!hasOnlyKeys(snapshot, ["schemaVersion", "publishedVersionId", "creator", "links", "actions", "appearance", "media"]) || (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== 2 && snapshot.schemaVersion !== 3 && snapshot.schemaVersion !== 4 && snapshot.schemaVersion !== 5) || typeof versionId !== "string" || !LINK_ID.test(versionId) || !snapshot.creator || !Array.isArray(snapshot.links)) return false;
  const creator = snapshot.creator;
  if (!hasOnlyKeys(creator, ["slug", "displayName", "headline", "bio"]) || creator.slug !== requestedSlug || !isPublicCreatorSlug(creator.slug) || typeof creator.displayName !== "string" || typeof creator.headline !== "string" || typeof creator.bio !== "string") return false;
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
  if (snapshot.schemaVersion !== 4 && snapshot.schemaVersion !== 5) return snapshot.media === undefined;
  if (!Array.isArray(snapshot.media) || snapshot.media.length > (snapshot.schemaVersion === 5 ? 6 : 2) || (snapshot.schemaVersion === 5 && !snapshot.media.length)) return false;
  if (snapshot.schemaVersion === 5) {
    const ids = new Set<string>();
    return snapshot.media.every((media, position) => Boolean(media && typeof media === "object"
      && hasOnlyKeys(media, ["id", "href", "altText", "contentType", "imageRole", "checksum", "position"])
      && typeof media.id === "string" && LINK_ID.test(media.id) && !ids.has(media.id)
      && media.position === position && media.imageRole === (position === 0 ? "avatar" : "gallery")
      && media.contentType === "image/webp" && typeof media.altText === "string" && media.altText.length <= 500
      && typeof media.checksum === "string" && /^[a-f0-9]{64}$/i.test(media.checksum)
      && validPublicMediaUrl(media.href, requestedSlug, versionId, media.id, env)
      && (ids.add(media.id), true)));
  }
  const imageRoles = new Set<string>();
  return snapshot.media.every((media) => Boolean(media && typeof media === "object" && hasOnlyKeys(media, ["id", "href", "altText", "contentType", "imageRole", "checksum"])
    && typeof media.id === "string" && LINK_ID.test(media.id)
    && typeof media.altText === "string" && media.altText.length <= 500
    && media.contentType === "image/webp" && (media.imageRole === "avatar" || media.imageRole === "background") && !imageRoles.has(media.imageRole)
    && typeof media.checksum === "string" && /^[a-f0-9]{64}$/i.test(media.checksum)
    && validPublicMediaUrl(media.href, requestedSlug, versionId, media.id, env)
    && (imageRoles.add(media.imageRole), true)));
}

function validAmaProjection(value: unknown, profile: PublicProfileSnapshot): value is PublicAmaProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const projection = value as Partial<PublicAmaProjection>;
  if (!hasOnlyKeys(projection, ["schemaVersion", "creatorSlug", "publishedProfileVersionId", "cards"])
    || projection.schemaVersion !== 1 || projection.creatorSlug !== profile.creator.slug
    || projection.publishedProfileVersionId !== profile.publishedVersionId
    || !Array.isArray(projection.cards) || projection.cards.length > 50) return false;
  const ids = new Set<string>();
  return projection.cards.every((card) => {
    if (!card || typeof card !== "object" || !hasOnlyKeys(card, ["id", "question", "answer", "publishedAt", "safety"])
      || typeof card.id !== "string" || !LINK_ID.test(card.id) || ids.has(card.id)
      || typeof card.question !== "string" || !card.question.trim() || card.question.length > 2000
      || typeof card.answer !== "string" || !card.answer.trim() || card.answer.length > 5000
      || typeof card.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(card.publishedAt)
      || !Number.isFinite(Date.parse(card.publishedAt))
      || new Date(card.publishedAt).toISOString() !== (card.publishedAt.includes(".") ? card.publishedAt : card.publishedAt.replace("Z", ".000Z"))
      || card.safety !== "sfw") return false;
    ids.add(card.id);
    return true;
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
  return validSnapshot(snapshot, slug, env) ? snapshot : null;
}

async function loadAmaProjection(env: AmaEnv, profile: PublicProfileSnapshot) {
  if (!env.AMA_SERVICE) return null;
  try {
    const result = await env.AMA_SERVICE.fetch(`https://ama.internal/internal/ama/public/${profile.creator.slug}`);
    if (!result.ok) return null;
    const projection: unknown = await result.json();
    return validAmaProjection(projection, profile) ? projection : null;
  } catch {
    return null;
  }
}

async function boundedAmaForm(request: Request) {
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > 8192) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8192) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } catch { await reader.cancel().catch(() => undefined); return null; }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: raw }).formData().catch(() => null);
}

async function sendAmaQuestion(request: Request, env: AmaEnv, slug: string) {
  if (!env.AMA_SERVICE || !env.AMA_RATE_LIMITER || !env.AMA_TURNSTILE_SITE_KEY) return textResponse("Question intake unavailable", 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return textResponse("Forbidden", 403);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return textResponse("Unsupported media type", 415);
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return textResponse("Question intake unavailable", 503);
  const form = await boundedAmaForm(request);
  if (!form) return textResponse("Invalid question", 400);
  const fields = ["question", "acknowledge", "website", "cf-turnstile-response"];
  let fieldCount = 0;
  form.forEach(() => { fieldCount++; });
  if (fieldCount !== 4 || fields.some((field) => form.getAll(field).length !== 1)) return textResponse("Invalid question", 400);
  const question = form.get("question");
  const challenge = form.get("cf-turnstile-response");
  if (typeof question !== "string" || !question.trim() || question.length > 800 ||
    form.get("acknowledge") !== "yes" || form.get("website") !== "" ||
    typeof challenge !== "string" || !challenge || challenge.length > 2048) return textResponse("Invalid question", 400);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${slug}:${ip}`));
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    if (!(await env.AMA_RATE_LIMITER.limit({ key })).success) return textResponse("Please wait before sending another question", 429);
    const forwarded = new URLSearchParams({ question: question.trim(), acknowledge: "yes", website: "", "cf-turnstile-response": challenge });
    const result = await env.AMA_SERVICE.fetch(`https://ama.internal/internal/ama/intake/${slug}`, {
      method: "POST", headers: { origin: new URL(request.url).origin, "content-type": "application/x-www-form-urlencoded" }, body: forwarded,
    });
    if (result.status !== 201) return textResponse(result.status === 403 ? "Verification failed. Refresh and try again." : "Question could not be sent", result.status === 403 ? 403 : result.status === 404 ? 404 : 503);
    return textResponse("", 303, { location: `/${slug}/ama?sent=1` });
  } catch {
    return textResponse("Question intake unavailable", 503);
  }
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
  const media = snapshot.schemaVersion === 5
    ? snapshot.media!.length === 1
      ? `<img class="media media-avatar" src="${escapeHtml(snapshot.media![0].href)}" alt="${escapeHtml(snapshot.media![0].altText)}" loading="lazy">`
      : `<section class="photo-carousel" aria-label="Creator photos"><div class="photo-carousel-track">${snapshot.media!.map((item, index) => `<img id="photo-${index}" class="media" src="${escapeHtml(item.href)}" alt="${escapeHtml(item.altText)}" loading="lazy">`).join("")}</div><nav aria-label="Choose a photo">${snapshot.media!.map((_, index) => `<a href="#photo-${index}" aria-label="Photo ${index + 1}">${index + 1}</a>`).join("")}</nav></section>`
    : snapshot.media?.map((item) => `<img class="media media-${item.imageRole}" src="${escapeHtml(item.href)}" alt="${escapeHtml(item.altText)}" loading="lazy">`).join("\n") ?? "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>html{color-scheme:dark;background:${appearance.backgroundColor}}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;color:${appearance.textColor};background:${appearance.backgroundMode === "gradient" ? `linear-gradient(145deg,${appearance.backgroundColor},${appearance.primaryColor}33)` : appearance.backgroundColor}}main{box-sizing:border-box;width:min(100% - 2rem,38rem);margin:2rem auto;padding:2rem;text-align:center;border:2px solid ${appearance.textColor};background:${appearance.cardColor};box-shadow:8px 8px 0 ${appearance.primaryColor}}.page-label{display:block;margin-bottom:1rem;font-size:.72rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${appearance.primaryColor}}h1{margin:0;font-size:clamp(2rem,7vw,3rem);line-height:1.1;letter-spacing:-.045em}p{margin:.5rem auto;white-space:pre-line}.bio{color:${appearance.textColor};opacity:.8;max-width:34rem}.media{display:block;width:100%;max-height:34rem;object-fit:cover;border-radius:${radius};margin:1rem 0;background:${appearance.cardColor}}.media-avatar{aspect-ratio:1;max-width:13rem;margin:1rem auto}.photo-carousel-track{display:flex;gap:.75rem;overflow-x:auto;scroll-snap-type:x mandatory}.photo-carousel-track .media{flex:0 0 100%;height:min(70vw,27rem);margin:1rem 0;scroll-snap-align:center}.photo-carousel nav{display:flex;justify-content:center;gap:.5rem}.photo-carousel nav a{min-width:1.5rem;padding:.2rem;border:2px solid currentColor;color:inherit;text-decoration:none}.photo-carousel nav a:focus-visible{outline:3px solid ${appearance.primaryColor};outline-offset:3px}.actions,.links{display:grid;gap:.75rem;margin-top:2rem}.action,.link{display:flex;justify-content:space-between;gap:1rem;align-items:center;border:2px solid ${appearance.textColor};border-radius:${radius};padding:1rem 1.1rem;color:inherit;background:${appearance.cardColor};text-decoration:none;text-align:left;font-weight:700;box-shadow:4px 4px 0 ${appearance.textColor}}.action{justify-content:center;background:${appearance.primaryColor};color:${appearance.backgroundColor}}.link{background:${appearance.primaryColor};color:${appearance.backgroundColor}}.link.outline{background:transparent;border-color:${appearance.primaryColor};color:${appearance.textColor}}.link.soft{background:${appearance.cardColor};color:${appearance.textColor}}.link.elevated{box-shadow:0 6px 0 ${appearance.primaryColor}55}.action:hover,.link:hover{transform:translate(2px,2px);box-shadow:2px 2px 0 ${appearance.textColor}}.action:focus-visible,.link:focus-visible{outline:3px solid ${appearance.primaryColor};outline-offset:4px}.link span{opacity:.75}@media(max-width:480px){main{width:calc(100% - 2rem);padding:1.25rem;box-shadow:5px 5px 0 ${appearance.primaryColor}}}</style></head>
<body><main><span class="page-label">Creator page</span><h1>${title}</h1>${media}${headline}${bio}${actions ? `<nav class="actions" aria-label="Creator actions">${actions}</nav>` : ""}${links ? `<nav class="links" aria-label="Links">${links}</nav>` : ""}</main></body></html>`;
}

function renderAma(profile: PublicProfileSnapshot, projection: PublicAmaProjection, siteKey?: string, sent = false) {
  const appearance = profile.appearance ?? { backgroundColor: "#0d0c10", primaryColor: "#7655f6", textColor: "#f8f6fa", cardColor: "#211a29" };
  const title = escapeHtml(profile.creator.displayName);
  const slug = encodeURIComponent(profile.creator.slug);
  const total = projection.cards.length;
  const cards = projection.cards.map((card, index) => {
    const previous = projection.cards[index - 1];
    const next = projection.cards[index + 1];
    return `<article id="q-${card.id}" class="qa-card" aria-label="Question ${index + 1} of ${total}">
      <div class="card-top"><span class="eyebrow">THAT HUB · QUESTIONS</span><span class="count">${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span></div>
      <div class="qa-content"><section aria-label="Question"><span class="section-label">QUESTION</span><h2>${escapeHtml(card.question)}</h2></section>
      <section class="reply" aria-label="${title}'s answer"><span class="section-label">${escapeHtml(profile.creator.displayName.toUpperCase())} ANSWERS</span><p>${escapeHtml(card.answer)}</p></section></div>
      <footer><time datetime="${card.publishedAt}">${escapeHtml(card.publishedAt.slice(0, 10))}</time><a href="#q-${card.id}" aria-label="Link to question ${index + 1}">Link to this card ↗</a></footer>
      <nav class="card-nav" aria-label="Question navigation"><span>${previous ? `<a href="#q-${previous.id}" aria-label="Previous question">← Previous</a>` : ""}</span><span>${next ? `<a href="#q-${next.id}" aria-label="Next question">Next →</a>` : ""}</span></nav>
    </article>`;
  }).join("");
  const ask = siteKey ? `<section class="ask" aria-labelledby="ask-heading"><div><p class="eyebrow">YOUR TURN</p><h2 id="ask-heading">Ask a question.</h2><p>Your question goes to ${title} privately. They choose whether to answer and publish it. Please leave out names, contact details and other personal information.</p></div><form method="post" action="/${slug}/ama/ask"><label for="ama-question">Your question</label><textarea id="ama-question" name="question" maxlength="800" required placeholder="What would you like to know?"></textarea><div class="trap" aria-hidden="true"><label for="ama-website">Website</label><input id="ama-website" name="website" tabindex="-1" autocomplete="off"></div><label class="ack"><input type="checkbox" name="acknowledge" value="yes" required><span>I understand my question may appear publicly with an answer if the creator approves it.</span></label><div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}"></div><button type="submit">Send question <span aria-hidden="true">↗</span></button></form></section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Questions &amp; answers · ${title}</title><style>
    *{box-sizing:border-box}html{color-scheme:dark;background:${appearance.backgroundColor};scroll-behavior:smooth}body{margin:0;min-height:100vh;color:${appearance.textColor};background:radial-gradient(circle at 85% 0%,${appearance.primaryColor}3b,transparent 38%),${appearance.backgroundColor};font:16px/1.5 ui-sans-serif,system-ui,sans-serif}main{width:min(100% - 2rem,72rem);margin:auto;padding:clamp(1.5rem,5vw,4rem) 0 5rem}a{color:inherit}header{max-width:44rem;margin:0 auto 2.5rem}header>a{text-decoration:none;font-weight:700}h1{font-size:clamp(2.4rem,7vw,4.4rem);letter-spacing:-.055em;line-height:1.02;margin:1.5rem 0 .7rem}header p{opacity:.8;margin:0}.collection{display:flex;gap:1.5rem;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding-inline:calc((100% - min(100%,42rem))/2);padding:0 max(0px,calc((100% - 42rem)/2)) 1.25rem;overscroll-behavior-inline:contain}.qa-card{flex:0 0 min(100%,42rem);scroll-snap-align:center;min-height:31rem;display:flex;flex-direction:column;color:#201c2d;background:#fffaf2;border:2px solid #201c2d;border-radius:1.25rem;box-shadow:8px 8px 0 #201c2d;overflow-wrap:anywhere}.card-top{display:flex;justify-content:space-between;gap:1rem;align-items:center;border-bottom:2px solid #201c2d;padding:1rem 1.4rem}.eyebrow,.count,.section-label{font-size:.72rem;letter-spacing:.12em;font-weight:850}.count{white-space:nowrap}.qa-content{padding:clamp(1.4rem,5vw,2.5rem);flex:1}.section-label{display:block;color:#615b6c;margin-bottom:.7rem}.qa-content h2{font-family:Georgia,serif;font-size:clamp(1.5rem,4vw,2.2rem);line-height:1.22;letter-spacing:-.025em;margin:0;white-space:pre-line}.reply{border-top:2px solid #201c2d;margin-top:2rem;padding-top:1.5rem}.reply p{font-size:clamp(1rem,2.5vw,1.16rem);line-height:1.65;white-space:pre-line;margin:0}.qa-card footer,.card-nav{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.8rem 1.4rem;border-top:1px solid #201c2d;font-size:.8rem}.qa-card footer a,.card-nav a{font-weight:750;text-underline-offset:.2rem}.card-nav{min-height:3.3rem;background:#ede8fb;font-size:.9rem}.empty{max-width:42rem;margin:auto;background:${appearance.cardColor};padding:1.5rem;border-radius:1rem}.hint{text-align:center;font-size:.85rem;opacity:.8;margin:1rem auto}.sent{max-width:42rem;margin:1rem auto;padding:1rem 1.25rem;background:#e5f4ed;color:#185b3e;border-radius:.7rem;font-weight:750}.ask{max-width:68rem;margin:4rem auto 0;padding:clamp(1.5rem,4vw,3rem);display:grid;grid-template-columns:1fr 1fr;gap:clamp(2rem,5vw,5rem);background:${appearance.cardColor};border:1px solid ${appearance.textColor}33;border-radius:1.25rem}.ask h2{font:700 clamp(2rem,4vw,3.5rem)/1.07 Georgia,serif;letter-spacing:-.035em;margin:.7rem 0}.ask p{line-height:1.65;opacity:.84}.ask form{display:grid;gap:1rem}.ask label{font-weight:750}.ask textarea{width:100%;min-height:9rem;resize:vertical;border-radius:.8rem;border:1px solid #b8abb9;background:#fffaf7;color:#201c2d;padding:1rem;font:inherit;line-height:1.5}.ask .ack{display:flex;align-items:flex-start;gap:.7rem;font-size:.86rem;line-height:1.4}.ask .ack input{flex:none;margin:.2rem 0}.ask button{width:max-content;border:0;border-radius:.75rem;background:#f5a7c4;color:#201c2d;padding:.85rem 1.2rem;font:inherit;font-weight:850;cursor:pointer}.trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}:focus-visible{outline:3px solid #f49cbe;outline-offset:3px}@media(max-width:44rem){main{width:100%;padding-top:1.5rem}header{padding:0 1rem}.collection{gap:1rem;padding:0 1rem 1.25rem;scroll-padding-inline:1rem}.qa-card{flex-basis:calc(100vw - 2rem);min-height:28rem;box-shadow:5px 5px 0 #201c2d}.hint{padding:0 1rem}.ask{margin:3rem 1rem 0;grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style>${siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}</head><body><main><header><a href="/${slug}">← ${title}</a><h1>Questions &amp; answers</h1><p>Published answers from ${title}.</p></header>${sent ? '<p class="sent" role="status">Question sent privately. The creator decides whether to answer and publish it.</p>' : ""}${cards ? `<div class="collection" aria-label="Published questions and answers">${cards}</div><p class="hint">Swipe to browse · Open a card’s link to share it</p>` : '<p class="empty">No published answers yet.</p>'}${ask}</main></body></html>`;
}

function isStaticAssetPath(pathname: string) {
  return pathname === "/robots.txt" || pathname === "/favicon.ico" || pathname.startsWith("/assets/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const routeParts = url.pathname.split("/").filter(Boolean);
    const askPath = routeParts.length === 3 && routeParts[1] === "ama" && routeParts[2] === "ask" && isPublicCreatorSlug(routeParts[0]);
    if (request.method !== "GET" && request.method !== "HEAD" && !(askPath && request.method === "POST")) return textResponse("Method not allowed", 405, { allow: askPath ? "GET, HEAD, POST" : "GET, HEAD" });
    const infrastructure = !routeParts.length || isStaticAssetPath(url.pathname) || url.pathname === "/healthz";
    const liveSlug = infrastructure ? undefined : routeParts[0] === "go" || routeParts[0] === "media" ? routeParts[1] : routeParts[0];
    const guarded = livePublicHostGuard(request, env, "profile", liveSlug);
    if (guarded) return guarded;
    if (isStaticAssetPath(url.pathname)) return env.ASSETS.fetch(request);
    if (url.pathname === "/healthz") return textResponse("ok", 200, { "cache-control": "public, max-age=60" });

    const segments = routeParts;
    if (askPath && request.method === "POST") {
      const profile = await loadSnapshot(env, segments[0]);
      return profile ? sendAmaQuestion(request, env as AmaEnv, segments[0]) : textResponse("Not found", 404);
    }
    if (segments.length === 2 && isPublicCreatorSlug(segments[0]) && segments[1] === "ama") {
      const profile = await loadSnapshot(env, segments[0]);
      if (!profile) return textResponse("Not found", 404);
      const amaEnv = env as AmaEnv;
      const projection = await loadAmaProjection(amaEnv, profile);
      if (!projection) return textResponse("Not found", 404);
      const siteKey = amaEnv.AMA_SERVICE && amaEnv.AMA_RATE_LIMITER && amaEnv.AMA_TURNSTILE_SITE_KEY ? amaEnv.AMA_TURNSTILE_SITE_KEY : undefined;
      const headers = { ...securityHeaders(), "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
      if (siteKey) headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; upgrade-insecure-requests";
      return new Response(request.method === "HEAD" ? null : renderAma(profile, projection, siteKey, url.searchParams.get("sent") === "1"), { headers });
    }
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

    if (segments.length === 3 && segments[0] === "go" && isPublicCreatorSlug(segments[1]) && LINK_ID.test(segments[2])) {
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
