import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deploymentWranglerEnvironment } from "../scripts/deploy-component.mjs";
import { assertApprovedPlan, assertReconciliationPlan, createApplyReceipt, createDeploymentPlan, planDigest, stagingDeploymentWorkers } from "../scripts/staging-web-deployment-lib.mjs";

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

test("web deploy keeps only the Access credentials needed to reach protected staging", () => {
  const environment = deploymentWranglerEnvironment({
    accountId: "account",
    baseEnvironment: {
      PATH: "/usr/bin",
      CLOUDFLARE_API_TOKEN: "must-not-pass",
      CLOUDFLARE_ACCESS_CLIENT_ID: "access-id",
      CLOUDFLARE_ACCESS_CLIENT_SECRET: "access-secret",
    },
  });
  assert.equal(environment.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(environment.CLOUDFLARE_ACCESS_CLIENT_ID, "access-id");
  assert.equal(environment.CLOUDFLARE_ACCESS_CLIENT_SECRET, "access-secret");
  assert.equal(environment.CLOUDFLARE_AUTH_USE_KEYRING, "true");
});

test("Vault deploy gives Wrangler a verified owner-only named snapshot", () => {
  const deployer = readFileSync(new URL("../scripts/deploy-component.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(deployer, /\/dev\/fd\/3/);
  assert.match(deployer, /mkdtempSync\(path\.join\(os\.tmpdir\(\), "creatoros-vault-deploy-"\)\)/);
  assert.match(deployer, /constants\.O_CREAT \| constants\.O_EXCL/);
  assert.match(deployer, /constants\.O_RDONLY \| \(constants\.O_NOFOLLOW \?\? 0\)/);
  assert.match(deployer, /\["deploy", snapshotPath, "--no-bundle"/);
});

test("staging deployment plan binds source, artifact, ledger, secrets, and Worker state", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.equal(plan.planSha256, planDigest(plan));
  assert.match(plan.confirmation, /^deploy:[a-f0-9]{16}$/);
  assert.equal(assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata, artifactManifest, migrationNames, workerState }), true);
});

test("Vault uses the same bounded plan/apply/reconcile contract", () => {
  const vaultMetadata = { ...metadata, component: "vault", worker: "thot-os-vault-bridge-staging", config: "cloudflare/vault-bridge/wrangler.jsonc" };
  const vaultState = { ...workerState, secretNames: [] };
  const plan = createDeploymentPlan({ metadata: vaultMetadata, artifactManifest, migrationNames, requiredSecretNames: [], workerState: vaultState });
  assert.equal(plan.kind, "staging-vault-deployment-plan");
  assert.deepEqual(plan.requiredSecretNames, []);
  assert.equal(plan.artifact.versionTag, `creatoros-${artifactManifest.artifact.sha256.slice(0, 48)}`);
  assert.equal(assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata: vaultMetadata, artifactManifest, migrationNames, workerState: vaultState }), true);
  assert.throws(() => assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata, artifactManifest, migrationNames, workerState }), /unsupported schema or kind/);
});

test("Vault receipt binds the fresh Worker version to the reviewed artifact tag", () => {
  const vaultMetadata = { ...metadata, component: "vault", worker: "thot-os-vault-bridge-staging", config: "cloudflare/vault-bridge/wrangler.jsonc" };
  const vaultState = { ...workerState, secretNames: [] };
  const plan = createDeploymentPlan({ metadata: vaultMetadata, artifactManifest, migrationNames, requiredSecretNames: [], workerState: vaultState });
  const after = { latestVersionId: "after", versionIds: ["after", "before", "older"], deployment: { versions: [{ versionId: "after", percentage: 100 }] }, latestSecretVersion: { versionId: "after", trafficPercentage: 100, secretNames: [], versionTag: plan.artifact.versionTag } };
  assert.equal(createApplyReceipt({ plan, before: vaultState, after }).deployment.workerVersion, "after");
  after.latestSecretVersion.versionTag = "creatoros-unrelated";
  assert.throws(() => createApplyReceipt({ plan, before: vaultState, after }), /not tagged with the reviewed artifact identity/);
});

