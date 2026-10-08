import { effectiveBookingFields, validateBookingConfig, validateBookingEnquiry, type BookingConfig, type BookingEnquiry, type BookingField } from "../../shared/booking-contract.ts";
import { appearanceCss, contrastRatio, parseProfileAppearance, type ProfileAppearance } from "../../thot-os-next/src/lib/profile-appearance-contract.ts";
import { livePublicHostGuard } from "../../shared/live-public-host.ts";

type Profile = { schemaVersion: 2; creator: { id: string; slug: string; displayName: string }; versionId: string; config: BookingConfig; channels: { sms: string; email: string } };
type Bindings = { PUBLIC_LINKS_CONTROL?: Fetcher; BOOKING_SERVICE_TOKEN?: string; BOOKING_FORM_SECRET?: string; BOOKING_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> } };
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/, MAX = 32768, TTL = 1800000, enc = new TextEncoder();
const esc = (s: string) => s.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c] ?? c);
const headers = (nonce?: string) => ({ "cache-control": "no-store", "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src${nonce ? ` 'nonce-${nonce}'` : ""} https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, "referrer-policy": "same-origin", "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()", "strict-transport-security": "max-age=31536000; includeSubDomains", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "x-robots-tag": "noindex, nofollow, noarchive" });
const page = (body: string, status = 200, nonce?: string) => new Response(body, { status, headers: { ...headers(nonce), "content-type": "text/html; charset=utf-8" } });

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
async function current(env: Bindings, p: Profile): Promise<ProfileAppearance | null> {
  const request = control(env, "/booking/check", { creatorId: p.creator.id, slug: p.creator.slug, versionId: p.versionId });
  try { const res = request && await request, body = res && await res.json() as { ok?: unknown; appearance?: Record<string, unknown> }; return res?.ok && body?.ok === true ? parseProfileAppearance(body.appearance ?? {}) : null; } catch { return null; }
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
  for (const name of ["phone", "date", "time", "endTime", "timezone", "address", "suburb", "occasion", "specialRequests"] as BookingField[]) if (fields[name].visible) result[name] = value(form, name);
  if (fields.wear.visible) result.wear = form.getAll("wear").map(String);
  if (fields.guests.visible) { const raw = value(form, "guests"); result.guests = raw ? Number(raw) : undefined; }
  if (fields.extras.visible) result.extras = form.getAll("extras").map(String);
  result.instagram = value(form, "instagram");
  return result as BookingEnquiry;
}
async function challenge(token: string, request: Request, env: Env) {
  if (!token || token.length > 2048 || request.headers.get("origin") !== new URL(request.url).origin) return false;
  try { const res = await globalThis.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }) }); const body = await res.json() as { success?: boolean; action?: string; hostname?: string }; return body.success === true && body.action === "booking" && (!!env.TURNSTILE_EXPECTED_HOSTNAME && body.hostname === env.TURNSTILE_EXPECTED_HOSTNAME); } catch { return false; }
}
function choices(name: "wear" | "extras", items: BookingConfig["wear"], required: boolean, multiple = false) { return !items.length ? "" : `<fieldset class="choices"><legend>${name === "wear" ? "Uniform" : "Extra spice"}</legend>${multiple && required ? "<small>Choose at least one.</small>" : ""}<div class="choice-list">${items.map(x => `<div class="choice"><label><input type="${multiple ? "checkbox" : "radio"}" name="${name}" value="${esc(x.id)}"${required && !multiple ? " required" : ""}><strong>${esc(x.label)}</strong></label><details><summary>What to expect</summary><small>${esc(x.description)}</small></details></div>`).join("")}</div></fieldset>`; }
function theme(appearance: ProfileAppearance) { return [...Object.entries(appearanceCss(appearance)), ["--profile-primary-shadow", `${appearance.primaryColor}55`]].map(([name, value]) => `${name}:${value}`).join(";"); }
function colorScheme(appearance: ProfileAppearance) { return contrastRatio(appearance.backgroundColor, "#ffffff") > contrastRatio(appearance.backgroundColor, "#000000") ? "dark" : "light"; }
async function render(p: Profile, env: Env & Bindings, appearance: ProfileAppearance) {
  const id = crypto.randomUUID(), issued = String(Date.now()), signature = await sign(env.BOOKING_FORM_SECRET!, p, id, issued), title = p.config.label || "Booking enquiry", nonce = crypto.randomUUID();
  const enabled = effectiveBookingFields(p.config), fields = [["First name", "firstName", "text", 80], ["Last name", "lastName", "text", 80], ["Phone", "phone", "tel", 32], ["Email", "email", "email", 254], ["Date", "date", "date", 0], ["Start time", "time", "time", 0], ["End time", "endTime", "time", 0], ["Timezone", "timezone", "text", 80], ["Street address", "address", "text", 300], ["Suburb", "suburb", "text", 100], ["Guests", "guests", "number", 0], ["Occasion", "occasion", "text", 160]];
  const field = ([label, name, type, max]: (string | number)[]) => { const setting = name === "firstName" || name === "lastName" || name === "email" ? { visible: true, required: true } : enabled[name as BookingField]; return setting.visible ? `<label class="field">${label}<input name="${name}" type="${type}"${max ? ` maxlength="${max}"` : ""}${name === "timezone" ? " value=\"Australia/Perth\" placeholder=\"e.g. Australia/Perth\"" : ""}${setting.required ? " required" : ""}></label>` : ""; };
  const contact = fields.slice(0, 4).map(field).join(""), event = fields.slice(4).map(field).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(p.creator.displayName)}</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root { color-scheme: ${colorScheme(appearance)}; ${theme(appearance)} } * { box-sizing: border-box }
