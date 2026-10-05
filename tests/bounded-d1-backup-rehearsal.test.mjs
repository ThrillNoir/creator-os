import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashCanonicalJson, hashFileBytes, planDigest, replayD1ExportMigrationHistory, validateBackup } from "../scripts/bounded-d1-migrations-lib.mjs";

const target = { environment: "staging", accountId: "test-account", databaseName: "thot-os-staging", databaseId: "test-database" };
const plan = {
  schemaVersion: 2,
  mode: "PLAN",
  releaseId: "restore-validation-test",
  environment: "staging",
  target,
  git: { sha: "a".repeat(40), branch: "test", clean: true },
  requestedRange: { from: "0002_next.sql", through: "0002_next.sql" },
  preMigrationState: ["0001_fixture.sql"],
  execution: [{ number: 2, name: "0002_next.sql", sha256: "b".repeat(64) }],
  excludedPending: [],
  postMigrationState: ["0001_fixture.sql", "0002_next.sql"],
  remoteMutation: "NONE",
};
plan.planSha256 = planDigest(plan);

function validForwardForeignKeyExport({ orphan = false } = {}) {
  return [
    'CREATE TABLE "child" ("parent_id" INTEGER REFERENCES "parent"("id"));',
    'INSERT INTO "child" ("parent_id") VALUES (1);',
    'CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY);',
    ...(orphan ? [] : ['INSERT INTO "parent" ("id") VALUES (1);']),
    'CREATE TABLE "d1_migrations" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "applied_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);',
    `INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_fixture.sql','2026-10-04 00:00:00');`,
    "",
  ].join("\n");
}

function fixture(sql) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-d1-rehearsal-test-"));
  const exportPath = path.join(directory, "staging-d1.sql");
  writeFileSync(exportPath, sql, { mode: 0o600 });
  const receiptPath = `${exportPath}.receipt.json`;
  const receipt = {
    schemaVersion: 2,
    mode: "READ ONLY REMOTE EXPORT",
    target: { ...target, migrations: ["0001_fixture.sql"] },
    planSha256: plan.planSha256,
    preMigrationStateSha256: hashCanonicalJson(plan.preMigrationState),
    sqlChecksum: hashFileBytes(exportPath),
    exportedAt: new Date().toISOString(),
  };
  writeFileSync(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  return { directory, exportPath, receiptPath, receipt };
}

test("bounded backup replay accepts forward foreign keys without touching source export or leaving scratch files", () => {
  const { directory, exportPath, receiptPath, receipt } = fixture(validForwardForeignKeyExport());
  const original = readFileSync(exportPath);
  const previousTmpdir = process.env.TMPDIR;
  try {
    process.env.TMPDIR = directory;
    assert.deepEqual(replayD1ExportMigrationHistory(exportPath), ["0001_fixture.sql"]);
    const accepted = validateBackup({ receipt, receiptPath, plan, target, maxAgeMinutes: 60 });
    assert.equal(accepted.sqlChecksum, receipt.sqlChecksum);
    assert.deepEqual(readFileSync(exportPath), original, "replay must not mutate the raw SQL export");
    assert.equal(existsSync(`${exportPath}.sqlite`), false, "no SQLite sidecar is created next to the raw export");
    assert.equal(readdirSync(directory).some((name) => name.startsWith("thot-os-bounded-d1-replay-")), false, "disposable replay directory is cleaned up");
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded backup replay rejects corrupt SQL and orphaned foreign keys", () => {
  for (const sql of [
    `CREATE TABLE "d1_migrations" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "applied_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);\nTHIS IS NOT SQL;\nINSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_fixture.sql','now');`,
    validForwardForeignKeyExport({ orphan: true }),
  ]) {
    const { directory, exportPath, receiptPath, receipt } = fixture(sql);
    const originalHash = createHash("sha256").update(readFileSync(exportPath)).digest("hex");
    try {
      assert.throws(() => validateBackup({ receipt, receiptPath, plan, target, maxAgeMinutes: 60 }), /canonical migration history/);
      assert.equal(hashFileBytes(exportPath), originalHash, "failed replay preserves source SQL bytes");
      assert.equal(existsSync(`${exportPath}.sqlite`), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("a checksummed and history-shaped receipt cannot pass with an invalid replay export", () => {
  const { directory, exportPath, receiptPath, receipt } = fixture("not a SQL database, but the receipt migration list looks right");
  try {
    assert.equal(receipt.sqlChecksum, hashFileBytes(exportPath));
    assert.deepEqual(receipt.target.migrations, plan.preMigrationState);
    assert.throws(() => validateBackup({ receipt, receiptPath, plan, target, maxAgeMinutes: 60 }), /canonical migration history/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