test("each reviewed connector uses scoped plans, drift checks and tagged receipts", () => {
  for (const component of ["instagram", "reddit", "telegram", "publicLinks", "publicLinksControl"]) {
    const scoped = { ...metadata, component, worker: stagingDeploymentWorkers[component] };
    const plan = createDeploymentPlan({ metadata: scoped, artifactManifest, migrationNames, requiredSecretNames, workerState });
    assert.equal(plan.kind, `staging-${component}-deployment-plan`);
    assert.equal(assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata: scoped, artifactManifest, migrationNames, workerState }), true);
    assert.throws(() => createDeploymentPlan({ metadata: { ...scoped, worker: "thot-os-production" }, artifactManifest, migrationNames, requiredSecretNames, workerState }), /reviewed staging/);
    assert.throws(() => assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata: scoped, artifactManifest, migrationNames, workerState: { ...workerState, latestVersionId: "drift" } }), /differs/);
    const after = { latestVersionId: "after", versionIds: ["after", ...workerState.versionIds], deployment: { versions: [{ versionId: "after", percentage: 100 }] }, latestSecretVersion: { versionId: "after", trafficPercentage: 100, secretNames: requiredSecretNames, versionTag: plan.artifact.versionTag } };
    assert.equal(createApplyReceipt({ plan, before: workerState, after }).kind, `staging-${component}-deployment-apply-receipt`);
    after.latestSecretVersion.versionTag = "wrong-artifact";
    assert.throws(() => createApplyReceipt({ plan, before: workerState, after }), /not tagged/);
  }
  for (const invalid of [{ ...metadata, environment: "production" }, { ...metadata, component: "unknown" }, { ...metadata, component: "constructor" }]) {
    assert.throws(() => createDeploymentPlan({ metadata: invalid, artifactManifest, migrationNames, requiredSecretNames, workerState }), /reviewed staging/);
  }
});

test("full verification retains one web test suite and lets OpenNext own one configured Next build", () => {
  const root = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  const web = JSON.parse(readFileSync(new URL("../cloudflare/thot-os-next/package.json", import.meta.url), "utf8")).scripts;
  assert.equal(root.verify, "npm run lint && npm test && npm run verify:cloudflare");
  assert.match(root.test, /npm --prefix cloudflare\/thot-os-next test/);
  assert.match(root["verify:cloudflare"], /npm --prefix cloudflare\/thot-os-next run verify$/);
  assert.equal(web.verify, "opennextjs-cloudflare build");
  assert.equal(web.build, "next build --webpack");
});

test("apply refuses drift from the approved Worker state", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState });
  const drifted = structuredClone(workerState);
  drifted.deployment.versions[0].percentage = 90;
  assert.throws(() => assertApprovedPlan({ plan, confirmation: plan.confirmation, metadata, artifactManifest, migrationNames, workerState: drifted }), /differs/);
});

test("read-only reconciliation accepts post-deploy Worker drift but preserves immutable plan gates", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState });
  assert.equal(assertReconciliationPlan({ plan, confirmation: plan.confirmation, metadata, artifactManifest, migrationNames }), true);
  assert.throws(() => assertReconciliationPlan({ plan, confirmation: plan.confirmation, metadata, artifactManifest: { ...artifactManifest, artifact: { sha256: "changed" } }, migrationNames }), /artifact differs/);
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

test("apply receipt rejects a fresh version that lost a required web secret binding", () => {
  const plan = createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState });
  const after = {
    latestVersionId: "after",
    versionIds: ["after", "before", "older"],
    deployment: { versions: [{ versionId: "after", percentage: 100 }] },
    latestSecretVersion: { versionId: "after", trafficPercentage: 100, secretNames: ["VAULT_MASTER_KEY_V1"] },
  };
  assert.throws(() => createApplyReceipt({ plan, before: workerState, after }), /missing required secret names/);
});