body { font: 16px/1.5 system-ui,sans-serif; background: var(--profile-background); background-image: var(--profile-background-image); color: var(--profile-text); margin: 0 }
.card { max-width: 45rem; margin: clamp(1rem,4vw,3rem) auto; padding: clamp(1.25rem,4vw,2.5rem); background: var(--profile-card); border: 1px solid var(--profile-primary); border-radius: min(var(--profile-radius), 1rem); box-shadow: 0 1.5rem 4rem #0005 }
h1 { font-size: clamp(1.8rem,5vw,2.5rem); line-height: 1.1; letter-spacing: -.035em; margin: 0 0 .65rem } h1 + p, .rules p, .choice small { color: var(--profile-text) } h1 + p { margin: 0 0 1.75rem }
form, .form-section, .form-grid, .field, .choice-list { display: grid; gap: .9rem } form { gap: 1.25rem } .field { gap: .4rem; font-weight: 650 } .field input, .field textarea { width: 100% }
fieldset, .rules { border: 1px solid var(--profile-primary); border-radius: min(var(--profile-radius), 1rem); margin: 0; padding: 1rem } legend { padding: 0 .35rem; font-weight: 700 }
input, textarea, button { font: inherit } input, textarea { min-height: 2.75rem; padding: .65rem .75rem; border: 1px solid var(--profile-primary); border-radius: min(var(--profile-radius), .85rem); background: var(--profile-background); color: inherit; transition: border-color .15s ease, box-shadow .15s ease } textarea { min-height: 7rem; resize: vertical } input::placeholder { color: var(--profile-text) } input:hover, textarea:hover { border-color: var(--profile-text) }
input:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible, .choice:focus-within { outline: 2px solid var(--profile-primary); outline-offset: 2px; border-color: var(--profile-primary); box-shadow: 0 0 0 3px var(--profile-primary) }
.form-section > .form-grid { grid-template-columns: repeat(2,minmax(0,1fr)) } .form-section > .form-grid .field:nth-last-child(1):nth-child(odd) { grid-column: span 2 }
.choices { padding: .9rem 1rem 1rem } .choice-list { gap: .6rem } .choice { min-height: 2.75rem; padding: .65rem .7rem; border: 1px solid transparent; border-radius: min(var(--profile-radius), .85rem) } .choice:hover, .choice:has(input:checked) { background: var(--profile-background); border-color: var(--profile-primary) } .choice label { display: flex; align-items: flex-start; gap: .75rem; cursor: pointer } .choice input, .confirmation input { accent-color: var(--profile-primary); min-height: 0; padding: 0; width: 1.1rem; height: 1.1rem; margin: .15rem 0 0; flex: 0 0 auto } .choice strong, .choice small { display: block } .choice details { margin: .35rem 0 0 1.85rem } .choice summary { cursor: pointer; color: var(--profile-text) } .choice small { margin-top: .25rem }
.rules { padding: .95rem 1rem } .rules[open] { background: var(--profile-background) } .rules summary { cursor: pointer; font-weight: 700; min-height: 2.75rem; padding: .55rem 0 } .rules p { margin: .5rem 0 1rem } .confirmation { display: flex; align-items: flex-start; gap: .75rem; min-height: 2.75rem; padding: .2rem }.consent-info summary { cursor: pointer; min-height: 2.75rem; display: flex; align-items: center; gap: .5rem } .consent-info summary span { font-size: .875rem } .cf-turnstile { min-height: 65px }
button { min-height: 2.75rem; padding: .7rem 1rem; border: 1px solid var(--profile-primary); border-radius: min(var(--profile-radius), .85rem); background: var(--profile-primary); color: var(--profile-background); font-weight: 750; cursor: pointer; transition: transform .15s ease, background .15s ease } button:hover { filter: brightness(1.12) } button:active { transform: translateY(1px) } [data-button-style="full-pill"] button { border-radius: 999px } [data-button-style="minimal-outline"] button { background: transparent; color: var(--profile-text) } [data-button-style="soft-card-icon"] button { background: var(--profile-card); color: var(--profile-text) } [data-button-style="elevated-shadow-tile"] button { box-shadow: 0 6px 0 var(--profile-primary-shadow) }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important } }
@media (max-width: 38rem) { .card { border-radius: 0; min-height: 100dvh } .form-section > .form-grid { grid-template-columns: 1fr } .form-section > .form-grid .field:nth-last-child(1):nth-child(odd) { grid-column: auto } }
</style></head><body data-button-style="${appearance.buttonStyle}"><main class="card"><h1>${esc(title)}</h1><p>Enquiry for ${esc(p.creator.displayName)}. This is not a confirmed booking.</p>
<form method="post"><input type="hidden" name="submissionId" value="${id}"><input type="hidden" name="issuedAt" value="${issued}"><input type="hidden" name="signature" value="${signature}">
<fieldset class="form-section"><legend>Your details</legend><div class="form-grid">${contact}</div></fieldset>
${event ? `<fieldset class="form-section"><legend>Event details</legend><div class="form-grid">${event}</div></fieldset>` : ""}
${enabled.wear.visible ? choices("wear", p.config.wear, enabled.wear.required, true) : ""}${enabled.extras.visible ? choices("extras", p.config.extras, enabled.extras.required, true) : ""}
${enabled.specialRequests.visible ? `<label class="field">Special requests<textarea name="specialRequests" maxlength="2000"${enabled.specialRequests.required ? " required" : ""}></textarea></label>` : ""}
<label class="field">Instagram <small>(optional)</small><input name="instagram" maxlength="31" autocomplete="off" placeholder="@handle"></label>
<details class="rules" id="booking-rules"><summary>Booking rules</summary><p>${esc(p.config.rules).replaceAll("\n", "<br>")}</p><label class="confirmation"><input type="checkbox" name="acknowledged" value="yes" required><span>I have read and agree to these rules.</span></label></details>
<label class="confirmation"><input type="checkbox" name="consent" value="yes" required><span>I consent to sending my enquiry and my details to ${esc(p.creator.displayName)}.</span></label>
<details class="consent-info"><summary aria-label="How your enquiry details are used">ⓘ <span>How your details are used</span></summary><p>Your details will be emailed to ${esc(p.creator.displayName)}. Messaging drafts include your full-address Maps link.</p></details><div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}" data-action="booking"></div><p id="rules-error" role="alert" aria-live="polite" hidden></p><button>These details are correct—send my enquiry</button></form><script nonce="${nonce}">(()=>{const form=document.querySelector("form"),rules=document.querySelector("#booking-rules"),ack=form.elements.acknowledged,error=document.querySelector("#rules-error"),show=()=>{error.hidden=false;error.textContent="Don’t skip the fine print, read the rules."},clear=()=>{if(opened&&ack.checked)error.hidden=true};let opened=rules.open;rules.addEventListener("toggle",()=>{opened||=rules.open;clear()});ack.addEventListener("change",clear);form.querySelector("button").addEventListener("click",()=>{if(!opened||!ack.checked)show()});form.addEventListener("invalid",event=>{if(event.target===ack)show()},true);form.addEventListener("submit",event=>{if(!opened||!ack.checked){event.preventDefault();show();(opened?ack:rules.querySelector("summary")).focus()}})})()</script></main></body></html>`;
  return { html, nonce };
}
function handoff(sms: string, whatsapp: string, appearance: ProfileAppearance, replyStatus?: unknown) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry accepted</title>
<style>
:root { color-scheme: ${colorScheme(appearance)}; ${theme(appearance)} } * { box-sizing: border-box }
body { font: 16px/1.5 system-ui,sans-serif; background: var(--profile-background); background-image: var(--profile-background-image); color: var(--profile-text); margin: 0 }
.card { max-width: 45rem; margin: clamp(1rem,4vw,3rem) auto; padding: clamp(1.5rem,5vw,3rem); background: var(--profile-card); border: 1px solid var(--profile-primary); border-radius: min(var(--profile-radius), 1rem); box-shadow: 0 1.5rem 4rem #0005 }
h1 { font-size: clamp(1.8rem,5vw,2.5rem); line-height: 1.1; letter-spacing: -.035em; margin: 0 0 .75rem } p { color: var(--profile-text); margin: 0 }
.actions { display: grid; gap: .75rem; margin-top: 1.5rem } a { display: flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: .7rem 1rem; border: 1px solid var(--profile-primary); border-radius: min(var(--profile-radius), .85rem); background: var(--profile-primary); color: var(--profile-background); font-weight: 750; text-decoration: none } a:hover { filter: brightness(1.12) } a:focus-visible { outline: 2px solid var(--profile-primary); outline-offset: 2px } [data-button-style="full-pill"] a { border-radius: 999px } [data-button-style="minimal-outline"] a { background: transparent; color: var(--profile-text) } [data-button-style="soft-card-icon"] a { background: var(--profile-card); color: var(--profile-text) } [data-button-style="elevated-shadow-tile"] a { box-shadow: 0 6px 0 var(--profile-primary-shadow) }
@media (max-width: 38rem) { .card { border-radius: 0; min-height: 100dvh } }
</style></head><body data-button-style="${appearance.buttonStyle}"><main class="card"><h1>Enquiry accepted</h1><p>Your email has been accepted for delivery. This is not a confirmed booking. Review and send a draft from your device.</p>${replyStatus === "accepted" ? "<p>Your acknowledgement email has also been accepted for delivery.</p>" : replyStatus === "uncertain" ? "<p>Your enquiry was received, but we could not confirm your acknowledgement email. Please do not submit it again.</p>" : ""}<div class="actions"><a href="${esc(whatsapp)}">Continue in WhatsApp</a><a href="${esc(sms)}">Continue by text message</a></div></main></body></html>`;
}
function handoffLinks(p: Profile, sms: string, whatsapp: string, appearance: ProfileAppearance, replyStatus?: unknown) { return sms.startsWith(`sms:${p.channels.sms}?`) && whatsapp.startsWith(`https://wa.me/${p.channels.sms.slice(1)}?`) ? handoff(sms, whatsapp, appearance, replyStatus) : null; }

export default { async fetch(request: Request, env: Env & Bindings): Promise<Response> {
  const url = new URL(request.url), parts = url.pathname.split("/").filter(Boolean); const guarded = livePublicHostGuard(request, env, "booking", parts[0] === "book" ? parts[1] : undefined); if (guarded) return guarded; if (parts.length !== 2 || parts[0] !== "book" || !SLUG.test(parts[1])) return page("Not found", 404); if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...headers(), allow: "GET, POST" } }); if (!ready(env)) return page("Not found", 404);
  const p = profile(await env.CONTACT_PROFILES.get(`public-contact:${parts[1]}`, "json").catch(() => null), parts[1]); if (!p?.config.enabled) return page("Not found", 404);
  if (request.method === "GET") { const appearance = await current(env, p); if (!appearance) return page("Not found", 404); try { env.CONTACT_EVENTS.writeDataPoint({ indexes: [p.creator.slug], blobs: ["booking_open"], doubles: [1] }); } catch {} const rendered = await render(p, env, appearance); return page(rendered.html, 200, rendered.nonce); }
  if (request.headers.get("origin") !== url.origin) return page("Unable to submit booking", 400); const data = await form(request); if (!data) return page("Unable to submit booking", 400); const id = value(data, "submissionId"), issued = value(data, "issuedAt"), signature = value(data, "signature"), n = Number(issued); let e: BookingEnquiry;
  try { if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(n) || n > Date.now() || Date.now() - n > TTL || !equal(signature, await sign(env.BOOKING_FORM_SECRET!, p, id, issued))) throw new Error(); e = validateBookingEnquiry(enquiry(data, p.config), p.config); } catch { return page("Unable to submit booking", 400); }
  const ip = request.headers.get("cf-connecting-ip"); if (!ip || !await challenge(value(data, "cf-turnstile-response"), request, env) || !await env.BOOKING_RATE_LIMITER!.limit({ key: `booking:${p.creator.id}:${ip}` }).then(x => x.success).catch(() => false)) return page("Unable to submit booking", 400); const appearance = await current(env, p); if (!appearance) return page("Unable to submit booking", 400);
  const submit = control(env, "/booking/submit", { creatorId: p.creator.id, slug: p.creator.slug, versionId: p.versionId, submissionId: id, issuedAt: n, enquiry: e }); try { const res = submit && await submit, body = res && await res.json() as { ok?: unknown; sms?: unknown; whatsapp?: unknown; replyStatus?: unknown }, result = body?.ok === true && typeof body.sms === "string" && typeof body.whatsapp === "string" ? handoffLinks(p, body.sms, body.whatsapp, appearance, body.replyStatus) : null; if (!res?.ok || !result) throw new Error(); return page(result); } catch { return page("Unable to submit booking", 400); }
} } satisfies ExportedHandler<Env & Bindings>;
