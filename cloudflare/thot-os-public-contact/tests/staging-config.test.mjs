import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public contact uses the live booking hostname while retaining the transition route", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.routes, [
    { pattern: "booking.thathuboverthere.com", custom_domain: true },
    { pattern: "booking-staging.thathuboverthere.com", custom_domain: true },
  ]);
  assert.equal(config.vars.TURNSTILE_EXPECTED_HOSTNAME, "booking.thathuboverthere.com");
  assert.equal(config.vars.LIVE_PUBLIC_CREATOR_SLUGS, "adelaide");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.r2_buckets, undefined);
});
