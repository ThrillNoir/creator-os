import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { assertApplyGates, buildBoundedPlan, executeBoundedPlan, hashBytes, hashCanonicalJson, hashFileBytes, inventoryFromDirectory, migrationSql, planDigest, validateBackup } from "../scripts/bounded-d1-migrations-lib.mjs";

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
function currentStagingPlan(inventory) {
  return buildBoundedPlan({ environment: "staging", releaseId: "phase2a-expand-resume", from: "0029", through: "0031", inventory, remoteApplied: inventory.slice(0, 28).map((entry) => entry.name), registry, policy, git });
}

test("current canonical 0028 baseline selects only 0029 through 0031 and explicitly excludes 0032", () => {
  const { inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  assert.equal(plan.preMigrationState.at(-1), "0028_fixture.sql");
  assert.deepEqual(plan.execution.map((entry) => entry.number), [29, 30, 31]);
  assert.deepEqual(plan.excludedPending.map((entry) => entry.number), [32]);
  assert.equal(plan.remoteMutation, "NONE");
  assert.equal(plan.planSha256, planDigest(plan));
  assert.equal(plan.confirmation, `bounded:${plan.planSha256.slice(0, 16)}`);
  const changed = structuredClone(plan); changed.requestedRange.through = "0030_fixture.sql";
  assert.notEqual(planDigest(changed), plan.planSha256);
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
  const plan = currentStagingPlan(inventory);
  const state = [...plan.preMigrationState];
  const calls = [];
  const receipt = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ migration, sql, markSubmitted }) => { markSubmitted(); calls.push({ name: migration.name, sql }); state.push(migration.name); },
    getApplied: () => state,
    receiptBase: { target: plan.target },
  });
  assert.equal(receipt.result, "APPLIED");
  assert.equal(receipt.remoteMutation, "CONFIRMED");
  assert.deepEqual(receipt.attempted, ["0029_fixture.sql", "0030_fixture.sql", "0031_fixture.sql"]);
  assert.deepEqual(receipt.locallyConfirmed, receipt.attempted);
  assert.deepEqual(receipt.remotelyConfirmed, receipt.attempted);
  assert.deepEqual(calls.map((call) => call.name), plan.execution.map((entry) => entry.name));
  assert.ok(calls.every((call) => call.sql.includes(`INSERT INTO "d1_migrations" (name) VALUES ('${call.name}')`)));
  assert.ok(calls.every((call) => !call.sql.includes("0032_fixture.sql")));
  assert.equal(state.at(-1), "0031_fixture.sql");
  assert.equal(state.includes("0032_fixture.sql"), false);
});

test("post-command local parse failure is reconciled from D1 history and execution continues", async () => {
  const { directory, inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  const state = [...plan.preMigrationState];
  const calls = [];
  const receipt = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ migration, markSubmitted }) => { markSubmitted(); calls.push(migration.number); state.push(migration.name); if (migration.number === 29) throw new Error("JSON stdout parse failure"); },
    getApplied: () => state,
    receiptBase: { target: plan.target },
  });
  assert.equal(receipt.result, "APPLIED");
  assert.deepEqual(calls, [29, 30, 31]);
  assert.deepEqual(receipt.remotelyConfirmed, ["0029_fixture.sql", "0030_fixture.sql", "0031_fixture.sql"]);
  assert.deepEqual(receipt.localCommandErrors, [{ migration: "0029_fixture.sql", diagnostic: "LOCAL_RESULT_UNAVAILABLE" }]);
  assert.deepEqual(receipt.excludedPending, ["0032_fixture.sql"]);
});

test("precise 0028 incident is remotely confirmed despite local failure, then a fresh plan begins at 0029", async () => {
  const { directory, inventory } = fixture();
  const incidentPlan = planFor(inventory);
  const state = [...incidentPlan.preMigrationState];
  const receipt = await executeBoundedPlan({
    plan: { ...incidentPlan, execution: [incidentPlan.execution[0]], postMigrationState: [...incidentPlan.preMigrationState, incidentPlan.execution[0].name] },
    directory,
    executeOne: ({ migration, markSubmitted }) => { markSubmitted(); state.push(migration.name); throw new Error("Wrangler JSON stdout parse failure"); },
    getApplied: () => state,
    receiptBase: { target: incidentPlan.target },
  });
  assert.equal(receipt.result, "APPLIED");
  assert.deepEqual(receipt.attempted, ["0028_fixture.sql"]);
  assert.deepEqual(receipt.locallyConfirmed, []);
  assert.deepEqual(receipt.remotelyConfirmed, ["0028_fixture.sql"]);
  assert.equal(receipt.remoteMutation, "CONFIRMED");
  const resume = currentStagingPlan(inventory);
  assert.equal(resume.preMigrationState.at(-1), "0028_fixture.sql");
});

