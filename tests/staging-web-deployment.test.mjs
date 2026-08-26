import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovedPlan, createApplyReceipt, createDeploymentPlan, planDigest } from "../scripts/staging-web-deployment-lib.mjs";

const metadata = { environment: "staging", component: "web", worker: "thot-os-staging", accountId: "account", config: "cloudflare/thot-os-next/wrangler.jsonc", databaseId: "database", gitSha: "abc", gitBranch: "codex/release" };
const artifactManifest = { artifact: { sha256: "artifact" }, build: { timestamp: "2026-08-26T00:00:00.000Z" } };
const migrationNames = ["0048.sql", "0049.sql"];
const requiredSecretNames = ["VAULT_MASTER_KEY_V1", "VAULT_PIN_PEPPER"];
const workerState = {
  latestVersionId: "before",
  versionIds: ["before", "older"],
  secretNames: requiredSecretNames,
  deployment: { versions: [{ versionId: "before", percentage: 100 }] },
  // Worker-level secret inventory is authoritative before deploy; the routed
  // version may predate a separately staged secret version.
  latestSecretVersion: { versionId: "before", trafficPercentage: 100, secretNames: [] },
};

test("staging deployment plan binds source, artifact, ledger, secrets, and Worker state", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.equal(plan.planSha256, planDigest(plan));
  assert.match(plan.confirmation, /^deploy:[a-f0-9]{16}$/);
  assert.equal(assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata, artifactManifest, migrationNames, workerState }), true);
});

test("apply refuses drift from the approved Worker state", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState });
  const drifted = structuredClone(workerState);
  drifted.deployment.versions[0].percentage = 90;
  assert.throws(() => assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata, artifactManifest, migrationNames, workerState: drifted }), /differs/);
});

test("apply receipt requires one fresh 100-percent version with all secret names", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState });
  const after = {
    latestVersionId: "after",
    versionIds: ["after", "before", "older"],
    deployment: { versions: [{ versionId: "after", percentage: 100 }] },
    latestSecretVersion: { versionId: "after", trafficPercentage: 100, secretNames: requiredSecretNames },
  };
  const receipt = createApplyReceipt({ plan, before: workerState, after, observedAt: "2026-08-26T02:00:00.000Z" });
  assert.equal(receipt.deployment.workerVersion, "after");
  assert.equal(receipt.smokeTest.verified, false);
  assert.deepEqual(receipt.rollback.traffic, workerState.deployment.versions);
});

test("apply receipt rejects a fresh version that lost a vault secret binding", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState });
  const after = {
    latestVersionId: "after",
    versionIds: ["after", "before", "older"],
    deployment: { versions: [{ versionId: "after", percentage: 100 }] },
    latestSecretVersion: { versionId: "after", trafficPercentage: 100, secretNames: ["VAULT_MASTER_KEY_V1"] },
  };
  assert.throws(() => createApplyReceipt({ plan, before: workerState, after }), /missing required secret names/);
});
