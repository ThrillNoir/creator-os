import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staging adult gateway has only protected adult bindings", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "thot-os-adult-gateway-staging");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [
    { pattern: "more.thathuboverthere.com", custom_domain: true },
    { pattern: "more-staging.thathuboverthere.com", custom_domain: true },
  ]);
  assert.deepEqual(config.kv_namespaces, [{ binding: "ADULT_PROFILES", id: "960ce926cd234170aa789a8eb0ca223a" }]);
  assert.deepEqual(config.r2_buckets, [{ binding: "ADULT_MEDIA", bucket_name: "thot-os-adult-media-staging" }]);
  assert.deepEqual(config.analytics_engine_datasets, [{ binding: "ADULT_EVENTS", dataset: "thot-os-adult-events-staging" }]);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.services, undefined);
  assert.deepEqual(config.secrets.required, ["TURNSTILE_SECRET", "AGE_SESSION_SECRET"]);
  assert.match(config.vars.TURNSTILE_SITE_KEY, /^0x4A[A-Za-z0-9_-]+$/);
  assert.equal(config.vars.TURNSTILE_EXPECTED_HOSTNAME, "more.thathuboverthere.com");
  assert.equal(config.vars.LIVE_PUBLIC_CREATOR_SLUGS, "adelaide");
});
