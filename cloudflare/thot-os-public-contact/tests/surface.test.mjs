import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

const profile = {
  schemaVersion: 1,
  creator: { slug: "adelaide", displayName: "Adelaide" },
  channels: { sms: "+61400000000", email: "adelaide@example.com" },
};

function environment(snapshot = profile) {
  const events = [];
  return {
    env: {
      CONTACT_PROFILES: { get: async () => snapshot },
      CONTACT_EVENTS: { writeDataPoint: (event) => events.push(event) },
      TURNSTILE_SECRET: "test-secret",
      TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_EXPECTED_HOSTNAME: "contact.example",
    },
    events,
  };
}

test("booking page never includes the stored phone number or email address", async () => {
  const { env, events } = environment();
  const response = await worker.fetch(new Request("https://contact.example/book/adelaide"), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(body, /400000000|adelaide@example\.com/);
  assert.match(body, /challenges\.cloudflare\.com\/turnstile/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(events[0].blobs, ["contact_open"]);
});

test("booking submission validates Turnstile before returning an encoded SMS URI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "contact.example", action: "booking" });
  try {
    const { env, events } = environment();
    const form = new FormData();
    form.set("name", "Ava & Jo");
    form.set("date", "2026-09-04");
    form.set("time", "19:30");
    form.set("occasion", "Birthday & dinner");
    form.set("channel", "sms");
    form.set("cf-turnstile-response", "valid-token");
    const response = await worker.fetch(new Request("https://contact.example/book/adelaide", { method: "POST", headers: { origin: "https://contact.example" }, body: form }), env);
    assert.equal(response.status, 303);
    const location = response.headers.get("location");
    assert.match(location, /^sms:\+61400000000\?body=/);
    assert.match(decodeURIComponent(location), /Ava & Jo/);
    assert.equal(events.at(-1).blobs[0], "sms_booking_started");
  } finally { globalThis.fetch = originalFetch; }
});

test("cross-origin and failed challenges cannot disclose a contact URI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false });
  try {
    const { env } = environment();
    const form = new FormData();
    form.set("name", "Ava"); form.set("date", "2026-09-04"); form.set("time", "19:30"); form.set("occasion", "Dinner"); form.set("channel", "email"); form.set("cf-turnstile-response", "invalid");
    const response = await worker.fetch(new Request("https://contact.example/book/adelaide", { method: "POST", headers: { origin: "https://attacker.example" }, body: form }), env);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("location"), null);
  } finally { globalThis.fetch = originalFetch; }
});