test("submitted command with unchanged history remains POSSIBLE unless a reviewed no-effects verifier proves no change", async () => {
  const { directory, inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  const state = [...plan.preMigrationState];
  const uncertain = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ markSubmitted }) => { markSubmitted(); throw new Error("transport timeout"); },
    getApplied: () => state,
    receiptBase: { target: plan.target },
  });
  assert.equal(uncertain.result, "STOPPED_UNCERTAIN");
  assert.equal(uncertain.remoteMutation, "POSSIBLE");
  assert.deepEqual(uncertain.outcomeUnknown, ["0029_fixture.sql"]);

  const noChange = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ markSubmitted }) => { markSubmitted(); throw new Error("transport timeout"); },
    getApplied: () => state,
    verifyNoEffects: () => ({ status: "NO_EFFECTS" }),
    receiptBase: { target: plan.target },
  });
  assert.equal(noChange.result, "FAILED");
  assert.equal(noChange.remoteMutation, "CONFIRMED_NO_CHANGE");
  assert.deepEqual(noChange.confirmedNoChange, ["0029_fixture.sql"]);
});

test("reconciliation outage after submission is POSSIBLE and never retries; pre-submission failure is NONE", async () => {
  const { directory, inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  let submittedCalls = 0;
  const unavailable = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ markSubmitted }) => { markSubmitted(); submittedCalls += 1; },
    getApplied: () => { throw new Error("fetch transport unavailable"); },
    receiptBase: { target: plan.target },
  });
  assert.equal(submittedCalls, 1);
  assert.equal(unavailable.remoteMutation, "POSSIBLE");
  assert.equal(unavailable.result, "STOPPED_UNCERTAIN");

  const beforePointOfNoReturn = await executeBoundedPlan({
    plan, directory,
    executeOne: () => { throw new Error("input file validation failed"); },
    getApplied: () => [...plan.preMigrationState],
    receiptBase: { target: plan.target },
  });
  assert.equal(beforePointOfNoReturn.remoteMutation, "NONE");
  assert.equal(beforePointOfNoReturn.result, "FAILED");
  assert.deepEqual(beforePointOfNoReturn.attempted, []);
});

