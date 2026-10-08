import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import worker from "../src/index.ts";
import { bookingEmail, bookingFieldNames, bookingLinks, effectiveBookingFields, validateBookingConfig, validateBookingEnquiry } from "../../shared/booking-contract.ts";

const profile = { schemaVersion: 2, creator: { id: "creator-1", slug: "adelaide", displayName: "Adelaide" }, versionId: "version-1", config: { enabled: true, label: "Book Adelaide", rules: "Public-safe events only.", wear: [{ id: "theme", label: "Theme", description: "Costume." }], extras: [] }, channels: { sms: "+61400000000", email: "adelaide@example.com" } };
const appearance = { themeKey: "forest", buttonStyle: "soft-card-icon", backgroundMode: "gradient", backgroundColor: "#112c24", primaryColor: "#8bd49a", textColor: "#f2fff5", cardColor: "#1b4437", radiusScale: "compact", inheritSfwTheme: false };
function setup(snapshot = profile, reply = url => Response.json({ ok: true, appearance })) { const calls = [], submissions = []; return { calls, submissions, env: { CONTACT_PROFILES: { get: async () => snapshot }, CONTACT_EVENTS: { writeDataPoint() {} }, TURNSTILE_SECRET: "secret", TURNSTILE_SITE_KEY: "site", TURNSTILE_EXPECTED_HOSTNAME: "contact.example", BOOKING_SERVICE_TOKEN: "x".repeat(40), BOOKING_FORM_SECRET: "x".repeat(32), BOOKING_RATE_LIMITER: { limit: async () => ({ success: true }) }, PUBLIC_LINKS_CONTROL: { fetch: async (url, init) => { calls.push(String(url)); if (String(url).endsWith("/submit")) submissions.push(JSON.parse(init.body)); return reply(String(url)); } } } }; }
async function data(env, alter = () => {}) { const html = await (await worker.fetch(new Request("https://contact.example/book/adelaide"), env)).text(), get = key => html.match(new RegExp(`name="${key}" value="([^"]+)"`))?.[1], f = new FormData(), tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10); ["submissionId", "issuedAt", "signature"].forEach(k => f.set(k, get(k))); Object.entries({ firstName: "Ava", lastName: "Jones", phone: "+61400000001", email: "ava@example.com", date: tomorrow, time: "19:30", timezone: "Australia/Perth", address: "1 Main St", suburb: "Perth", guests: "8", occasion: "Birthday", wear: "theme", specialRequests: "", consent: "yes", acknowledged: "yes", "cf-turnstile-response": "ok" }).forEach(([k, v]) => f.set(k, v)); alter(f); return f; }
const post = (f, env) => worker.fetch(new Request("https://contact.example/book/adelaide", { method: "POST", headers: { origin: "https://contact.example", "cf-connecting-ip": "192.0.2.1" }, body: f }), env);

