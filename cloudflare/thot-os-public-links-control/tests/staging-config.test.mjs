import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staging publication control has isolated SFW media bindings and keeps adult publication disabled", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.r2_buckets, [
    { binding: "MEDIA", bucket_name: "thot-os-media-staging" },
    { binding: "PUBLIC_MEDIA", bucket_name: "thot-os-public-media-staging" },
  ]);
  assert.equal(config.vars.PUBLIC_MEDIA_DELIVERY_ENABLED, "1");
  assert.equal(config.vars.PUBLIC_MEDIA_BASE_URL, "https://public-profile-staging.thathuboverthere.com");
  assert.equal(config.vars.PUBLIC_PROFILE_PUBLICATION_MODE, "synthetic-only");
  assert.equal(config.vars.ADULT_PROFILE_PUBLICATION_MODE, "disabled");
});
