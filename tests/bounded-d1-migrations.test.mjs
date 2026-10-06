import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { assertApplyGates, assertExactMigrationHistory, buildBoundedPlan, executeBoundedPlan, hashBytes, hashCanonicalJson, hashFileBytes, inventoryFromDirectory, inventoryFromLedger, migrationSql, planDigest, validateBackup, validateReleaseExportPlan } from "../scripts/bounded-d1-migrations-lib.mjs";

const registry = {
  environments: {
    staging: { provisioned: true, deployable: true, accountId: "account", resources: { d1: { "thot-os-staging": { id: "db-id", migrationsDir: "migrations" } } } },
    production: { provisioned: false, deployable: false },
  },
};
const policy = { allowedEnvironments: ["staging"], backupMaxAgeMinutes: 60 };
const git = { sha: "a".repeat(40), branch: "audit/test", clean: true };

function fixture(limit = 32) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-d1-test-"));
  for (let number = 1; number <= limit; number += 1) writeFileSync(path.join(directory, `${String(number).padStart(4, "0")}_fixture.sql`), `-- ${number}\nCREATE TABLE IF NOT EXISTS fixture_${number} (id INTEGER);\n`);
  return { directory, inventory: inventoryFromDirectory(directory, readdirSync) };
}
function planFor(inventory, remoteApplied = inventory.slice(0, 27).map((entry) => entry.name)) {
  return buildBoundedPlan({ environment: "staging", releaseId: "phase2a-expand", from: "0028", through: "0031", inventory, remoteApplied, registry, policy, git });
}
function currentStagingPlan(inventory) {
  return buildBoundedPlan({ environment: "staging", releaseId: "phase2a-expand-resume", from: "0029", through: "0031", inventory, remoteApplied: inventory.slice(0, 28).map((entry) => entry.name), registry, policy, git });
}
function planForPreState(inventory, count) {
  const next = String(count + 1).padStart(4, "0");
  return buildBoundedPlan({ environment: "staging", releaseId: `future-baseline-${next}`, from: next, through: next, inventory, remoteApplied: inventory.slice(0, count).map((entry) => entry.name), registry, policy, git });
}

test("reviewed staging ledger records applied booking and download migrations", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const ledger = JSON.parse(readFileSync(path.join(root, "config/staging-d1-migration-ledger.json"), "utf8"));
  const directory = path.join(root, "cloudflare/thot-os-app/migrations");
  const inventory = inventoryFromLedger(directory, ledger, readdirSync);
  assert.equal(ledger.migrations.length, 65);
  assert.deepEqual(ledger.migrations.slice(-3).map(({ remoteId, name }) => ({ remoteId, name })), [
    { remoteId: 63, name: "0061_creator_booking_module.sql" },
    { remoteId: 64, name: "0062_booking_delivery_evidence.sql" },
    { remoteId: 65, name: "0063_content_download_links.sql" },
  ]);
  assert.deepEqual(ledger.pendingMigrations.map(({ name }) => name), ["0064_content_download_message.sql"]);
  assert.ok(ledger.pendingMigrations.every((entry) => entry.remoteId === undefined));
  assert.deepEqual(inventory[56], {
    number: 55,
    name: "0055_provider_connection_account_scope.sql",
    sha256: "540847321a5478b2cebb8c200446bc5554c9908de125b3d546d5861e288d3152",
    ledgerIndex: 57,
  });
  assert.deepEqual(inventory[57], {
    number: 56,
    name: "0056_creator_invitations.sql",
    sha256: "5a465735e2e71d348650620165bc90476c528115f892fc63e57a86fa1ef566f5",
    ledgerIndex: 58,
  });
  assert.deepEqual(inventory[58], {
    number: 57,
    name: "0057_instagram_account_scoped_analytics.sql",
    sha256: "3cc22c1f67884a65a6b3c039fa0d18e6581e5588dd251342f35bd03d13fbc66e",
    ledgerIndex: 59,
  });
  assert.deepEqual(inventory[59], {
    number: 58,
    name: "0058_fansly_claim_recovery.sql",
    sha256: "7292bd2dc1a85c8ae35772153e85e4656e8a50830fe4e4a1f060c75812c57cc7",
    ledgerIndex: 60,
  });
  assert.deepEqual(inventory.slice(43, 50).map((entry) => entry.name), [
    "0044_onlyfans_upload_bridge.sql", "0045_onlyfans_authorized_delivery.sql", "0046_onlyfans_sequential_batches.sql", "0047_onlyfans_supervised_delivery.sql", "0048_onlyfans_grouped_message_delivery.sql", "0044_creator_r2_library.sql", "0045_finished_media_uploads.sql",
  ]);
  const plan = buildBoundedPlan({ environment: "staging", releaseId: "native-video-intake", from: "0054_native_video_intake.sql", through: "0054_native_video_intake.sql", inventory, remoteApplied: inventory.slice(0, 55).map((entry) => entry.name), registry: { environments: { staging: { provisioned: true, deployable: true, accountId: "account", resources: { d1: { "thot-os-staging": { id: "db-id", migrationsDir: "migrations" } } } } } }, policy, git });
  assert.deepEqual(plan.execution.map((entry) => entry.name), ["0054_native_video_intake.sql"]);
  assert.deepEqual(plan.excludedPending.map(({ name }) => name), ["0055_provider_connection_account_scope.sql", "0056_creator_invitations.sql", "0057_instagram_account_scoped_analytics.sql", "0058_fansly_claim_recovery.sql", "0059_instagram_message_sync_reliability.sql", "0060_instagram_reply_media.sql", "0061_creator_booking_module.sql", "0062_booking_delivery_evidence.sql", "0063_content_download_links.sql", "0064_content_download_message.sql"]);
  assert.throws(() => buildBoundedPlan({ environment: "staging", releaseId: "ambiguous", from: "0044", through: "0049", inventory, remoteApplied: inventory.slice(0, 43).map((entry) => entry.name), registry: { environments: { staging: { provisioned: true, deployable: true, accountId: "account", resources: { d1: { "thot-os-staging": { id: "db-id", migrationsDir: "migrations" } } } } } }, policy, git }), /ambiguous/);
});

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

