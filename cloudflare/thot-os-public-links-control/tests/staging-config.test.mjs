import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staging publication control keeps SFW and adult projections in separate isolated media boundaries", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.r2_buckets, [
    { binding: "MEDIA", bucket_name: "thot-os-media-staging" },
    { binding: "PUBLIC_MEDIA", bucket_name: "thot-os-public-media-staging" },
    { binding: "ADULT_MEDIA", bucket_name: "thot-os-adult-media-staging" },
  ]);
  assert.deepEqual(config.kv_namespaces, [
    { binding: "PUBLIC_LINKS", id: "34a4601e8bbb4d3bb05656bf1f59c2c1" },
    { binding: "ADULT_PROFILES", id: "960ce926cd234170aa789a8eb0ca223a" },
    { binding: "CONTACT_PROFILES", id: "57d716b2562b4bb989e62482df6f6b19" },
  ]);
  assert.deepEqual(config.send_email, [{ name: "EMAIL", allowed_sender_addresses: ["welcome@thathuboverthere.com"], allowed_destination_addresses: ["suedeadelaide@gmail.com"] }]);
  assert.equal(config.vars.PUBLIC_MEDIA_DELIVERY_ENABLED, "1");
  assert.equal(config.vars.PUBLIC_MEDIA_BASE_URL, "https://public-profile-staging.thathuboverthere.com");
  assert.equal(config.vars.PUBLIC_PROFILE_PUBLICATION_MODE, "synthetic-only");
  assert.equal(config.vars.PUBLIC_PROFILE_SYNTHETIC_CREATOR_IDS, "staging-synthetic-creator,adelaide,staging-authz-fixture");
  assert.equal(config.vars.ADULT_PROFILE_PUBLICATION_MODE, "synthetic-only");
  assert.equal(config.vars.ADULT_PROFILE_SYNTHETIC_CREATOR_IDS, "adelaide");
  assert.equal(config.vars.ADULT_MEDIA_DELIVERY_ENABLED, "1");
  assert.equal(config.vars.ADULT_GATEWAY_BASE_URL, "https://more-staging.thathuboverthere.com");
  assert.equal(config.vars.SAFE_PUBLIC_PROFILE_BASE_URL, "https://public-profile-staging.thathuboverthere.com");
  assert.deepEqual(config.workflows.map(({ binding, class_name }) => ({ binding, class_name })), [
    { binding: "PUBLIC_PROFILE_PUBLISH", class_name: "PublicProfilePublishWorkflow" },
    { binding: "PUBLIC_PROFILE_WITHDRAW", class_name: "PublicProfileWithdrawWorkflow" },
    { binding: "ADULT_PROFILE_PUBLISH", class_name: "AdultProfilePublishWorkflow" },
    { binding: "ADULT_PROFILE_WITHDRAW", class_name: "AdultProfileWithdrawWorkflow" },
  ]);
});
