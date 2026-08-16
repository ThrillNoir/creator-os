import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertApplyGates, buildBoundedPlan, executeBoundedPlan, inventoryFromDirectory, migrationSql, planDigest, sha256, validateBackup } from "../scripts/bounded-d1-migrations-lib.mjs";

const registry = {
  environments: {
    staging: { provisioned: true, deployable: true, accountId: "account", resources: { d1: { "thot-os-staging": { id: "db-id", migrationsDir: "migrations" } } } },
    production: { provisioned: false, deployable: false },
  },
};
const policy = { allowedEnvironments: ["staging"], backupMaxAgeMinutes: 60 };
const git = { sha: "a".repeat(40), branch: "audit/test", clean: true };

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-d1-test-"));
  for (let number = 1; number <= 32; number += 1) writeFileSync(path.join(directory, `${String(number).padStart(4, "0")}_fixture.sql`), `-- ${number}\nCREATE TABLE IF NOT EXISTS fixture_${number} (id INTEGER);\n`);
  return { directory, inventory: inventoryFromDirectory(directory, readdirSync) };
}
function planFor(inventory, remoteApplied = inventory.slice(0, 27).map((entry) => entry.name)) {
  return buildBoundedPlan({ environment: "staging", releaseId: "phase2a-expand", from: "0028", through: "0031", inventory, remoteApplied, registry, policy, git });
}

test("bounded planner selects 0028 through 0031 and explicitly excludes 0032", () => {
  const { inventory } = fixture();
  const plan = planFor(inventory);
  assert.deepEqual(plan.execution.map((entry) => entry.number), [28, 29, 30, 31]);
  assert.deepEqual(plan.excludedPending.map((entry) => entry.number), [32]);
  assert.equal(plan.planSha256, planDigest(plan));
  assert.equal(plan.confirmation, `bounded:${plan.planSha256.slice(0, 16)}`);
});

test("planner fails closed for production, reversed ranges, and non-prefix state", () => {
  const { inventory } = fixture();
  assert.throws(() => buildBoundedPlan({ environment: "production", releaseId: "release", from: "0028", through: "0031", inventory, remoteApplied: [], registry, policy, git }), /staging allow-list/);
  assert.throws(() => buildBoundedPlan({ environment: "staging", releaseId: "release", from: "0031", through: "0028", inventory, remoteApplied: inventory.slice(0, 27).map((entry) => entry.name), registry, policy, git }), /reversed/);
  const drifted = inventory.slice(0, 27).map((entry) => entry.name); drifted[9] = "0010_unknown.sql";
  assert.throws(() => planFor(inventory, drifted), /does not exactly match/);
});

test("executor applies only selected migrations using canonical ordered bookkeeping", async () => {
  const { directory, inventory } = fixture();
  const plan = planFor(inventory);
  const state = [...plan.preMigrationState];
  const calls = [];
  const receipt = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ migration, sql }) => { calls.push({ name: migration.name, sql }); state.push(migration.name); },
    getApplied: () => state,
    receiptBase: { target: plan.target },
  });
  assert.equal(receipt.result, "APPLIED");
  assert.deepEqual(calls.map((call) => call.name), plan.execution.map((entry) => entry.name));
  assert.ok(calls.every((call) => call.sql.includes(`INSERT INTO "d1_migrations" (name) VALUES ('${call.name}')`)));
  assert.ok(calls.every((call) => !call.sql.includes("0032_fixture.sql")));
  assert.equal(state.at(-1), "0031_fixture.sql");
  assert.equal(state.includes("0032_fixture.sql"), false);
});

test("executor stops at the failing 0030 migration and makes no automatic rollback claim", async () => {
  const { directory, inventory } = fixture();
  const plan = planFor(inventory);
  const state = [...plan.preMigrationState];
  const calls = [];
  const receipt = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ migration }) => { calls.push(migration.number); if (migration.number === 30) throw new Error("simulated failure"); state.push(migration.name); },
    getApplied: () => state,
    receiptBase: { target: plan.target },
  });
  assert.equal(receipt.result, "FAILED");
  assert.deepEqual(calls, [28, 29, 30]);
  assert.equal(receipt.failed.migration, "0030_fixture.sql");
  assert.deepEqual(receipt.applied, ["0028_fixture.sql", "0029_fixture.sql"]);
  assert.deepEqual(receipt.excludedPending, ["0032_fixture.sql"]);
});

test("a partial run can resume only as a new exact-prefix plan", () => {
  const { inventory } = fixture();
  const partialState = inventory.slice(0, 29).map((entry) => entry.name);
  const resume = buildBoundedPlan({ environment: "staging", releaseId: "phase2a-resume", from: "0030", through: "0031", inventory, remoteApplied: partialState, registry, policy, git });
  assert.deepEqual(resume.execution.map((entry) => entry.number), [30, 31]);
  assert.deepEqual(resume.excludedPending.map((entry) => entry.number), [32]);
  assert.throws(() => buildBoundedPlan({ environment: "staging", releaseId: "phase2a-resume", from: "0030", through: "0031", inventory, remoteApplied: [...partialState, "0031_fixture.sql"], registry, policy, git }), /does not exactly match/);
});

test("apply gates reject changed plans, dirty identity, and a changed migration digest before execution", () => {
  const { directory, inventory } = fixture();
  const plan = planFor(inventory);
  const current = structuredClone(plan);
  const backup = { receiptHash: "b".repeat(64) };
  assertApplyGates({ plan, currentPlan: current, remoteApplied: plan.preMigrationState, git, clean: true, backup, confirmation: plan.confirmation });
  assert.throws(() => assertApplyGates({ plan, currentPlan: current, remoteApplied: plan.preMigrationState, git, clean: false, backup, confirmation: plan.confirmation }), /clean Git/);
  assert.throws(() => assertApplyGates({ plan, currentPlan: current, remoteApplied: plan.preMigrationState, git, clean: true, backup, confirmation: "bounded:wrong" }), /confirmation/);
  writeFileSync(path.join(directory, "0028_fixture.sql"), "-- changed\n");
  assert.throws(() => migrationSql({ directory, migration: plan.execution[0] }), /digest changed/);
});

test("backup evidence must be fresh, checksum-matched, and target-scoped", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-backup-test-"));
  const exportPath = path.join(directory, "staging.sql");
  writeFileSync(exportPath, "-- export\n");
  const receiptPath = `${exportPath}.receipt.json`;
  const receipt = { mode: "READ ONLY REMOTE EXPORT", target: { environment: "staging", databaseName: "thot-os-staging", databaseId: "db-id" }, sqlChecksum: sha256(readFileSync(exportPath)), exportedAt: new Date().toISOString() };
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.equal(validateBackup({ receipt, receiptPath, target: receipt.target, maxAgeMinutes: 60 }).sqlChecksum, receipt.sqlChecksum);
  assert.throws(() => validateBackup({ receipt: { ...receipt, exportedAt: "2000-01-01T00:00:00.000Z" }, receiptPath, target: receipt.target, maxAgeMinutes: 60 }), /stale/);
});