test("plan-bound export evidence accepts the canonical 0028 pre-state and future 0031/0032 baselines", () => {
  const { inventory } = fixture(33);
  for (const plan of [currentStagingPlan(inventory), planForPreState(inventory, 31), planForPreState(inventory, 32)]) {
    const reviewed = validateReleaseExportPlan({ plan, target: plan.target, inventory });
    assert.deepEqual(reviewed.preMigrationState, plan.preMigrationState);
    const { receiptPath, receipt } = backupFixture(plan);
    const backup = validateBackup({ receipt, receiptPath, plan, target: plan.target, maxAgeMinutes: 60 });
    assert.equal(backup.planSha256, plan.planSha256);
    assertApplyGates({ plan, currentPlan: plan, remoteApplied: plan.preMigrationState, git, clean: true, backup, confirmation: plan.confirmation });
  }
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
  const backup = { receiptHash: "b".repeat(64), planSha256: plan.planSha256 };
  assertApplyGates({ plan, currentPlan: current, remoteApplied: plan.preMigrationState, git, clean: true, backup, confirmation: plan.confirmation });
  assert.throws(() => assertApplyGates({ plan, currentPlan: current, remoteApplied: plan.preMigrationState, git, clean: false, backup, confirmation: plan.confirmation }), /clean Git/);
  assert.throws(() => assertApplyGates({ plan, currentPlan: current, remoteApplied: plan.preMigrationState, git, clean: true, backup, confirmation: "bounded:wrong" }), /confirmation/);
  writeFileSync(path.join(directory, "0028_fixture.sql"), "-- changed\n");
  assert.throws(() => migrationSql({ directory, migration: plan.execution[0] }), /digest changed/);
});

function sqliteExport(migrations) {
  return Buffer.from([
    'CREATE TABLE "d1_migrations" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "applied_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);',
    ...migrations.map((name, index) => `INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(${index + 1},'${name}','2026-10-04 00:00:00');`),
    "",
  ].join("\n"));
}

function backupFixture(plan, bytes = undefined, migrations = plan?.preMigrationState) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bounded-backup-test-"));
  const exportPath = path.join(directory, "staging.sql");
  writeFileSync(exportPath, bytes ?? (plan ? sqliteExport(migrations) : Buffer.from("-- no plan export\n")));
  const receiptPath = `${exportPath}.receipt.json`;
  const target = plan
    ? { environment: plan.target.environment, accountId: plan.target.accountId, databaseName: plan.target.databaseName, databaseId: plan.target.databaseId, migrations }
    : { environment: "staging", accountId: "account", databaseName: "thot-os-staging", databaseId: "db-id", migrations: ["0001_fixture.sql"] };
  const receipt = plan
    ? { schemaVersion: 2, mode: "READ ONLY REMOTE EXPORT", target, planSha256: plan.planSha256, preMigrationStateSha256: hashCanonicalJson(plan.preMigrationState), sqlChecksum: hashFileBytes(exportPath), exportedAt: new Date().toISOString() }
    : { mode: "READ ONLY REMOTE EXPORT", target, sqlChecksum: hashFileBytes(exportPath), exportedAt: new Date().toISOString() };
  writeFileSync(receiptPath, JSON.stringify(receipt));
  return { exportPath, receiptPath, receipt };
}