test("initial HTML never reveals private contact and renders optional event fields, Uniform choices, and rules feedback", async () => { const { env } = setup(), response = await worker.fetch(new Request("https://contact.example/book/adelaide"), env), body = await response.text(); assert.match(body, /Booking rules/); assert.match(body, /I have read and agree to these rules/); assert.match(body, /name="endTime"/); assert.match(body, /<legend>Uniform<\/legend>/); assert.match(body, /type="checkbox" name="wear"/); assert.match(body, /Don’t skip the fine print, read the rules\./); assert.match(body, /These details are correct—send my enquiry/); assert.match(response.headers.get("content-security-policy"), /script-src 'nonce-[^']+' https:\/\/challenges\.cloudflare\.com/); assert.doesNotMatch(body, /400000000|adelaide@example\.com/); });
test("rules warning requires a prior open but permits a checked acknowledgement after closing", async () => {
  const { env } = setup(), html = await (await worker.fetch(new Request("https://contact.example/book/adelaide"), env)).text(), script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script><\/main>/)?.[1];
  assert.ok(script);
  const events = () => ({ handlers: new Map(), addEventListener(name, handler) { this.handlers.set(name, handler); }, dispatch(name, event = {}) { this.handlers.get(name)?.(event); return event; } });
  const summary = { focused: false, focus() { this.focused = true; } }, rules = { ...events(), open: false, querySelector: () => summary }, ack = { ...events(), checked: false, focused: false, focus() { this.focused = true; } }, button = events(), firstName = { value: "Ava" }, form = { ...events(), elements: { acknowledged: ack, firstName }, querySelector: () => button }, error = { hidden: true, textContent: "" };
  vm.runInNewContext(script, { document: { querySelector: selector => ({ form, "#booking-rules": rules, "#rules-error": error }[selector]) } });
  button.dispatch("click");
  assert.equal(error.hidden, false); assert.equal(error.textContent, "Don’t skip the fine print, read the rules.");
  const unopened = form.dispatch("submit", { preventDefault() { this.prevented = true; } });
  assert.equal(unopened.prevented, true); assert.equal(summary.focused, true); assert.equal(firstName.value, "Ava");
  ack.checked = true; ack.dispatch("change"); const checkedWithoutOpen = form.dispatch("submit", { preventDefault() { this.prevented = true; } });
  assert.equal(checkedWithoutOpen.prevented, true); assert.equal(error.hidden, false);
  rules.open = true; rules.dispatch("toggle"); assert.equal(error.hidden, true);
  rules.open = false; const submit = form.dispatch("submit", { preventDefault() { this.prevented = true; } });
  assert.equal(submit.prevented, undefined);
});
test("same-origin referrer policy keeps null and foreign POST origins denied", async () => { const { env } = setup(), page = await worker.fetch(new Request("https://contact.example/book/adelaide"), env); assert.equal(page.headers.get("referrer-policy"), "same-origin"); for (const origin of ["null", "https://attacker.example"]) assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide", { method: "POST", headers: { origin }, body: new FormData() }), env)).status, 400); });
test("legacy, disabled and check denial fail closed", async () => { assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide"), setup({ ...profile, schemaVersion: 1 }).env)).status, 404); assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide"), setup({ ...profile, config: { ...profile.config, enabled: false } }).env)).status, 404); assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide"), setup(profile, () => Response.json({ ok: false })).env)).status, 404); });
test("booking form and accepted handoff use only the checked bounded appearance", async () => {
  const themed = setup();
  const form = await (await worker.fetch(new Request("https://contact.example/book/adelaide"), themed.env)).text();
  assert.match(form, /--profile-background:#112c24/);
  assert.match(form, /color-scheme: dark/);
  assert.match(form, /data-button-style="soft-card-icon"/);
  const light = await (await worker.fetch(new Request("https://contact.example/book/adelaide"), setup(profile, () => Response.json({ ok: true, appearance: { ...appearance, themeKey: "clean-minimal", buttonStyle: "solid-rounded", backgroundMode: "solid", backgroundColor: "#ffffff", primaryColor: "#222222", textColor: "#161616", cardColor: "#f4f4f2" } })).env)).text();
  assert.match(light, /color-scheme: light/);
  const invalid = setup(profile, () => Response.json({ ok: true, appearance: { ...appearance, backgroundColor: "url(https:\/\/attacker.example)" } }));
  const rejected = await worker.fetch(new Request("https://contact.example/book/adelaide"), invalid.env);
  assert.equal(rejected.status, 404);
  assert.doesNotMatch(await rejected.text(), /attacker\.example/);
});
test("all approved button styles and an older check response render safely", async () => {
  for (const buttonStyle of ["solid-rounded", "full-pill", "minimal-outline", "soft-card-icon", "elevated-shadow-tile"]) {
    const response = await worker.fetch(new Request("https://contact.example/book/adelaide"), setup(profile, () => Response.json({ ok: true, appearance: { ...appearance, buttonStyle } })).env);
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp(`data-button-style="${buttonStyle}"`));
  }
  const legacy = await worker.fetch(new Request("https://contact.example/book/adelaide"), setup(profile, () => Response.json({ ok: true })).env);
  assert.equal(legacy.status, 200);
  assert.match(await legacy.text(), /--profile-background:#0c0911/);
});
test("tampered nonce and failed gate never call submit", async () => { const old = globalThis.fetch; globalThis.fetch = async () => Response.json({ success: false }); try { const x = setup(), f = await data(x.env, form => form.set("signature", "x".repeat(43))); assert.equal((await post(f, x.env)).status, 400); assert.equal(x.calls.filter(c => c.endsWith("/booking/submit")).length, 0); } finally { globalThis.fetch = old; } });
test("provider errors remain generic", async () => { const old = globalThis.fetch; globalThis.fetch = async () => Response.json({ success: true, action: "booking", hostname: "contact.example" }); try { const bad = setup(profile, url => url.endsWith("/check") ? Response.json({ ok: true, appearance }) : Response.json({ error: "private provider" }, { status: 502 })); assert.equal(await (await post(await data(bad.env), bad.env)).text(), "Unable to submit booking"); } finally { globalThis.fetch = old; } });

test("successful validated submission offers both recipient-bound manual drafts after email acceptance", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, action: "booking", hostname: "contact.example" });
  try {
    const links = bookingLinks(profile.channels.sms, "Adelaide", { firstName: "Ava", lastName: "Jones", date: "2026-10-01", time: "19:30", timezone: "Australia/Perth", suburb: "Perth", address: "1 Main St" });
    const x = setup(profile, url => url.endsWith("/check") ? Response.json({ ok: true, appearance }) : Response.json({ ok: true, ...links }));
    const response = await post(await data(x.env), x.env);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Continue in WhatsApp/);
    assert.match(html, /Continue by text message/);
    assert.match(html, /accepted for delivery/i);
    assert.match(html, /--profile-background:#112c24/);
    assert.match(html, /data-button-style="soft-card-icon"/);
    assert.doesNotMatch(html, /adelaide@example.com|http-equiv=.refresh/i);
    assert.equal(x.calls.filter(url => url.endsWith("/submit")).length, 1);
  } finally { globalThis.fetch = old; }
});