test("a 0029 local parse failure reconciles before 0030, then a 0030 outage stops before 0031 and 0032", async () => {
  const { directory, inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  const state = [...plan.preMigrationState];
  const calls = [];
  const receipt = await executeBoundedPlan({
    plan, directory,
    executeOne: ({ migration, markSubmitted }) => {
      markSubmitted();
      calls.push(migration.number);
      if (migration.number === 29) {
        state.push(migration.name);
        throw new Error("Wrangler stdout JSON parse failure");
      }
    },
    getApplied: () => {
      if (calls.at(-1) === 30) throw new Error("structured API transport unavailable");
      return state;
    },
    receiptBase: { target: plan.target },
  });
  assert.deepEqual(calls, [29, 30]);
  assert.deepEqual(receipt.remotelyConfirmed, ["0029_fixture.sql"]);
  assert.deepEqual(receipt.outcomeUnknown, ["0030_fixture.sql"]);
  assert.equal(receipt.remoteMutation, "POSSIBLE");
  assert.equal(receipt.result, "STOPPED_UNCERTAIN");
  assert.equal(receipt.attempted.includes("0031_fixture.sql"), false);
  assert.equal(receipt.excludedPending.includes("0032_fixture.sql"), true);
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

function backupFixture(bytes = Buffer.from("-- export\n")) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-backup-test-"));
  const exportPath = path.join(directory, "staging.sql");
  writeFileSync(exportPath, bytes);
  const receiptPath = `${exportPath}.receipt.json`;
  const receipt = { mode: "READ ONLY REMOTE EXPORT", target: { environment: "staging", databaseName: "thot-os-staging", databaseId: "db-id", migrations: ["0001_fixture.sql"] }, sqlChecksum: hashFileBytes(exportPath), exportedAt: new Date().toISOString() };
  writeFileSync(receiptPath, JSON.stringify(receipt));
  return { exportPath, receiptPath, receipt };
}

test("raw-byte backup hashes agree with an independent SHA-256 implementation", () => {
  const bytes = Buffer.from([0x00, 0x61, 0x0d, 0x0a, 0xff, 0x80, 0x0a]);
  const { exportPath } = backupFixture(bytes);
  const standard = createHash("sha256").update(readFileSync(exportPath)).digest("hex");
  assert.equal(hashBytes(bytes), standard);
  assert.equal(hashFileBytes(exportPath), standard);
  const legacyStructuredBufferDigest = createHash("sha256").update(JSON.stringify(Object.fromEntries(bytes.entries())), "utf8").digest("hex");
  assert.notEqual(legacyStructuredBufferDigest, standard);
  assert.throws(() => hashCanonicalJson(bytes), /does not accept byte values/);
  assert.equal(hashBytes(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hashBytes(Buffer.alloc(0)), createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
});

test("raw-byte hashing preserves text, line endings, nulls, invalid UTF-8, high bytes, and larger files", () => {
  const lf = Buffer.from("line one\nline two\n", "utf8");
  const crlf = Buffer.from("line one\r\nline two\r\n", "utf8");
  const cases = [Buffer.from("plain UTF-8 text", "utf8"), lf, crlf, Buffer.from([0x00, 0xc3, 0x28, 0x80, 0xff]), Buffer.alloc(131_072, 0xa5)];
  for (const bytes of cases) assert.equal(hashBytes(bytes), createHash("sha256").update(bytes).digest("hex"));
  assert.notEqual(hashBytes(lf), hashBytes(crlf));
});

test("backup evidence is raw-byte checksum matched, fresh, and target-scoped", () => {
  const { receiptPath, receipt } = backupFixture(Buffer.from("line one\r\nline two\n\u0000\xff", "binary"));
  const options = { receiptPath, target: receipt.target, expectedMigrationState: receipt.target.migrations, maxAgeMinutes: 60 };
  assert.equal(validateBackup({ receipt, ...options }).sqlChecksum, receipt.sqlChecksum);
  assert.throws(() => validateBackup({ receipt: { ...receipt, exportedAt: "2000-01-01T00:00:00.000Z" }, ...options }), /stale/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, databaseId: "wrong-db" } }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, databaseName: "wrong-name" } }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, environment: "production" } }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, migrations: ["0002_wrong.sql"] } }, ...options }), /does not match/);
  for (const checksum of ["not-a-checksum", "a".repeat(63), "a".repeat(65), ` ${"a".repeat(64)}`, null]) assert.throws(() => validateBackup({ receipt: { ...receipt, sqlChecksum: checksum }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, exportedAt: new Date(Date.now() + 60_000).toISOString() }, ...options }), /stale or invalid/);
});

test("backup validation rejects every byte-level tamper and empty exports", () => {
  for (const mutation of [
    (file) => { const bytes = readFileSync(file); bytes[0] ^= 0x01; writeFileSync(file, bytes); },
    (file) => truncateSync(file, 1),
    (file) => appendFileSync(file, Buffer.from([0xaa])),
    (file) => writeFileSync(file, Buffer.from("replacement export")),
  ]) {
    const { exportPath, receiptPath, receipt } = backupFixture(Buffer.from([0x00, 0xff, 0x0a, 0x80, 0x42]));
    mutation(exportPath);
    assert.throws(() => validateBackup({ receipt, receiptPath, target: receipt.target, expectedMigrationState: receipt.target.migrations, maxAgeMinutes: 60 }), /checksum/);
  }
  const empty = backupFixture(Buffer.alloc(0));
  assert.throws(() => validateBackup({ receipt: empty.receipt, receiptPath: empty.receiptPath, target: empty.receipt.target, expectedMigrationState: empty.receipt.target.migrations, maxAgeMinutes: 60 }), /missing or its checksum/);
});
