import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovedCutoverPlan, confirmationFor, coverageSummary, createCutoverPlan, readinessSummary } from "../scripts/source-media-cutover-lib.mjs";

const sha = (character) => character.repeat(64);
const current = () => ({
  git: { sha: "a".repeat(40), branch: "codex/r2-readiness-coordinator", clean: true },
  authority: { accountId: "account", databaseId: "database", databaseName: "thot-os-staging" },
  state: { activeBackend: "dropbox", migrationState: "dropbox", dropboxFallbackEnabled: 1 },
  coverage: coverageSummary([{ available_assets: 2, eligible_assets: 2 }]),
  readiness: readinessSummary(["web", "vault", "instagram", "reddit"].map((service, index) => ({
    service_name: service, status: "compatible", worker_version: `version-${service}`,
    deployment_evidence_sha256: sha(String(index + 1)), health_evidence_sha256: sha(String(index + 5)), asset_coverage_sha256: sha(String(index + 9)), reason_code: "ready",
  }))),
  workerMetadata: ["web", "vault", "instagram", "reddit"].map((component) => ({ component, latestVersionId: `version-${component}`, completeTraffic: true, secretNames: [] })),
});

test("cutover plan requires full creator coverage, all consumer evidence, and complete worker traffic", () => {
  const observation = current();
  const plan = createCutoverPlan({ creatorId: "adelaide", action: "r2_cutover", ...observation, createdAt: "2026-08-28T00:00:00.000Z" });
  assert.equal(plan.eligible, true);
  assert.equal(plan.confirmation, confirmationFor(plan.planSha256));
  assert.equal(assertApprovedCutoverPlan(plan, plan.confirmation, observation), true);

  const partialCoverage = structuredClone(observation);
  partialCoverage.coverage = coverageSummary([{ available_assets: 2, eligible_assets: 1 }]);
  assert.equal(createCutoverPlan({ creatorId: "adelaide", action: "r2_cutover", ...partialCoverage }).eligible, false);

  const blockedConsumer = structuredClone(observation);
  blockedConsumer.readiness.services[2].status = "blocked";
  assert.equal(createCutoverPlan({ creatorId: "adelaide", action: "r2_cutover", ...blockedConsumer }).eligible, false);

  const splitTraffic = structuredClone(observation);
  splitTraffic.workerMetadata[3].completeTraffic = false;
  assert.equal(createCutoverPlan({ creatorId: "adelaide", action: "r2_cutover", ...splitTraffic }).eligible, false);
});

test("cutover approval rejects forged confirmation, altered plan data, and fresh-observation drift", () => {
  const observation = current();
  const plan = createCutoverPlan({ creatorId: "adelaide", action: "r2_cutover", ...observation, createdAt: "2026-08-28T00:00:00.000Z" });
  assert.throws(() => assertApprovedCutoverPlan(plan, "cutover:forged", observation), /integrity_invalid/);
  const altered = structuredClone(plan); altered.coverage.eligibleAssets = 1;
  assert.throws(() => assertApprovedCutoverPlan(altered, altered.confirmation, observation), /integrity_invalid/);
  const drifted = structuredClone(observation); drifted.state.activeBackend = "r2";
  assert.throws(() => assertApprovedCutoverPlan(plan, plan.confirmation, drifted), /cutover_plan_drift/);
});