test("missing consent, unacknowledged rules, rate denial and Turnstile rejection never submit", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, action: "booking", hostname: "contact.example" });
  try {
    for (const name of ["consent", "acknowledged"]) {
      const x = setup();
      assert.equal((await post(await data(x.env, f => f.delete(name)), x.env)).status, 400);
      assert.equal(x.calls.some(url => url.endsWith("/submit")), false);
    }
    const limited = setup(); limited.env.BOOKING_RATE_LIMITER.limit = async () => ({ success: false });
    assert.equal((await post(await data(limited.env), limited.env)).status, 400);
    assert.equal(limited.calls.some(url => url.endsWith("/submit")), false);
    const rejected = setup();
    globalThis.fetch = async () => Response.json({ success: false });
    assert.equal((await post(await data(rejected.env), rejected.env)).status, 400);
    assert.equal(rejected.calls.some(url => url.endsWith("/submit")), false);
  } finally { globalThis.fetch = old; }
});

test("configured hidden fields are dropped and required visible fields reject blank submissions", async () => {
  const fields = Object.fromEntries(Object.entries(effectiveBookingFields(profile.config)).map(([name, setting]) => [name, { ...setting, visible: false, required: false }]));
  fields.specialRequests = { visible: true, required: true };
  const configured = { ...profile, config: { ...profile.config, fields } };
  const old = globalThis.fetch; globalThis.fetch = async () => Response.json({ success: true, action: "booking", hostname: "contact.example" });
  try {
    const links = bookingLinks(profile.channels.sms, "Adelaide", { firstName: "Ava", lastName: "Jones", email: "ava@example.com", consent: true, acknowledged: true });
    const x = setup(configured, url => url.endsWith("/check") ? Response.json({ ok: true, appearance }) : Response.json({ ok: true, ...links }));
    assert.equal((await post(await data(x.env, f => { f.set("specialRequests", "Quiet arrival"); f.set("address", "malicious hidden address"); f.set("endTime", "23:59"); f.set("guests", "999"); }), x.env)).status, 200);
    assert.deepEqual(x.submissions[0].enquiry, { firstName: "Ava", lastName: "Jones", email: "ava@example.com", specialRequests: "Quiet arrival", consent: true, acknowledged: true });
    const missing = setup(configured);
    assert.equal((await post(await data(missing.env), missing.env)).status, 400);
  } finally { globalThis.fetch = old; }
});

