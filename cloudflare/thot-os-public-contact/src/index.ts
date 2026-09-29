import { effectiveBookingFields, validateBookingConfig, validateBookingEnquiry, type BookingConfig, type BookingEnquiry, type BookingField } from "../../shared/booking-contract.ts";

type Profile = { schemaVersion: 2; creator: { id: string; slug: string; displayName: string }; versionId: string; config: BookingConfig; channels: { sms: string; email: string } };
type Bindings = { PUBLIC_LINKS_CONTROL?: Fetcher; BOOKING_SERVICE_TOKEN?: string; BOOKING_FORM_SECRET?: string; BOOKING_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> } };
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/, MAX = 32768, TTL = 1800000, enc = new TextEncoder();
const esc = (s: string) => s.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c] ?? c);
const headers = () => ({ "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer", "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()", "strict-transport-security": "max-age=31536000; includeSubDomains", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "x-robots-tag": "noindex, nofollow, noarchive" });
const page = (body: string, status = 200) => new Response(body, { status, headers: { ...headers(), "content-type": "text/html; charset=utf-8" } });

function profile(value: unknown, slug: string): Profile | null {
  try {
    const p = value as Partial<Profile>;
    if (!p || typeof p !== "object" || p.schemaVersion !== 2 || !p.creator || p.creator.slug !== slug || !SLUG.test(slug) || typeof p.creator.id !== "string" || !p.creator.id || typeof p.creator.displayName !== "string" || typeof p.versionId !== "string" || !p.versionId || !p.channels || !/^\+[1-9]\d{5,14}$/.test(p.channels.sms ?? "") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.channels.email ?? "")) return null;
    return { schemaVersion: 2, creator: p.creator, versionId: p.versionId, config: validateBookingConfig(p.config), channels: p.channels };
  } catch { return null; }
}
const ready = (env: Bindings) => !!env.PUBLIC_LINKS_CONTROL && typeof env.BOOKING_SERVICE_TOKEN === "string" && env.BOOKING_SERVICE_TOKEN.length >= 40 && typeof env.BOOKING_FORM_SECRET === "string" && env.BOOKING_FORM_SECRET.length >= 32 && !!env.BOOKING_RATE_LIMITER;
function control(env: Bindings, path: string, body: unknown) {
  if (!ready(env)) return null;
  return env.PUBLIC_LINKS_CONTROL!.fetch(`https://public-links-control${path}`, { method: "POST", headers: { authorization: `Bearer ${env.BOOKING_SERVICE_TOKEN}`, "content-type": "application/json", "x-thot-os-service-capability": "booking.enquiry.submit" }, body: JSON.stringify(body) });
}
async function current(env: Bindings, p: Profile) {
  const request = control(env, "/booking/check", { creatorId: p.creator.id, slug: p.creator.slug, versionId: p.versionId });
  try { const res = request && await request, body = res && await res.json() as { ok?: unknown }; return !!res?.ok && body?.ok === true; } catch { return false; }
}
async function sign(secret: string, p: Profile, id: string, issued: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${p.creator.slug}\n${p.versionId}\n${id}\n${issued}`)));
  return btoa(String.fromCharCode(...raw)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function equal(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function form(request: Request) {
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > MAX) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > MAX) { await reader.cancel(); return null; } chunks.push(next.value); } } catch { await reader.cancel().catch(() => undefined); return null; }
  const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new Request("https://form.invalid", { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: bytes }).formData().catch(() => null);
}
const value = (form: FormData, name: string) => String(form.get(name) ?? "");
function enquiry(form: FormData, config: BookingConfig): BookingEnquiry {
  const fields = effectiveBookingFields(config), result: Record<string, unknown> = { firstName: value(form, "firstName"), lastName: value(form, "lastName"), email: value(form, "email"), consent: form.get("consent") === "yes", acknowledged: form.get("acknowledged") === "yes" };
  for (const name of ["phone", "date", "time", "timezone", "address", "suburb", "occasion", "wear", "specialRequests"] as BookingField[]) if (fields[name].visible) result[name] = value(form, name);
  if (fields.guests.visible) { const raw = value(form, "guests"); result.guests = raw ? Number(raw) : undefined; }
  if (fields.extras.visible) result.extras = form.getAll("extras").map(String);
  return result as BookingEnquiry;
}
async function challenge(token: string, request: Request, env: Env) {
  if (!token || token.length > 2048 || request.headers.get("origin") !== new URL(request.url).origin) return false;
  try { const res = await globalThis.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }) }); const body = await res.json() as { success?: boolean; action?: string; hostname?: string }; return body.success === true && body.action === "booking" && (!!env.TURNSTILE_EXPECTED_HOSTNAME && body.hostname === env.TURNSTILE_EXPECTED_HOSTNAME); } catch { return false; }
}
function choices(name: "wear" | "extras", items: BookingConfig["wear"], required: boolean, multiple = false) { return !items.length ? "" : `<fieldset class="choices"><legend>${name === "wear" ? "What to wear" : "Extra spice"}</legend>${multiple && required ? "<small>Choose at least one.</small>" : ""}<div class="choice-list">${items.map(x => `<div class="choice"><label><input type="${multiple ? "checkbox" : "radio"}" name="${name}" value="${esc(x.id)}"${required && !multiple ? " required" : ""}><strong>${esc(x.label)}</strong></label><details><summary>What to expect</summary><small>${esc(x.description)}</small></details></div>`).join("")}</div></fieldset>`; }
async function render(p: Profile, env: Env & Bindings) {
  const id = crypto.randomUUID(), issued = String(Date.now()), signature = await sign(env.BOOKING_FORM_SECRET!, p, id, issued), title = p.config.label || "Booking enquiry";
  const enabled = effectiveBookingFields(p.config), fields = [["First name", "firstName", "text", 80], ["Last name", "lastName", "text", 80], ["Phone", "phone", "tel", 32], ["Email", "email", "email", 254], ["Date", "date", "date", 0], ["Time", "time", "time", 0], ["Timezone", "timezone", "text", 80], ["Street address", "address", "text", 300], ["Suburb", "suburb", "text", 100], ["Guests", "guests", "number", 0], ["Occasion", "occasion", "text", 160]];
  const field = ([label, name, type, max]: (string | number)[]) => { const setting = name === "firstName" || name === "lastName" || name === "email" ? { visible: true, required: true } : enabled[name as BookingField]; return setting.visible ? `<label class="field">${label}<input name="${name}" type="${type}"${max ? ` maxlength="${max}"` : ""}${name === "timezone" ? " value=\"Australia/Perth\" placeholder=\"e.g. Australia/Perth\"" : ""}${setting.required ? " required" : ""}></label>` : ""; };
  const contact = fields.slice(0, 4).map(field).join(""), event = fields.slice(4).map(field).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(p.creator.displayName)}</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root { color-scheme: dark } * { box-sizing: border-box }
body { font: 16px/1.5 system-ui,sans-serif; background: #100c16; color: #fbf8fe; margin: 0 }
.card { max-width: 45rem; margin: clamp(1rem,4vw,3rem) auto; padding: clamp(1.25rem,4vw,2.5rem); background: #15101c; border: 1px solid #51445d; border-radius: 1rem; box-shadow: 0 1.5rem 4rem #08050c80 }
h1 { font-size: clamp(1.8rem,5vw,2.5rem); line-height: 1.1; letter-spacing: -.035em; margin: 0 0 .65rem } h1 + p, .rules p, .choice small { color: #d8cfe1 } h1 + p { margin: 0 0 1.75rem }
form, .form-section, .form-grid, .field, .choice-list { display: grid; gap: .9rem } form { gap: 1.25rem } .field { gap: .4rem; font-weight: 650 } .field input, .field textarea { width: 100% }
fieldset, .rules { border: 1px solid #51445d; border-radius: .75rem; margin: 0; padding: 1rem } legend { padding: 0 .35rem; font-weight: 700 }
input, textarea, button { font: inherit } input, textarea { min-height: 2.75rem; padding: .65rem .75rem; border: 1px solid #766683; border-radius: .55rem; background: #100c16; color: inherit; transition: border-color .15s ease, box-shadow .15s ease } textarea { min-height: 7rem; resize: vertical } input::placeholder { color: #a99caf } input:hover, textarea:hover { border-color: #ad91c7 }
input:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible, .choice:focus-within { outline: 2px solid #e9d9ff; outline-offset: 2px; border-color: #d8baff; box-shadow: 0 0 0 3px #c5a4ff3d }
.form-section > .form-grid { grid-template-columns: repeat(2,minmax(0,1fr)) } .form-section > .form-grid .field:nth-last-child(1):nth-child(odd) { grid-column: span 2 }
.choices { padding: .9rem 1rem 1rem } .choice-list { gap: .6rem } .choice { min-height: 2.75rem; padding: .65rem .7rem; border: 1px solid transparent; border-radius: .55rem } .choice:hover, .choice:has(input:checked) { background: #21182b; border-color: #ad91c7 } .choice label { display: flex; align-items: flex-start; gap: .75rem; cursor: pointer } .choice input, .confirmation input { accent-color: #c5a4ff; min-height: 0; padding: 0; width: 1.1rem; height: 1.1rem; margin: .15rem 0 0; flex: 0 0 auto } .choice strong, .choice small { display: block } .choice details { margin: .35rem 0 0 1.85rem } .choice summary { cursor: pointer; color: #d8cfe1 } .choice small { margin-top: .25rem }
.rules { padding: .95rem 1rem } .rules[open] { background: #18121f } .rules summary { cursor: pointer; font-weight: 700; min-height: 2.75rem; padding: .55rem 0 } .rules p { margin: .5rem 0 1rem } .confirmation { display: flex; align-items: flex-start; gap: .75rem; min-height: 2.75rem; padding: .2rem }.cf-turnstile { min-height: 65px }
button { min-height: 2.75rem; padding: .7rem 1rem; border: 1px solid #d8baff; border-radius: .55rem; background: #c5a4ff; color: #170c24; font-weight: 750; cursor: pointer; transition: transform .15s ease, background .15s ease } button:hover { background: #d8baff } button:active { transform: translateY(1px) }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important } }
@media (max-width: 38rem) { .card { border-radius: 0; min-height: 100dvh } .form-section > .form-grid { grid-template-columns: 1fr } .form-section > .form-grid .field:nth-last-child(1):nth-child(odd) { grid-column: auto } }
</style></head><body><main class="card"><h1>${esc(title)}</h1><p>Enquiry for ${esc(p.creator.displayName)}. This is not a confirmed booking.</p>
<form method="post"><input type="hidden" name="submissionId" value="${id}"><input type="hidden" name="issuedAt" value="${issued}"><input type="hidden" name="signature" value="${signature}">
<fieldset class="form-section"><legend>Your details</legend><div class="form-grid">${contact}</div></fieldset>
${event ? `<fieldset class="form-section"><legend>Event details</legend><div class="form-grid">${event}</div></fieldset>` : ""}
${enabled.wear.visible ? choices("wear", p.config.wear, enabled.wear.required) : ""}${enabled.extras.visible ? choices("extras", p.config.extras, enabled.extras.required, true) : ""}
${enabled.specialRequests.visible ? `<label class="field">Special requests<textarea name="specialRequests" maxlength="2000"${enabled.specialRequests.required ? " required" : ""}></textarea></label>` : ""}
<details class="rules"><summary>Booking rules</summary><p>${esc(p.config.rules).replaceAll("\n", "<br>")}</p><label class="confirmation"><input type="checkbox" name="acknowledged" value="yes" required><span>I have read and agree to these rules.</span></label></details>
<label class="confirmation"><input type="checkbox" name="consent" value="yes" required><span>I consent to THOT OS emailing all these enquiry details to the creator, and including my name, date, time, suburb, and full-address Maps link in the WhatsApp/SMS drafts I choose to send.</span></label>
<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}" data-action="booking"></div><button>Send enquiry</button></form></main></body></html>`;
}
function handoff(sms: string, whatsapp: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry accepted</title>
<style>
:root { color-scheme: dark } * { box-sizing: border-box }
body { font: 16px/1.5 system-ui,sans-serif; background: #100c16; color: #fbf8fe; margin: 0 }
.card { max-width: 45rem; margin: clamp(1rem,4vw,3rem) auto; padding: clamp(1.5rem,5vw,3rem); background: #15101c; border: 1px solid #51445d; border-radius: 1rem; box-shadow: 0 1.5rem 4rem #08050c80 }
h1 { font-size: clamp(1.8rem,5vw,2.5rem); line-height: 1.1; letter-spacing: -.035em; margin: 0 0 .75rem } p { color: #d8cfe1; margin: 0 }
.actions { display: grid; gap: .75rem; margin-top: 1.5rem } a { display: flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: .7rem 1rem; border: 1px solid #d8baff; border-radius: .55rem; background: #c5a4ff; color: #170c24; font-weight: 750; text-decoration: none } a:hover { background: #d8baff } a:focus-visible { outline: 0; box-shadow: 0 0 0 3px #c5a4ff3d }
@media (max-width: 38rem) { .card { border-radius: 0; min-height: 100dvh } }
</style></head><body><main class="card"><h1>Enquiry accepted</h1><p>Your email has been accepted for delivery. This is not a confirmed booking. Review and send a draft from your device.</p><div class="actions"><a href="${esc(whatsapp)}">Continue in WhatsApp</a><a href="${esc(sms)}">Continue by text message</a></div></main></body></html>`;
}
function handoffLinks(p: Profile, sms: string, whatsapp: string) { return sms.startsWith(`sms:${p.channels.sms}?`) && whatsapp.startsWith(`https://wa.me/${p.channels.sms.slice(1)}?`) ? handoff(sms, whatsapp) : null; }

export default { async fetch(request: Request, env: Env & Bindings): Promise<Response> {
  const url = new URL(request.url), parts = url.pathname.split("/").filter(Boolean); if (parts.length !== 2 || parts[0] !== "book" || !SLUG.test(parts[1])) return page("Not found", 404); if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...headers(), allow: "GET, POST" } }); if (!ready(env)) return page("Not found", 404);
  const p = profile(await env.CONTACT_PROFILES.get(`public-contact:${parts[1]}`, "json").catch(() => null), parts[1]); if (!p?.config.enabled) return page("Not found", 404);
  if (request.method === "GET") { if (!await current(env, p)) return page("Not found", 404); try { env.CONTACT_EVENTS.writeDataPoint({ indexes: [p.creator.slug], blobs: ["booking_open"], doubles: [1] }); } catch {} return page(await render(p, env)); }
  if (request.headers.get("origin") !== url.origin) return page("Unable to submit booking", 400); const data = await form(request); if (!data) return page("Unable to submit booking", 400); const id = value(data, "submissionId"), issued = value(data, "issuedAt"), signature = value(data, "signature"), n = Number(issued); let e: BookingEnquiry;
  try { if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(n) || n > Date.now() || Date.now() - n > TTL || !equal(signature, await sign(env.BOOKING_FORM_SECRET!, p, id, issued))) throw new Error(); e = validateBookingEnquiry(enquiry(data, p.config), p.config); } catch { return page("Unable to submit booking", 400); }
  const ip = request.headers.get("cf-connecting-ip"); if (!ip || !await challenge(value(data, "cf-turnstile-response"), request, env) || !await env.BOOKING_RATE_LIMITER!.limit({ key: `booking:${p.creator.id}:${ip}` }).then(x => x.success).catch(() => false) || !await current(env, p)) return page("Unable to submit booking", 400);
  const submit = control(env, "/booking/submit", { creatorId: p.creator.id, slug: p.creator.slug, versionId: p.versionId, submissionId: id, issuedAt: n, enquiry: e }); try { const res = submit && await submit, body = res && await res.json() as { ok?: unknown; sms?: unknown; whatsapp?: unknown }, result = body?.ok === true && typeof body.sms === "string" && typeof body.whatsapp === "string" ? handoffLinks(p, body.sms, body.whatsapp) : null; if (!res?.ok || !result) throw new Error(); return page(result); } catch { return page("Unable to submit booking", 400); }
} } satisfies ExportedHandler<Env & Bindings>;
