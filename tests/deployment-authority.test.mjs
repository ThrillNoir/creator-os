import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildDeploymentMetadata,
  validateDeployment,
  validatePreflightRequest,
  validateRegistry,
} from "../scripts/deployment-preflight.mjs";

function fixtureRegistry() {
  return {
    schemaVersion: 1,
    environments: {
      staging: {
        provisioned: true,
        deployable: true,
        accountId: "account-staging",
        resources: {
          d1: { "thot-os-staging": { id: "d1-staging", migrationsDir: "migrations" } },
          r2: ["thot-os-media-staging"],
          kv: ["kv-staging"],
          queues: ["thot-os-jobs-staging"],
          workers: { web: "thot-os-staging-web" },
        },
        components: {
          web: {
            service: "thot-os-web",
            config: "fixture.jsonc",
            worker: "thot-os-staging-web",
            deployable: true,
            requiredSecrets: ["STAGING_KEY"],
            bindings: {
              d1: ["DB"],
              r2: ["MEDIA"],
              kv: ["KV"],
              images: ["IMAGES"],
              queues: ["JOBS"],
              services: [],
            },
            resources: {
              d1: ["thot-os-staging"],
              r2: ["thot-os-media-staging"],
              kv: ["kv-staging"],
              images: ["IMAGES"],
              queues: ["thot-os-jobs-staging"],
              services: {},
            },
          },
        },
      },
      production: {
        provisioned: true,
        deployable: true,
        accountId: "account-production",
        resources: {
          d1: { "thot-os-production": { id: "d1-production", migrationsDir: "migrations" } },
          r2: ["thot-os-media-production"],
          kv: ["kv-production"],
          queues: ["thot-os-jobs-production"],
          workers: { web: "thot-os-production-web" },
        },
        components: {
          web: {
            service: "thot-os-web",
            config: "fixture.jsonc",
            worker: "thot-os-production-web",
            deployable: true,
            requiredSecrets: ["PRODUCTION_KEY"],
            bindings: {
              d1: ["DB"],
              r2: ["MEDIA"],
              kv: ["KV"],
              images: ["IMAGES"],
              queues: ["JOBS"],
              services: [],
            },
            resources: {
              d1: ["thot-os-production"],
              r2: ["thot-os-media-production"],
              kv: ["kv-production"],
              queues: ["thot-os-jobs-production"],
              services: {},
            },
          },
        },
      },
    },
  };
}

function fixtureConfig({ environment = "staging", secretNames } = {}) {
  const production = environment === "production";
  return {
    name: production ? "thot-os-production-web" : "thot-os-staging-web",
    account_id: production ? "account-production" : "account-staging",
    d1_databases: [{ binding: "DB", database_name: production ? "thot-os-production" : "thot-os-staging", database_id: production ? "d1-production" : "d1-staging", migrations_dir: "migrations" }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: production ? "thot-os-media-production" : "thot-os-media-staging" }],
    kv_namespaces: [{ binding: "KV", id: production ? "kv-production" : "kv-staging" }],
    images: { binding: "IMAGES" },
    queues: { producers: [{ binding: "JOBS", queue: production ? "thot-os-jobs-production" : "thot-os-jobs-staging" }] },
    services: [],
    secrets: { required: secretNames ?? [production ? "PRODUCTION_KEY" : "STAGING_KEY"] },
  };
}

test("deployment registry rejects duplicate Worker ownership", () => {
  const registry = fixtureRegistry();
  registry.environments.staging.components.backup = {
    ...registry.environments.staging.components.web,
    worker: "thot-os-staging-web",
  };
  assert.match(validateRegistry(registry).join("\n"), /Duplicate Worker ownership/);
});

test("staging cannot bind to a declared production resource", () => {
  const registry = fixtureRegistry();
  const config = fixtureConfig({ environment: "staging" });
  config.d1_databases[0] = { database_name: "thot-os-production", database_id: "d1-production", migrations_dir: "migrations" };
  const result = validateDeployment({ registry, environmentName: "staging", componentName: "web", config });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Cross-environment binding/);
});

test("production cannot bind to a declared staging resource", () => {
  const registry = fixtureRegistry();
  const config = fixtureConfig({ environment: "production" });
  config.r2_buckets[0] = { bucket_name: "thot-os-media-staging" };
  const result = validateDeployment({ registry, environmentName: "production", componentName: "web", config });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Cross-environment binding/);
});

test("a KV namespace cannot cross an environment boundary", () => {
  const registry = fixtureRegistry();
  const config = fixtureConfig({ environment: "staging" });
  config.kv_namespaces[0] = { id: "kv-production" };
  const result = validateDeployment({ registry, environmentName: "staging", componentName: "web", config });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Cross-environment binding/);
});

test("ambiguous deployment requests and commands fail closed", () => {
  assert.match(validatePreflightRequest({}).join("\n"), /explicit --environment/);
  const result = spawnSync(process.execPath, ["scripts/deploy-component.mjs"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /disabled by default/);
});

test("deployment metadata contains Git SHA, environment and component", () => {
  const component = fixtureRegistry().environments.staging.components.web;
  assert.deepEqual(buildDeploymentMetadata({
    environment: "staging",
    componentName: "web",
    component,
    gitSha: "abc123def456",
    gitBranch: "audit/pre-cleanup-snapshot-2026-08-15",
    buildTime: "2026-08-15T00:00:00.000Z",
  }), {
    service: "thot-os-web",
    environment: "staging",
    component: "web",
    worker: "thot-os-staging-web",
    gitSha: "abc123def456",
    gitBranch: "audit/pre-cleanup-snapshot-2026-08-15",
    buildTime: "2026-08-15T00:00:00.000Z",
  });
});

test("missing required deployment configuration fails closed", () => {
  const result = validateDeployment({
    registry: fixtureRegistry(),
    environmentName: "staging",
    componentName: "web",
    config: fixtureConfig({ secretNames: [] }),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Required secret names mismatch/);
});

test("an undeclared Images binding fails deployment preflight", () => {
  const registry = fixtureRegistry();
  const config = fixtureConfig();
  config.images = { binding: "UNDECLARED_IMAGES" };
  const result = validateDeployment({ registry, environmentName: "staging", componentName: "web", config });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Images bindings mismatch/);
});

test("a renamed logical D1 binding fails even when it points at the staging database", () => {
  const result = validateDeployment({
    registry: fixtureRegistry(),
    environmentName: "staging",
    componentName: "web",
    config: { ...fixtureConfig(), d1_databases: [{ ...fixtureConfig().d1_databases[0], binding: "DATABASE" }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /d1 logical bindings mismatch/);
});

test("missing and unexpected logical resource bindings fail deployment preflight", () => {
  const missing = fixtureConfig();
  missing.r2_buckets = [];
  const missingResult = validateDeployment({ registry: fixtureRegistry(), environmentName: "staging", componentName: "web", config: missing });
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.errors.join("\n"), /r2 logical bindings mismatch/);

  const unexpected = fixtureConfig();
  unexpected.r2_buckets.push({ binding: "EXTRA", bucket_name: "thot-os-media-staging" });
  const unexpectedResult = validateDeployment({ registry: fixtureRegistry(), environmentName: "staging", componentName: "web", config: unexpected });
  assert.equal(unexpectedResult.ok, false);
  assert.match(unexpectedResult.errors.join("\n"), /r2 logical bindings mismatch/);
});

test("missing Wrangler configuration fails closed", () => {
  const result = validateDeployment({
    registry: fixtureRegistry(),
    environmentName: "staging",
    componentName: "web",
    config: null,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Missing Wrangler configuration/);
});