test("raw-byte backup hashes agree with an independent SHA-256 implementation", () => {
  const bytes = Buffer.from([0x00, 0x61, 0x0d, 0x0a, 0xff, 0x80, 0x0a]);
  const { exportPath } = backupFixture(null, bytes);
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
  const { inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  const { receiptPath, receipt } = backupFixture(plan);
  const options = { receiptPath, plan, target: plan.target, maxAgeMinutes: 60 };
  assert.equal(validateBackup({ receipt, ...options }).sqlChecksum, receipt.sqlChecksum);
  assert.throws(() => validateBackup({ receipt: { ...receipt, exportedAt: "2000-01-01T00:00:00.000Z" }, ...options }), /stale/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, databaseId: "wrong-db" } }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, databaseName: "wrong-name" } }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, environment: "production" } }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, accountId: "wrong-account" } }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, target: { ...receipt.target, migrations: plan.preMigrationState.slice(0, -1) } }, ...options }), /migration history/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, planSha256: "a".repeat(64) }, ...options }), /approved bounded migration plan/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, preMigrationStateSha256: "a".repeat(64) }, ...options }), /approved bounded migration plan/);
  for (const checksum of ["not-a-checksum", "a".repeat(63), "a".repeat(65), ` ${"a".repeat(64)}`, null]) assert.throws(() => validateBackup({ receipt: { ...receipt, sqlChecksum: checksum }, ...options }), /does not match/);
  assert.throws(() => validateBackup({ receipt: { ...receipt, exportedAt: new Date(Date.now() + 60_000).toISOString() }, ...options }), /stale or invalid/);
});

test("release backup evidence rejects stale and future exports, remote drift, and plan drift", () => {
  const { inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  const options = { plan, target: plan.target, maxAgeMinutes: 60 };
  const stale = backupFixture(plan, Buffer.from("stale"), plan.preMigrationState.slice(0, -1));
  assert.throws(() => validateBackup({ receipt: stale.receipt, receiptPath: stale.receiptPath, ...options }), /migration history/);
  const future = backupFixture(plan, Buffer.from("future"), [...plan.preMigrationState, plan.execution[0].name]);
  assert.throws(() => validateBackup({ receipt: future.receipt, receiptPath: future.receiptPath, ...options }), /migration history/);
  const valid = backupFixture(plan);
  const backup = validateBackup({ receipt: valid.receipt, receiptPath: valid.receiptPath, ...options });
  assert.throws(() => assertApplyGates({ plan, currentPlan: plan, remoteApplied: [...plan.preMigrationState, plan.execution[0].name], git, clean: true, backup, confirmation: plan.confirmation }), /Structured D1 migration history/);
  const replacementPlan = buildBoundedPlan({ environment: "staging", releaseId: "replacement-plan", from: "0030", through: "0031", inventory, remoteApplied: [...plan.preMigrationState, plan.execution[0].name], registry, policy, git });
  assert.throws(() => validateBackup({ receipt: valid.receipt, receiptPath: valid.receiptPath, plan: replacementPlan, target: replacementPlan.target, maxAgeMinutes: 60 }), /approved bounded migration plan/);
});

test("migration history comparison fails closed for every adversarial non-exact state", () => {
  const { inventory } = fixture();
  const expected = currentStagingPlan(inventory).preMigrationState;
  const reordered = [...expected]; [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  const duplicate = [...expected]; duplicate.splice(10, 0, expected[10]);
  const missing = expected.filter((_, index) => index !== 10);
  const sameNumberDifferentFilename = [...expected]; sameNumberDifferentFilename[27] = "0028_other_fixture.sql";
  const malformedNumber = [...expected]; malformedNumber[27] = "028_fixture.sql";
  const unexpectedAdditional = [...expected, "0029_unexpected_fixture.sql"];
  for (const history of [[], duplicate, missing, reordered, sameNumberDifferentFilename, malformedNumber, unexpectedAdditional]) {
    assert.throws(() => assertExactMigrationHistory(history, expected), /migration|Migration/i);
  }
});

test("backup validation rejects every byte-level tamper and empty exports", () => {
  const { inventory } = fixture();
  const plan = currentStagingPlan(inventory);
  for (const mutation of [
    (file) => { const bytes = readFileSync(file); bytes[0] ^= 0x01; writeFileSync(file, bytes); },
    (file) => truncateSync(file, 1),
    (file) => appendFileSync(file, Buffer.from([0xaa])),
    (file) => writeFileSync(file, Buffer.from("replacement export")),
  ]) {
    const { exportPath, receiptPath, receipt } = backupFixture(plan, Buffer.from([0x00, 0xff, 0x0a, 0x80, 0x42]));
    mutation(exportPath);
    assert.throws(() => validateBackup({ receipt, receiptPath, plan, target: plan.target, maxAgeMinutes: 60 }), /checksum/);
  }
  const empty = backupFixture(plan, Buffer.alloc(0));
  assert.throws(() => validateBackup({ receipt: empty.receipt, receiptPath: empty.receiptPath, plan, target: plan.target, maxAgeMinutes: 60 }), /missing or its checksum/);
});
