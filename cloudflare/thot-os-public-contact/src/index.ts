type ContactChannel = "sms" | "email";

type ContactProfile = {
  schemaVersion: 1;
  creator: { slug: string; displayName: string };
  channels: Partial<Record<ContactChannel, string>>;
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function contactKey(slug: string) { return `public-contact:${slug}`; }

function noStoreHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow, noarchive",
  };
}

function response(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, { status, headers: { ...noStoreHeaders(), "content-type": "text/html; charset=utf-8", ...headers } });
}

function validProfile(value: unknown, slug: string): value is ContactProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Partial<ContactProfile>;
  if (profile.schemaVersion !== 1 || !profile.creator || !profile.channels || profile.creator.slug !== slug || !SLUG.test(slug) || typeof profile.creator.displayName !== "string" || profile.creator.displayName.length > 120) return false;
  const sms = profile.channels.sms;
  const email = profile.channels.email;
  if (sms !== undefined && (typeof sms !== "string" || !/^\+[1-9]\d{5,14}$/.test(sms))) return false;
  if (email !== undefined && (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return false;
  return Boolean(sms || email);
}

async function loadProfile(env: Env, slug: string) {
  const profile = await env.CONTACT_PROFILES.get(contactKey(slug), "json");
  return validProfile(profile, slug) ? profile : null;
}

function clean(value: FormDataEntryValue | null, maximum: number, label: string, required = true) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) || text.length > maximum || (required && !text)) throw new Error(`invalid_${label}`);
  return text;
}

function bookingMessage(displayName: string, form: FormData) {
  const visitor = clean(form.get("name"), 120, "name");
  const date = clean(form.get("date"), 10, "date");
  const time = clean(form.get("time"), 10, "time");
  const occasion = clean(form.get("occasion"), 160, "occasion");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("invalid_booking_time");
  const formattedDate = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
  const greeting = displayName || "there";
  return `Hello ${greeting}, My name is '${visitor}'\n\nI would love to book you to waitress for me on '${formattedDate}' at '${time}'\n\nThe occasion is '${occasion}'\n\nThank you`;
}

async function validTurnstile(token: string, request: Request, env: Env) {
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const decoded = await result.json().catch(() => null) as { success?: boolean; hostname?: string; action?: string } | null;
  const expected = env.TURNSTILE_EXPECTED_HOSTNAME;
  return Boolean(decoded?.success && decoded.action === "booking" && (!expected || decoded.hostname === expected) && request.headers.get("origin") === new URL(request.url).origin);
}

function writeEvent(env: Env, profile: ContactProfile, event: string) {
  try { env.CONTACT_EVENTS.writeDataPoint({ indexes: [profile.creator.slug], blobs: [event], doubles: [1] }); } catch { /* analytics must never expose or block contact */ }
}

function render(profile: ContactProfile, siteKey: string) {
  const options = (Object.keys(profile.channels) as ContactChannel[]).filter((channel) => profile.channels[channel]).map((channel) => `<label><input type="radio" name="channel" value="${channel}"${channel === "sms" ? " checked" : ""}> ${channel === "sms" ? "Book by SMS" : "Book by email"}</label>`).join("\n");
  const title = profile.creator.displayName ? `Book ${escapeHtml(profile.creator.displayName)}` : "Booking enquiry";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><style>body{font:16px/1.5 system-ui,sans-serif;background:#100c16;color:#fbf8fe;margin:0}.card{max-width:34rem;margin:2rem auto;padding:1.25rem}.field{display:grid;gap:.35rem;margin:.8rem 0}input,button{font:inherit;padding:.7rem;border-radius:.5rem}input{border:1px solid #7e708b;background:#18121f;color:inherit}fieldset{border:1px solid #7e708b;border-radius:.5rem;margin:.8rem 0;padding:.8rem;display:grid;gap:.5rem}button{border:0;background:#c5a4ff;color:#170c24;font-weight:700;width:100%}</style></head><body><main class="card"><h1>${title}</h1><p>Enter your details once and choose how you would like to contact the creator.</p><form method="post"><label class="field">Your name<input name="name" maxlength="120" required autocomplete="name"></label><label class="field">Date<input name="date" type="date" required></label><label class="field">Time<input name="time" type="time" required></label><label class="field">Occasion<input name="occasion" maxlength="160" required></label><fieldset><legend>Contact method</legend>${options}</fieldset><div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-action="booking"></div><button type="submit">Continue to booking message</button></form></main></body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2 || segments[0] !== "book" || !SLUG.test(segments[1])) return response("Not found", 404);
    if (request.method !== "GET" && request.method !== "POST") return response("Method not allowed", 405, { allow: "GET, POST" });
    const profile = await loadProfile(env, segments[1]);
    if (!profile) return response("Not found", 404);
    if (request.method === "GET") {
      writeEvent(env, profile, "contact_open");
      return response(render(profile, env.TURNSTILE_SITE_KEY));
    }
    const form = await request.formData().catch(() => null);
    if (!form) return response("Unable to start booking", 400);
    const channel = form?.get("channel");
    const token = String(form?.get("cf-turnstile-response") ?? "");
    if (!(channel === "sms" || channel === "email") || !profile.channels[channel] || !await validTurnstile(token, request, env)) return response("Unable to start booking", 400);
    try {
      const body = bookingMessage(profile.creator.displayName, form);
      const destination = channel === "sms"
        ? `sms:${profile.channels.sms}?body=${encodeURIComponent(body)}`
        : `mailto:${profile.channels.email}?subject=${encodeURIComponent(`Booking enquiry for ${profile.creator.displayName || "creator"}`)}&body=${encodeURIComponent(body)}`;
      writeEvent(env, profile, channel === "sms" ? "sms_booking_started" : "email_booking_started");
      return new Response(null, { status: 303, headers: { ...noStoreHeaders(), location: destination } });
    } catch {
      return response("Check your booking details and try again", 400);
    }
  },
} satisfies ExportedHandler<Env>;
