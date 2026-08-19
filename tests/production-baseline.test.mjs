import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { targetFor } from "../scripts/bounded-d1-migrations-lib.mjs";
import { readJsoncFile, runPreflight } from "../scripts/deployment-preflight.mjs";

const root = path.resolve(import.meta.dirname, "..");
const migrationsRoot = path.join(root, "cloudflare/thot-os-app/migrations");
const baselinePath = path.join(root, "cloudflare/thot-os-app/production-baseline/schema.sql");

test("production baseline has no operational seed data and records complete D1 migration provenance", async () => {
  const [baseline, migrationNames] = await Promise.all([
    readFile(baselinePath, "utf8"),
    readdir(migrationsRoot),
  ]);
  const expected = migrationNames.filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const db = new Database(":memory:");
  try {
    db.exec(baseline);
    assert.deepEqual(db.prepare("SELECT id, name FROM d1_migrations ORDER BY id").all(), expected.map((name, index) => ({ id: index + 1, name })));
    for (const table of ["creators", "operational_accounts", "social_posts", "provider_connections", "creator_public_profiles"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} must have no production seed rows`);
    }
    assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    db.close();
  }
});

test("a provisioned production foundation does not widen the staging-only migration executor", async () => {
  const registry = JSON.parse(await readFile(path.join(root, "config/deployments.json"), "utf8"));
  const target = targetFor({ environment: "staging", registry, policy: { allowedEnvironments: ["staging"] } });
  assert.deepEqual(target, {
    environment: "staging",
    accountId: registry.environments.staging.accountId,
    databaseName: "thot-os-staging",
    databaseId: registry.environments.staging.resources.d1["thot-os-staging"].id,
    migrationsDir: "../thot-os-app/migrations",
  });
  assert.throws(() => targetFor({ environment: "production", registry, policy: { allowedEnvironments: ["staging"] } }), /explicit staging allow-list/);
});

test("production preflight accepts only the route-less public-links foundation", async () => {
  const outcome = runPreflight({
    environment: "production",
    component: "publicLinks",
    all: false,
    requireClean: false,
    json: true,
    registry: path.join(root, "config/deployments.json"),
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.errors));
  const config = readJsoncFile(path.join(root, "cloudflare/thot-os-public-links/wrangler.production.jsonc"));
  assert.equal(config.workers_dev, false);
});
