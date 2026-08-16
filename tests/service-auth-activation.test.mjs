import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { activationConfirmation, assertApplyGates, buildActivationPlan, redactActivationReceipt } from "../scripts/service-auth-activation-lib.mjs";
import { parseArgs } from "../scripts/service-auth-activate.mjs";

const root = path.resolve(import.meta.dirname, "..");
const json = (file) => readFile(path.join(root, file), "utf8").then(JSON.parse);
const baseline = Array.from({ length: 27 }, (_, index) => `${String(index + 1).padStart(4, "0")}_placeholder.sql`).slice(0, -1).concat("0027_reddit_post_flairs.sql");

test("service-auth activation plan is redacted, deterministic, staging-only, and blocked before expansion", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: baseline, git: { sha: "a".repeat(40), branch: "audit/test" } });
  assert.equal(plan.activationReady, false);
  assert.equal(plan.principals.length, 4);
  assert.equal(plan.grants.length, 15);
  assert.equal(plan.operationsIfApplied.d1CredentialHashes, 4);
  assert.equal(plan.operationsIfApplied.legacyAuthenticationRemoved, false);
  assert.equal(plan.confirmation, activationConfirmation(plan.activationId, plan.planSha256));
  assert.doesNotMatch(JSON.stringify(plan), /Bearer|token_hash|credential value/i);
  assert.throws(() => buildActivationPlan({ activation: { ...activation, environment: "production" }, contract, registry, observedMigrations: baseline, git: {} }), /staging/i);
});

test("activation apply gates fail closed for bad confirmation, dirty source, target, and backup", async () => {
  const [activation, contract, registry] = await Promise.all([json("config/service-auth-activation.staging.json"), json("config/service-principals.json"), json("config/deployments.json")]);
  const plan = buildActivationPlan({ activation, contract, registry, observedMigrations: activation.expected.expandMigrations, git: { sha: "a".repeat(40), branch: "audit/test" } });
  const base = { plan, cleanGit: true, currentGit: plan.git, backupReceipt: { sha256: "b".repeat(64), environment: "staging", databaseId: activation.expected.databaseId }, registry };
  assert.equal(assertApplyGates({ ...base, confirmation: plan.confirmation }), true);
  assert.throws(() => assertApplyGates({ ...base, confirmation: "wrong" }), /confirmation/i);
  assert.throws(() => assertApplyGates({ ...base, cleanGit: false, confirmation: plan.confirmation }), /clean Git/i);
  assert.throws(() => assertApplyGates({ ...base, backupReceipt: { ...base.backupReceipt, databaseId: "wrong" }, confirmation: plan.confirmation }), /backup/i);
});

test("activation CLI has explicit plan/apply modes and receipts reject secret material", () => {
  assert.equal(parseArgs(["--environment", "staging"]).mode, "plan");
  assert.equal(parseArgs(["--environment", "staging", "--apply"]).mode, "apply");
  assert.throws(() => redactActivationReceipt({ secret: "not allowed" }), /prohibited/i);
  assert.deepEqual(redactActivationReceipt({ activationId: "safe", principalCount: 4, verification: "PASS" }), { activationId: "safe", principalCount: 4, verification: "PASS" });
});
