import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activationBackupReceiptDigest, assertActivationBackupReceipt, buildActivationPlan, sha256, sha256Bytes } from "../scripts/service-auth-activation-lib.mjs";
import { assertApprovedActivationPlan, assertSecureExternalBackupDirectory, createActivationBackup, migrationNamesFromExport, parseArgs, runReadOnlyD1Export } from "../scripts/service-auth-activation-backup.mjs";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const activation = readJson("config/service-auth-activation.staging.json");
const contract = readJson("config/service-principals.json");
const registry = readJson("config/deployments.json");
const observedMigrations = [...activation.expected.expandMigrations, ...activation.expected.compatibilityMigrations];

function plan() {
  return buildActivationPlan({ activation, contract, registry, observedMigrations, git: { sha: "a".repeat(40), branch: "audit/test" } });
}

function migrationExport(names) {
  return [
    "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
    ...names.map((name, index) => `INSERT INTO d1_migrations (id, name) VALUES (${index + 1}, '${name}');`),
  ].join("\n");
}

function receiptFor(currentPlan, directory, { exportedAt = new Date().toISOString() } = {}) {
  const exportPath = path.join(directory, "staging-d1.sql");
  const source = Buffer.from("safe test export\n");
  writeFileSync(exportPath, source, { mode: 0o600 });
  chmodSync(exportPath, 0o600);
  const receipt = {
    schemaVersion: 1,
    mode: "READ_ONLY_ACTIVATION_BACKUP",
    activationId: currentPlan.activationId,
    environment: "staging",
    accountId: registry.environments.staging.accountId,
    databaseName: currentPlan.database.databaseName,
    databaseId: currentPlan.database.databaseId,
    planSha256: currentPlan.planSha256,
    planGit: currentPlan.git,
    migrationHistory: currentPlan.observedMigrations,
    migrationStateSha256: sha256(currentPlan.observedMigrations),
    exportedAt,
    exportPath,
    export: { fileName: "staging-d1.sql", bytes: source.length, sha256: sha256Bytes(source) },
    integrity: { quickCheck: "ok", foreignKeyViolations: 0 },
  };
  receipt.sha256 = activationBackupReceiptDigest(receipt);
  return receipt;
}

test("activation backup receipt is plan-bound, fresh, private, and byte-verified", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "thot-os-activation-backup-test-"));
  chmodSync(directory, 0o700);
  try {
    const currentPlan = plan();
    const receipt = receiptFor(currentPlan, directory);
    assert.equal(assertActivationBackupReceipt({ backupReceipt: receipt, plan: currentPlan, registry }), true);
    const stale = { ...receipt, exportedAt: new Date(Date.now() - (16 * 60 * 1000)).toISOString() };
    stale.sha256 = activationBackupReceiptDigest(stale);
    assert.throws(() => assertActivationBackupReceipt({ backupReceipt: stale, plan: currentPlan, registry }), /fresh/i);
    writeFileSync(receipt.exportPath, "tampered", { mode: 0o600 });
    assert.throws(() => assertActivationBackupReceipt({ backupReceipt: receipt, plan: currentPlan, registry }), /missing, insecure, or no longer matches/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup command is staging-only, rejects repository destinations, and exports through isolated OAuth", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "thot-os-activation-backup-test-"));
  chmodSync(directory, 0o700);
  try {
    assert.equal(assertSecureExternalBackupDirectory(directory), realpathSync(directory));
    assert.throws(() => assertSecureExternalBackupDirectory(root), /non-repository/i);
    assert.equal(assertApprovedActivationPlan(plan(), activation, registry), true);
    assert.deepEqual(parseArgs(["--environment", "staging", "--approved-plan", "/safe/plan.json", "--output-dir", directory]), { environment: "staging", approvedPlan: "/safe/plan.json", outputDir: directory });
    assert.deepEqual(parseArgs(["--environment", "staging", "--activation", "config/booking-activation.json", "--approved-plan", "/safe/plan.json", "--output-dir", directory]), { environment: "staging", activation: path.resolve("config/booking-activation.json"), approvedPlan: "/safe/plan.json", outputDir: directory });
    const calls = [];
    runReadOnlyD1Export({ registry, databaseName: activation.expected.databaseName, outputPath: path.join(directory, "staging-d1.sql"), execFileSyncImpl: (command, args, options) => calls.push({ command, args, options }) });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(2, 5), ["d1", "export", activation.expected.databaseName]);
    assert.equal(calls[0].args.includes("--remote"), true);
    assert.equal(calls[0].args.includes("--command"), false);
    assert.equal(calls[0].options.env.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(calls[0].options.env.CLOUDFLARE_AUTH_USE_KEYRING, "true");
    assert.deepEqual(calls[0].options.stdio, ["ignore", "ignore", "ignore"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read-only activation backup verifies export migrations and leaves only secured SQL plus receipt", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "thot-os-activation-backup-test-"));
  chmodSync(directory, 0o700);
  try {
    const currentPlan = plan();
    const d1Client = {
      readMigrationHistory: async () => currentPlan.observedMigrations,
      queryReadOnly: async (_target, statement) => ({ rows: statement === "PRAGMA quick_check" ? [{ quick_check: "ok" }] : [] }),
    };
    const result = await createActivationBackup({
      plan: currentPlan,
      activation,
      registry,
      outputDirectory: directory,
      d1Client,
      runExport: ({ outputPath }) => writeFileSync(outputPath, migrationExport(currentPlan.observedMigrations), { mode: 0o600 }),
    });
    assert.equal(existsSync(result.receiptPath), true);
    assert.equal(statSync(result.receipt.exportPath).mode & 0o077, 0);
    assert.equal(assertActivationBackupReceipt({ backupReceipt: result.receipt, plan: currentPlan, registry }), true);
    assert.deepEqual(migrationNamesFromExport(result.receipt.exportPath), currentPlan.observedMigrations);
    assert.equal(existsSync(`${result.receipt.exportPath}.sqlite`), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
