import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { bookingEmail, bookingFieldNames, bookingLinks, effectiveBookingFields, validateBookingConfig, validateBookingEnquiry } from "../../shared/booking-contract.ts";

const profile = { schemaVersion: 2, creator: { id: "creator-1", slug: "adelaide", displayName: "Adelaide" }, versionId: "version-1", config: { enabled: true, label: "Book Adelaide", rules: "Public-safe events only.", wear: [{ id: "theme", label: "Theme", description: "Costume." }], extras: [] }, channels: { sms: "+61400000000", email: "adelaide@example.com" } };
function setup(snapshot = profile, reply = url => Response.json({ ok: true })) { const calls = [], submissions = []; return { calls, submissions, env: { CONTACT_PROFILES: { get: async () => snapshot }, CONTACT_EVENTS: { writeDataPoint() {} }, TURNSTILE_SECRET: "secret", TURNSTILE_SITE_KEY: "site", TURNSTILE_EXPECTED_HOSTNAME: "contact.example", BOOKING_SERVICE_TOKEN: "x".repeat(40), BOOKING_FORM_SECRET: "x".repeat(32), BOOKING_RATE_LIMITER: { limit: async () => ({ success: true }) }, PUBLIC_LINKS_CONTROL: { fetch: async (url, init) => { calls.push(String(url)); if (String(url).endsWith("/submit")) submissions.push(JSON.parse(init.body)); return reply(String(url)); } } } }; }
async function data(env, alter = () => {}) { const html = await (await worker.fetch(new Request("https://contact.example/book/adelaide"), env)).text(), get = key => html.match(new RegExp(`name="${key}" value="([^"]+)"`))?.[1], f = new FormData(), tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10); ["submissionId", "issuedAt", "signature"].forEach(k => f.set(k, get(k))); Object.entries({ firstName: "Ava", lastName: "Jones", phone: "+61400000001", email: "ava@example.com", date: tomorrow, time: "19:30", timezone: "Australia/Perth", address: "1 Main St", suburb: "Perth", guests: "8", occasion: "Birthday", wear: "theme", specialRequests: "", consent: "yes", acknowledged: "yes", "cf-turnstile-response": "ok" }).forEach(([k, v]) => f.set(k, v)); alter(f); return f; }
const post = (f, env) => worker.fetch(new Request("https://contact.example/book/adelaide", { method: "POST", headers: { origin: "https://contact.example", "cf-connecting-ip": "192.0.2.1" }, body: f }), env);

test("initial HTML never reveals private contact and requires informed consent", async () => { const { env } = setup(), body = await (await worker.fetch(new Request("https://contact.example/book/adelaide"), env)).text(); assert.match(body, /Booking rules/); assert.match(body, /I have read and agree to these rules/); assert.match(body, /full-address Maps link/); assert.doesNotMatch(body, /400000000|adelaide@example\.com/); });
test("same-origin referrer policy keeps null and foreign POST origins denied", async () => { const { env } = setup(), page = await worker.fetch(new Request("https://contact.example/book/adelaide"), env); assert.equal(page.headers.get("referrer-policy"), "same-origin"); for (const origin of ["null", "https://attacker.example"]) assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide", { method: "POST", headers: { origin }, body: new FormData() }), env)).status, 400); });
test("legacy, disabled and check denial fail closed", async () => { assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide"), setup({ ...profile, schemaVersion: 1 }).env)).status, 404); assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide"), setup({ ...profile, config: { ...profile.config, enabled: false } }).env)).status, 404); assert.equal((await worker.fetch(new Request("https://contact.example/book/adelaide"), setup(profile, () => Response.json({ ok: false })).env)).status, 404); });
test("tampered nonce and failed gate never call submit", async () => { const old = globalThis.fetch; globalThis.fetch = async () => Response.json({ success: false }); try { const x = setup(), f = await data(x.env, form => form.set("signature", "x".repeat(43))); assert.equal((await post(f, x.env)).status, 400); assert.equal(x.calls.filter(c => c.endsWith("/booking/submit")).length, 0); } finally { globalThis.fetch = old; } });
test("provider errors remain generic", async () => { const old = globalThis.fetch; globalThis.fetch = async () => Response.json({ success: true, action: "booking", hostname: "contact.example" }); try { const bad = setup(profile, url => url.endsWith("/check") ? Response.json({ ok: true }) : Response.json({ error: "private provider" }, { status: 502 })); assert.equal(await (await post(await data(bad.env), bad.env)).text(), "Unable to submit booking"); } finally { globalThis.fetch = old; } });

test("successful validated submission offers both recipient-bound manual drafts after email acceptance", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, action: "booking", hostname: "contact.example" });
  try {
    const links = bookingLinks(profile.channels.sms, "Adelaide", { firstName: "Ava", lastName: "Jones", date: "2026-10-01", time: "19:30", timezone: "Australia/Perth", suburb: "Perth", address: "1 Main St" });
    const x = setup(profile, url => url.endsWith("/check") ? Response.json({ ok: true }) : Response.json({ ok: true, ...links }));
    const response = await post(await data(x.env), x.env);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Continue in WhatsApp/);
    assert.match(html, /Continue by text message/);
    assert.match(html, /accepted for delivery/i);
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
    const x = setup(configured, url => url.endsWith("/check") ? Response.json({ ok: true }) : Response.json({ ok: true, ...links }));
    assert.equal((await post(await data(x.env, f => { f.set("specialRequests", "Quiet arrival"); f.set("address", "malicious hidden address"); f.set("guests", "999"); }), x.env)).status, 200);
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
