import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

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
