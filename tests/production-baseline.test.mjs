import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { targetFor } from "../scripts/bounded-d1-migrations-lib.mjs";
import { readJsoncFile, runPreflight } from "../scripts/deployment-preflight.mjs";

const root = path.resolve(import.meta.dirname, "..");
const baselinePath = path.join(root, "cloudflare/thot-os-app/production-baseline/schema.sql");

test("production baseline has no operational seed data and records complete D1 migration provenance", async () => {
  const [baseline, ledger] = await Promise.all([
    readFile(baselinePath, "utf8"),
    readFile(path.join(root, "config/staging-d1-migration-ledger.json"), "utf8").then(JSON.parse),
  ]);
  // Production foundation remains intentionally at the pre-stabilisation
  // schema; 0057/0058 are staging rollout migrations and are not production
  // provenance until a separately approved production release exists.
  const expected = ledger.migrations.filter((entry) => entry.remoteId <= 58).map((entry) => entry.name);
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


test("production baseline generator preserves the reviewed boundary despite newer staging migrations", () => {
  const result = spawnSync(process.execPath, ["scripts/build-d1-production-baseline.mjs", "--check"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Production baseline is current/);
});


test("a tampered foundation checksum cannot overwrite the production baseline", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "thot-os-baseline-denial-"));
  try {
    await mkdir(path.join(fixture, "scripts"));
    await mkdir(path.join(fixture, "config"));
    await mkdir(path.join(fixture, "cloudflare/thot-os-app/production-baseline"), { recursive: true });
    await copyFile(path.join(root, "scripts/build-d1-production-baseline.mjs"), path.join(fixture, "scripts/build-d1-production-baseline.mjs"));
    await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"));
    await symlink(path.join(root, "cloudflare/thot-os-app/migrations"), path.join(fixture, "cloudflare/thot-os-app/migrations"));
    const ledger = JSON.parse(await readFile(path.join(root, "config/staging-d1-migration-ledger.json"), "utf8"));
    ledger.migrations[0].sha256 = "0".repeat(64);
    await writeFile(path.join(fixture, "config/staging-d1-migration-ledger.json"), JSON.stringify(ledger));
    const output = path.join(fixture, "cloudflare/thot-os-app/production-baseline/schema.sql");
    await writeFile(output, "preserved fixture baseline\n");
    const result = spawnSync(process.execPath, ["scripts/build-d1-production-baseline.mjs"], {
      cwd: fixture, encoding: "utf8", timeout: 30_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Production baseline migration checksum changed/);
    assert.equal(await readFile(output, "utf8"), "preserved fixture baseline\n");
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
