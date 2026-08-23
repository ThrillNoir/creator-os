import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staging public media is limited to its dedicated bucket and media path", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "thot-os-public-media-staging");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "public-profile-staging.thathuboverthere.com/media/*", zone_name: "thathuboverthere.com" }]);
  assert.deepEqual(config.kv_namespaces, [{ binding: "PUBLIC_LINKS", id: "34a4601e8bbb4d3bb05656bf1f59c2c1" }]);
  assert.deepEqual(config.r2_buckets, [{ binding: "PUBLIC_MEDIA", bucket_name: "thot-os-public-media-staging" }]);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.services, undefined);
});