test("explicit field configurations are idempotent and sparse emails omit absent sections", () => {
  const fields = Object.fromEntries(bookingFieldNames.map(name => [name, { visible: name === "occasion" || name === "specialRequests", required: name === "specialRequests" }]));
  const config = validateBookingConfig({ ...profile.config, fields });
  assert.deepEqual(validateBookingConfig(config), config);
  const enquiry = validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", occasion: "Birthday", specialRequests: "No event fields", consent: true, acknowledged: true }, config, new Date("2026-09-28T02:00:00Z"));
  const email = bookingEmail("Adelaide", config, enquiry, "version", "2026-09-28T02:00:00Z");
  assert.match(email, /Occasion: Birthday/);
  assert.doesNotMatch(email, /Address:|Suburb:|Requested:/);
});

test("required extras allow any option and required empty choice groups are rejected", () => {
  const fields = Object.fromEntries(bookingFieldNames.map(name => [name, { visible: name === "extras" || name === "specialRequests", required: name === "extras" || name === "specialRequests" }]));
  const config = validateBookingConfig({ ...profile.config, extras: [{ id: "first", label: "First", description: "" }, { id: "second", label: "Second", description: "" }], fields });
  assert.deepEqual(JSON.parse(JSON.stringify(validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", extras: ["second"], specialRequests: "Hi", consent: true, acknowledged: true }, config))), { firstName: "Ava", lastName: "Jones", email: "ava@example.com", extras: ["second"], specialRequests: "Hi", consent: true, acknowledged: true });
  assert.throws(() => validateBookingConfig({ ...profile.config, extras: [], fields }));
});

test("same-day times use the supplied timezone for future validation", () => {
  const now = new Date("2026-09-28T02:00:00Z");
  const details = { firstName: "Ava", lastName: "Jones", phone: "+61400000001", email: "ava@example.com", date: "2026-09-28", timezone: "Australia/Perth", address: "1 Main St", suburb: "Perth", guests: 8, occasion: "Birthday", wear: "theme", extras: [], specialRequests: "", consent: true, acknowledged: true };
  assert.equal(validateBookingEnquiry({ ...details, time: "11:00" }, profile.config, now).time, "11:00");
  assert.throws(() => validateBookingEnquiry({ ...details, time: "09:00" }, profile.config, now));
});

test("legacy Uniform strings, optional blanks, end times, and Instagram handles remain bounded", () => {
  const optionalWear = validateBookingConfig({ ...profile.config, wear: [], fields: Object.fromEntries(bookingFieldNames.filter(name => name !== "endTime").map(name => [name, { visible: name === "wear" || name === "endTime" || name === "specialRequests", required: name === "specialRequests" }])) });
  assert.deepEqual(optionalWear.fields.endTime, { visible: true, required: false });
  for (const wear of [undefined, ""]) assert.deepEqual(validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", wear, endTime: "00:15", instagram: "@ava.j", specialRequests: "Hi", consent: true, acknowledged: true }, optionalWear).wear, []);
  const configured = validateBookingConfig({ ...profile.config, fields: Object.fromEntries(bookingFieldNames.map(name => [name, { visible: name === "wear" || name === "specialRequests", required: name === "wear" || name === "specialRequests" }])) });
  assert.deepEqual(validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", wear: "theme", specialRequests: "Hi", consent: true, acknowledged: true }, configured).wear, ["theme"]);
  assert.throws(() => validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", wear: ["theme", "theme"], specialRequests: "Hi", consent: true, acknowledged: true }, configured));
  assert.throws(() => validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", wear: ["unknown"], specialRequests: "Hi", consent: true, acknowledged: true }, configured));
  assert.throws(() => validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", wear: ["theme"], instagram: "not allowed!", specialRequests: "Hi", consent: true, acknowledged: true }, configured));
  const multiple = validateBookingConfig({ ...profile.config, wear: [...profile.config.wear, { id: "classic", label: "Classic", description: "" }] }), delivered = validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", phone: "+61400000001", email: "ava@example.com", date: "2026-10-01", time: "23:30", endTime: "00:30", timezone: "Australia/Perth", address: "1 Main St", suburb: "Perth", guests: 8, occasion: "Birthday", wear: ["theme", "classic"], extras: [], instagram: "@ava.j", specialRequests: "Hi", consent: true, acknowledged: true }, multiple, new Date("2026-09-28T02:00:00Z")), email = bookingEmail("Adelaide", multiple, delivered, "version", "2026-09-28T02:00:00Z");
  assert.match(email, /Start time: 23:30/); assert.match(email, /End time: 00:30/); assert.match(email, /Uniform: Theme, Classic/); assert.match(email, /Instagram: @ava\.j/);
});

test("explicit required End time is enforced, bounded, and ignored when hidden", () => {
  const endTimeRequired = validateBookingConfig({ ...profile.config, fields: Object.fromEntries(bookingFieldNames.map(name => [name, { visible: name === "endTime" || name === "specialRequests", required: name === "endTime" || name === "specialRequests" }])) });
  for (const endTime of [undefined, "", "25:00"]) assert.throws(() => validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", endTime, specialRequests: "Hi", consent: true, acknowledged: true }, endTimeRequired));
  const hiddenEndTime = validateBookingConfig({ ...profile.config, fields: Object.fromEntries(bookingFieldNames.map(name => [name, { visible: name === "specialRequests", required: name === "specialRequests" }])) });
  assert.equal(validateBookingEnquiry({ firstName: "Ava", lastName: "Jones", email: "ava@example.com", endTime: "25:00", specialRequests: "Hi", consent: true, acknowledged: true }, hiddenEndTime).endTime, undefined);
});


test("consent names the creator and supporting disclosure remains accessible", async () => {
  const response = await worker.fetch(new Request("https://contact.example/book/adelaide"), setup().env);
  const html = await response.text();
  assert.match(html, /I consent to sending my enquiry and my details to Adelaide\./);
  assert.match(html, /<details class="consent-info"><summary aria-label="How your enquiry details are used">/);
  assert.match(html, /Messaging drafts include your full-address Maps link/);
});

test("acknowledgement uncertainty keeps the accepted enquiry and prevents a misleading retry prompt", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, action: "booking", hostname: "contact.example" });
  try {
    const links = bookingLinks(profile.channels.sms, "Adelaide", { firstName: "Ava", lastName: "Jones", email: "ava@example.com", consent: true, acknowledged: true });
    for (const status of ["accepted", "uncertain"]) {
      const x = setup(profile, url => url.endsWith("/check") ? Response.json({ ok: true, appearance }) : Response.json({ ok: true, ...links, replyStatus: status }));
      const response = await post(await data(x.env), x.env);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Continue in WhatsApp/);
      assert.match(html, status === "accepted" ? /acknowledgement email has also been accepted/ : /Please do not submit it again/);
    }
  } finally { globalThis.fetch = old; }
});


test("creator notifications and messaging drafts include a safe optional Instagram profile link", () => {
  const base = { firstName: "Ava", lastName: "Jones", email: "ava@example.com", consent: true, acknowledged: true };
  for (const instagram of ["@ava.j", "ava.j"]) {
    const enquiry = { ...base, instagram };
    assert.ok(bookingEmail("Adelaide", profile.config, enquiry, "version", "2026-10-08T00:00:00Z").includes("https://www.instagram.com/ava.j/"));
    const links = bookingLinks(profile.channels.sms, "Adelaide", enquiry);
    for (const url of [links.sms, links.whatsapp]) assert.ok(decodeURIComponent(url).includes("https://www.instagram.com/ava.j/"));
  }
  assert.doesNotMatch(bookingEmail("Adelaide", profile.config, base, "version", "now"), /Instagram:/);
  assert.doesNotMatch(decodeURIComponent(bookingLinks(profile.channels.sms, "Adelaide", base).sms), /Instagram:/);
  for (const instagram of ["https://evil.example/", "ava?next=evil", "ava\nInjected"]) {
    assert.throws(() => bookingEmail("Adelaide", profile.config, { ...base, instagram }, "version", "now"), /Invalid Instagram/);
    assert.throws(() => bookingLinks(profile.channels.sms, "Adelaide", { ...base, instagram }), /Invalid Instagram/);
  }
});
