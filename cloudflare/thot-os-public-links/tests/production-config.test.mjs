import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production public-links foundation remains route-less and isolated from private data", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.production.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "thot-os-public-links-production");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.d1_databases ?? [], []);
  assert.deepEqual(config.r2_buckets ?? [], []);
  assert.deepEqual(config.services ?? [], []);
  assert.deepEqual(config.kv_namespaces, [{ binding: "PUBLIC_LINKS", id: "be71a3d6f07c4c708bc3e053d7ef4be5" }]);
  assert.deepEqual(config.analytics_engine_datasets, [{ binding: "LINK_EVENTS", dataset: "thot-os-public-link-events-production" }]);
});
