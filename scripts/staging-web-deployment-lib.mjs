import { createHash } from "node:crypto";

export const deploymentPlanKind = "staging-web-deployment-plan";
export const deploymentReceiptKind = "staging-web-deployment-apply-receipt";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required.`);
  return value;
}

export function planDigest(plan) {
  const unsigned = { ...plan };
  delete unsigned.planSha256;
  delete unsigned.confirmation;
  return sha256(JSON.stringify(unsigned));
}

export function confirmationForDigest(digest) {
  return `deploy:${requiredString(digest, "Plan digest").slice(0, 16)}`;
}

export function createDeploymentPlan({ metadata, artifactManifest, migrationNames, requiredSecretNames, workerState, createdAt = new Date().toISOString() }) {
  if (metadata?.environment !== "staging" || metadata?.component !== "web" || metadata?.worker !== "thot-os-staging") {
    throw new Error("Controlled deployment supports only staging/web → thot-os-staging.");
  }
  if (!Array.isArray(migrationNames) || migrationNames.length === 0) throw new Error("Deployment plan requires an exact staging migration ledger.");
  if (!Array.isArray(requiredSecretNames) || requiredSecretNames.length === 0) throw new Error("Deployment plan requires reviewed secret names.");
  const remoteSecrets = new Set(workerState?.secretNames ?? []);
  const missing = requiredSecretNames.filter((name) => !remoteSecrets.has(name));
  if (missing.length) throw new Error(`Staging Worker secret inventory is missing required names: ${missing.join(", ")}.`);

  const plan = {
    schemaVersion: 1,
    kind: deploymentPlanKind,
    mode: "plan",
    environment: "staging",
    component: "web",
    target: { accountId: metadata.accountId, worker: metadata.worker, config: metadata.config },
    source: { gitSha: metadata.gitSha, gitBranch: metadata.gitBranch },
    artifact: { sha256: artifactManifest.artifact.sha256, buildTime: artifactManifest.build.timestamp },
    migration: { databaseId: metadata.databaseId, names: [...migrationNames], latest: migrationNames.at(-1), count: migrationNames.length },
    requiredSecretNames: [...requiredSecretNames].sort(),
    preDeployment: {
      latestVersionId: workerState.latestVersionId,
      versionIds: [...workerState.versionIds],
      traffic: workerState.deployment.versions,
      workerSecretNames: [...workerState.secretNames].sort(),
    },
    createdAt,
  };
  const digest = planDigest(plan);
  return { ...plan, planSha256: digest, confirmation: confirmationForDigest(digest) };
}

function assertPlanIdentity({ plan, confirmation, metadata, artifactManifest, migrationNames }) {
  if (plan?.schemaVersion !== 1 || plan?.kind !== deploymentPlanKind || plan?.mode !== "plan") throw new Error("Approved deployment plan has an unsupported schema or kind.");
  const digest = planDigest(plan);
  if (plan.planSha256 !== digest || plan.confirmation !== confirmationForDigest(digest)) throw new Error("Approved deployment plan checksum is invalid.");
  if (confirmation !== plan.confirmation) throw new Error("Apply confirmation does not match the approved deployment plan.");
  if (plan.environment !== "staging" || plan.component !== "web" || plan.target?.worker !== "thot-os-staging") throw new Error("Approved plan is not the controlled staging/web target.");
  if (plan.source?.gitSha !== metadata.gitSha || plan.source?.gitBranch !== metadata.gitBranch) throw new Error("Current Git identity differs from the approved deployment plan.");
  if (plan.artifact?.sha256 !== artifactManifest.artifact?.sha256 || plan.artifact?.buildTime !== artifactManifest.build?.timestamp) throw new Error("Current artifact differs from the approved deployment plan.");
  if (JSON.stringify(plan.migration?.names) !== JSON.stringify(migrationNames)) throw new Error("Current staging migration state differs from the approved deployment plan.");
  return true;
}

export function assertReconciliationPlan(input) {
  return assertPlanIdentity(input);
}

export function assertApprovedPlan({ plan, confirmation, metadata, artifactManifest, migrationNames, workerState }) {
  assertPlanIdentity({ plan, confirmation, metadata, artifactManifest, migrationNames });
  const current = {
    latestVersionId: workerState.latestVersionId,
    versionIds: workerState.versionIds,
    traffic: workerState.deployment.versions,
    workerSecretNames: [...workerState.secretNames].sort(),
  };
  if (JSON.stringify(plan.preDeployment) !== JSON.stringify(current)) throw new Error("Current staging Worker version, traffic, or secret-name state differs from the approved deployment plan.");
  return true;
}

export function createApplyReceipt({ plan, before, after, observedAt = new Date().toISOString() }) {
  const newVersionIds = after.versionIds.filter((id) => !before.versionIds.includes(id));
  if (newVersionIds.length !== 1) throw new Error("Deployment did not produce exactly one verifiable fresh Worker version.");
  const workerVersion = newVersionIds[0];
  if (after.latestVersionId !== workerVersion) throw new Error("Fresh Worker version is not the latest observed version.");
  if (after.deployment.versions.length !== 1 || after.deployment.versions[0].versionId !== workerVersion || after.deployment.versions[0].percentage !== 100) {
    throw new Error("Fresh Worker version does not have the complete staging traffic allocation.");
  }
  if (after.latestSecretVersion.versionId !== workerVersion || after.latestSecretVersion.trafficPercentage !== 100) throw new Error("Fresh deployed version metadata is inconsistent.");
  const observedSecrets = new Set(after.latestSecretVersion.secretNames);
  const missing = plan.requiredSecretNames.filter((name) => !observedSecrets.has(name));
  if (missing.length) throw new Error(`Fresh deployed version is missing required secret names: ${missing.join(", ")}.`);
  return {
    schemaVersion: 1,
    kind: deploymentReceiptKind,
    verification: "remote-observed",
    environment: "staging",
    component: "web",
    observedAt,
    planSha256: plan.planSha256,
    source: plan.source,
    artifact: plan.artifact,
    migration: { verified: true, state: `${plan.migration.count} migrations; latest ${plan.migration.latest}` },
    deployment: {
      worker: plan.target.worker,
      previousTraffic: before.deployment.versions,
      previousLatestVersion: before.deployment.versions.length === 1 && before.deployment.versions[0].percentage === 100 ? before.deployment.versions[0].versionId : before.latestVersionId,
      workerVersion,
      traffic: after.deployment.versions,
      requiredSecretNamesVerified: [...plan.requiredSecretNames],
    },
    smokeTest: { verified: false, status: "PENDING_AUTHENTICATED_HEALTH_CHECK" },
    rollback: { worker: plan.target.worker, traffic: before.deployment.versions },
  };
}
