import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staging public links uses only the approved custom hostname and media origin", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "public-profile-staging.thathuboverthere.com", custom_domain: true }]);
  assert.deepEqual(config.vars, { PUBLIC_MEDIA_BASE_URL: "https://public-profile-staging.thathuboverthere.com" });
  assert.equal(config.d1_databases, undefined);
  assert.deepEqual(config.r2_buckets ?? [], []);
});
