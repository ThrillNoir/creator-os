import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);
export const digest = (value) => sha256(stableJson(value));
export const confirmationFor = (value) => `cutover:${value.slice(0, 16)}`;

export function coverageSummary(rows) {
  const available = Number(rows?.[0]?.available_assets ?? 0);
  const eligible = Number(rows?.[0]?.eligible_assets ?? 0);
  return { availableAssets: available, eligibleAssets: eligible, complete: available > 0 && available === eligible };
}

export function readinessSummary(rows, live = null) {
  const expected = ["web", "vault", "instagram", "reddit"];
  const byService = new Map(rows.map((row) => [row.service_name, row]));
  const services = expected.map((service) => {
    const row = byService.get(service);
    const worker = live?.workers?.find((entry) => entry.component === service);
    const health = live?.health?.services?.find((entry) => entry.service === service);
    const deploymentHash = worker ? digest(worker) : null; const healthHash = health ? digest(health) : null;
    const evidenceMatches = !live || (row?.worker_version === worker?.latestVersionId && row?.deployment_evidence_sha256 === deploymentHash && row?.health_evidence_sha256 === healthHash && row?.asset_coverage_sha256 === digest(live.coverage));
    const compatible = row?.status === "compatible" && Boolean(row.worker_version && row.deployment_evidence_sha256 && row.health_evidence_sha256 && row.asset_coverage_sha256) && (!live || (worker?.completeTraffic === true && worker?.secretsVerified === true && health?.compatible === true && evidenceMatches));
    return { service, status: compatible ? "compatible" : "blocked", workerVersion: row?.worker_version ?? null, deploymentEvidenceSha256: row?.deployment_evidence_sha256 ?? null, healthEvidenceSha256: row?.health_evidence_sha256 ?? null, assetCoverageSha256: row?.asset_coverage_sha256 ?? null, reasonCode: compatible ? "ready" : !health?.compatible && live ? (health?.reasonCode ?? "health_not_compatible") : !evidenceMatches && live ? "readiness_evidence_stale" : (row?.reason_code ?? "missing") };
  });
  return { services, complete: services.every((service) => service.status === "compatible" && service.workerVersion && service.deploymentEvidenceSha256 && service.healthEvidenceSha256 && service.assetCoverageSha256) };
}

export function createCutoverPlan({ creatorId, action, git, authority, state, coverage, health, readiness, workerMetadata, createdAt = new Date().toISOString() }) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(creatorId) || !["r2_cutover", "dropbox_rollback"].includes(action)) throw new Error("cutover_scope_invalid");
  const coverageSha256 = digest(coverage);
  const readinessSha256 = digest(readiness);
  const expectedState = action === "r2_cutover" ? "dropbox" : "r2";
  const coverageComplete = Number(coverage?.availableAssets) > 0 && Number(coverage.availableAssets) === Number(coverage.eligibleAssets);
  const expectedServices = ["web", "vault", "instagram", "reddit"];
  const readinessComplete = Array.isArray(readiness?.services) && readiness.services.length === expectedServices.length
    && new Set(readiness.services.map((service) => service?.service)).size === expectedServices.length
    && expectedServices.every((name) => readiness.services.some((service) => service?.service === name && service.status === "compatible" && service.workerVersion && service.deploymentEvidenceSha256 && service.healthEvidenceSha256 && service.assetCoverageSha256));
  const completeWorkers = Array.isArray(workerMetadata) && workerMetadata.length === expectedServices.length
    && new Set(workerMetadata.map((worker) => worker?.component)).size === expectedServices.length
    && expectedServices.every((name) => workerMetadata.some((worker) => worker?.component === name && worker.completeTraffic === true));
  const healthComplete = Array.isArray(health?.services) && expectedServices.every((name) => health.services.some((service) => service?.service === name && service.compatible === true));
  const eligible = action === "r2_cutover"
    ? state.activeBackend === expectedState && coverageComplete && readinessComplete && completeWorkers && healthComplete
    : state.activeBackend === expectedState;
  const plan = { schemaVersion: 1, kind: "creator-source-media-cutover-plan", mode: "plan", environment: "staging", creatorId, action, git, authority, state, coverage, coverageSha256, health, readiness, readinessSha256, workerMetadata, eligible, createdAt };
  const planSha256 = digest(plan);
  return { ...plan, planSha256, confirmation: eligible ? confirmationFor(planSha256) : null };
}

export function assertApprovedCutoverPlan(plan, confirmation, current) {
  if (plan?.schemaVersion !== 1 || plan.kind !== "creator-source-media-cutover-plan" || plan.mode !== "plan" || !plan.eligible) throw new Error("cutover_plan_not_eligible");
  const unsigned = { ...plan }; delete unsigned.planSha256; delete unsigned.confirmation;
  if (plan.planSha256 !== digest(unsigned) || plan.confirmation !== confirmationFor(plan.planSha256) || confirmation !== plan.confirmation) throw new Error("cutover_plan_integrity_invalid");
  const observed = { ...current, coverageSha256: digest(current.coverage), readinessSha256: digest(current.readiness) };
  for (const key of ["git", "authority", "state", "coverageSha256", "readinessSha256", "health", "workerMetadata"]) if (stableJson(plan[key]) !== stableJson(observed[key])) throw new Error("cutover_plan_drift");
  return true;
}
