import assert from "node:assert/strict";
import test from "node:test";
import { readDeploymentRegistry, readJsoncFile, validateDeployment } from "../scripts/deployment-preflight.mjs";

const registry = readDeploymentRegistry();
const config = readJsoncFile(new URL("../cloudflare/thot-os-downloads/wrangler.staging.jsonc", import.meta.url));
const validate = (candidate) => validateDeployment({ registry, environmentName: "staging", componentName: "downloads", config: candidate });

test("downloads staging configuration owns only its workers.dev origin and approved private bindings", () => {
  assert.equal(validate(config).ok, true);
  assert.equal(config.name, "thot-os-downloads-staging");
  assert.equal(`https://${config.name}.thot-os.workers.dev`, "https://thot-os-downloads-staging.thot-os.workers.dev");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.vars.ENABLED, "true");
  assert.deepEqual(config.d1_databases, [{ binding: "DB", database_name: "thot-os-staging", database_id: "174532e8-5ada-4e30-abba-1276b3540b3f", migrations_dir: "../thot-os-app/migrations" }]);
  assert.deepEqual(config.r2_buckets, [{ binding: "LIBRARY_MEDIA", bucket_name: "thot-os-library-media-staging" }]);
});

test("downloads staging preflight rejects routes, production resources, and extra bindings", () => {
  for (const candidate of [
    { ...config, routes: [{ pattern: "downloads.example.test", custom_domain: true }] },
    { ...config, d1_databases: [{ ...config.d1_databases[0], database_name: "thot-os-production" }] },
    { ...config, r2_buckets: [...config.r2_buckets, { binding: "EXTRA", bucket_name: "thot-os-media-staging" }] },
    { ...config, kv_namespaces: [{ binding: "EXTRA", id: "forbidden" }] },
  ]) assert.equal(validate(candidate).ok, false);
});

test("downloads requires an explicit runtime switch", () => {
  assert.equal(validate({ ...config, vars: { ENABLED: "true" } }).ok, true);
  for (const ENABLED of [undefined, true, "1", "yes"]) {
    assert.equal(validate({ ...config, vars: { ENABLED } }).ok, false);
  }
});
