import crypto from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export const ACTIVATION_STATES = new Set(["PLANNED", "SECRET_STAGED", "D1_ACTIVE", "VERIFIED", "ACTIVE", "FAILED", "ROLLBACK_REQUIRED", "REVOKED"]);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export const ACTIVATION_BACKUP_MAX_AGE_MS = 15 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function backupReceiptBody(receipt) {
  const body = { ...receipt };
  delete body.sha256;
  return body;
}

/**
 * The activation backup is a local, read-only D1 export. Its receipt binds the
 * raw export bytes and the structured migration state to one reviewed plan;
 * apply rechecks the artifact rather than accepting a historical receipt.
 */
export function activationBackupReceiptDigest(receipt) {
  return sha256(backupReceiptBody(receipt));
}

export function assertActivationBackupReceipt({ backupReceipt, plan, registry, now = Date.now(), statSyncImpl = statSync, readFileSyncImpl = readFileSync } = {}) {
  const staging = registry?.environments?.staging;
  if (!backupReceipt || typeof backupReceipt !== "object" || Array.isArray(backupReceipt)) throw new Error("Activation apply requires a valid activation backup receipt.");
  if (backupReceipt.schemaVersion !== 1 || backupReceipt.mode !== "READ_ONLY_ACTIVATION_BACKUP") throw new Error("Activation backup receipt has an invalid schema or mode.");
  if (backupReceipt.activationId !== plan?.activationId || backupReceipt.environment !== "staging" || backupReceipt.accountId !== staging?.accountId || backupReceipt.databaseName !== plan?.database?.databaseName || backupReceipt.databaseId !== plan?.database?.databaseId) {
    throw new Error("Activation backup receipt does not match the reviewed staging target.");
  }
  if (backupReceipt.planSha256 !== plan?.planSha256 || backupReceipt.planGit?.sha !== plan?.git?.sha || backupReceipt.planGit?.branch !== plan?.git?.branch) {
    throw new Error("Activation backup receipt is not bound to the approved activation plan.");
  }
  if (!sameArray(backupReceipt.migrationHistory, plan?.observedMigrations) || backupReceipt.migrationStateSha256 !== sha256(plan.observedMigrations)) {
    throw new Error("Activation backup receipt migration state does not match the approved plan.");
  }
  if (!SHA256.test(backupReceipt.sha256 ?? "") || backupReceipt.sha256 !== activationBackupReceiptDigest(backupReceipt)) throw new Error("Activation backup receipt checksum is invalid.");
  const exportedAt = Date.parse(backupReceipt.exportedAt);
  if (!Number.isFinite(exportedAt) || exportedAt > now + 60_000 || now - exportedAt > ACTIVATION_BACKUP_MAX_AGE_MS) throw new Error("Activation backup receipt is not fresh enough for apply.");
  const exportPath = backupReceipt.exportPath;
  const exportInfo = backupReceipt.export;
  if (typeof exportPath !== "string" || !path.isAbsolute(exportPath) || !exportInfo || typeof exportInfo !== "object" || exportInfo.fileName !== path.basename(exportPath) || !Number.isInteger(exportInfo.bytes) || exportInfo.bytes <= 0 || !SHA256.test(exportInfo.sha256 ?? "")) {
    throw new Error("Activation backup receipt export metadata is invalid.");
  }
  try {
    const directory = statSyncImpl(path.dirname(exportPath));
    const file = statSyncImpl(exportPath);
    const bytes = readFileSyncImpl(exportPath);
    if (!directory.isDirectory() || !file.isFile() || (directory.mode & 0o077) !== 0 || (file.mode & 0o077) !== 0 || file.size !== exportInfo.bytes || sha256Bytes(bytes) !== exportInfo.sha256) {
      throw new Error("invalid artifact");
    }
  } catch {
    throw new Error("Activation backup export is missing, insecure, or no longer matches its receipt.");
  }
  return true;
}

export function activationConfirmation(activationId, planSha256) {
  return `${activationId}:${planSha256.slice(0, 12)}`;
}

export function revokeConfirmation(activationId, planSha256) {
  return `REVOKE:${activationId}:${planSha256.slice(0, 12)}`;
}

export function planDigest(plan) {
  const body = { ...plan };
  delete body.planSha256;
  delete body.confirmation;
  return sha256(body);
}

function finalisePlan(plan) {
  const finalPlan = { ...plan };
  delete finalPlan.planSha256;
  delete finalPlan.confirmation;
  finalPlan.planSha256 = planDigest(finalPlan);
  finalPlan.confirmation = activationConfirmation(finalPlan.activationId, finalPlan.planSha256);
  return finalPlan;
}

function normaliseActivationStatus(status = {}) {
  const state = status?.state ?? "ABSENT";
  if (!new Set(["ABSENT", "SATISFIED", "REVOKED", "CONFLICT"]).has(state)) throw new Error("Activation status is invalid.");
  return {
    state,
    activationRunPresent: status.activationRunPresent === true,
    canonicalRecordsPresent: status.canonicalRecordsPresent === true,
    counts: {
      activationRuns: Number.isInteger(status?.counts?.activationRuns) ? status.counts.activationRuns : 0,
      activationSteps: Number.isInteger(status?.counts?.activationSteps) ? status.counts.activationSteps : 0,
      canonicalPrincipals: Number.isInteger(status?.counts?.canonicalPrincipals) ? status.counts.canonicalPrincipals : 0,
      canonicalCredentialCount: Number.isInteger(status?.counts?.canonicalCredentialCount) ? status.counts.canonicalCredentialCount : 0,
      canonicalGrantCount: Number.isInteger(status?.counts?.canonicalGrantCount) ? status.counts.canonicalGrantCount : 0,
      canonicalAuditEventCount: Number.isInteger(status?.counts?.canonicalAuditEventCount) ? status.counts.canonicalAuditEventCount : 0,
    },
  };
}

/**
 * Adds a structured, credential-free D1 state observation to a plan. The
 * observation is included in its digest so an approval cannot be replayed
 * after canonical state has changed.
 */
export function withActivationStatus(plan, status) {
  const activationStatus = normaliseActivationStatus(status);
  let blockingPrecondition = plan.compatibilityReady ? null : plan.expandReady ? "COMPATIBILITY_MIGRATION_0032_REQUIRED" : "EXPAND_MIGRATIONS_0028_THROUGH_0031_REQUIRED";
  if (activationStatus.state === "SATISFIED") blockingPrecondition = "ACTIVATION_ALREADY_SATISFIED";
  else if (activationStatus.state === "CONFLICT") blockingPrecondition = "ACTIVATION_STATE_CONFLICT";
  else if (activationStatus.state === "REVOKED") blockingPrecondition = "ACTIVATION_ALREADY_REVOKED";
  return finalisePlan({
    ...plan,
    activationStatus,
    activationReady: plan.compatibilityReady && activationStatus.state === "ABSENT",
    blockingPrecondition,
  });
}

export function validateActivation({ activation, contract, registry }) {
  if (activation?.schemaVersion !== 1 || activation.environment !== "staging") throw new Error("Activation is restricted to staging.");
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/i.test(activation.activationId ?? "")) throw new Error("Activation id is invalid.");
  const staging = registry?.environments?.staging;
  if (!staging?.provisioned || !staging?.deployable || registry?.environments?.production?.provisioned || registry?.environments?.production?.deployable) throw new Error("Only the explicit staging target may be activated.");
  const d1 = staging.resources?.d1?.[activation.expected?.databaseName];
  if (!d1 || d1.id !== activation.expected.databaseId) throw new Error("Activation D1 identity does not match the deployment registry.");
  const principals = new Map((contract?.principals ?? []).map((entry) => [entry.principalName, entry]));
  if (!principals.size || new Set([...principals.values()].map((entry) => entry.secretName)).size !== principals.size) throw new Error("Every service principal must have a distinct secret name.");
  const grants = [];
  for (const grant of activation.grants ?? []) {
    const principal = principals.get(grant.principalName);
    if (!principal || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(grant.creatorId ?? "") || !Array.isArray(grant.capabilities) || !grant.capabilities.length) throw new Error("Activation grant is invalid.");
    for (const capability of grant.capabilities) {
      if (!principal.capabilities.includes(capability)) throw new Error(`Capability ${capability} is not permitted for ${grant.principalName}.`);
      grants.push({ principalName: grant.principalName, creatorId: grant.creatorId, capability });
    }
  }
  if (!grants.length || new Set(grants.map((grant) => `${grant.principalName}:${grant.creatorId}:${grant.capability}`)).size !== grants.length) throw new Error("Activation grants must be explicit and unique.");
  return { principals: [...principals.values()], grants };
}

export function buildActivationPlan({ activation, contract, registry, observedMigrations, git, activationStatus }) {
  const { principals, grants } = validateActivation({ activation, contract, registry });
  const expandMigrations = activation.expected.expandMigrations;
  const compatibilityMigrations = activation.expected.compatibilityMigrations;
  const postCompatibilityMigrations = activation.expected.postCompatibilityMigrations ?? [];
  if (!Array.isArray(expandMigrations) || !expandMigrations.length || !Array.isArray(compatibilityMigrations) || !compatibilityMigrations.length || !Array.isArray(postCompatibilityMigrations) || ![...expandMigrations, ...compatibilityMigrations, ...postCompatibilityMigrations].every((name) => typeof name === "string" && name.length > 0)) {
    throw new Error("Activation requires explicit EXPAND, COMPATIBILITY, and post-COMPATIBILITY migration contracts.");
  }
  const postCompatibilityReady = postCompatibilityMigrations.length === 0 || (postCompatibilityMigrations.every((name) => observedMigrations.includes(name)) && observedMigrations.at(-1) === postCompatibilityMigrations.at(-1));
  const recognisedTerminalMigrations = [expandMigrations.at(-1), compatibilityMigrations.at(-1), ...(postCompatibilityMigrations.length ? [postCompatibilityMigrations.at(-1)] : [])];
  const expandReady = expandMigrations.every((name) => observedMigrations.includes(name))
    && recognisedTerminalMigrations.includes(observedMigrations.at(-1));
  const compatibilityReady = expandReady && compatibilityMigrations.every((name) => observedMigrations.includes(name))
    && (observedMigrations.at(-1) === compatibilityMigrations.at(-1) || postCompatibilityReady);
  const remoteBaseline = observedMigrations.at(-1) === "0027_reddit_post_flairs.sql";
  const partialExpandIndex = expandMigrations.indexOf(observedMigrations.at(-1));
  const partialExpandReady = partialExpandIndex >= 0
    && expandMigrations.slice(0, partialExpandIndex + 1).every((name) => observedMigrations.includes(name))
    && [...compatibilityMigrations, ...postCompatibilityMigrations].every((name) => !observedMigrations.includes(name));
  if (!compatibilityReady && !expandReady && !partialExpandReady && !remoteBaseline) throw new Error("Remote migration state is outside the approved baseline, partial-EXPAND, EXPAND, COMPATIBILITY, and post-COMPATIBILITY boundaries.");
  const plan = {
    schemaVersion: 1,
    mode: "plan",
    activationId: activation.activationId,
    environment: "staging",
    database: activation.expected,
    git,
    observedMigrations,
    partialExpandReady,
    partialExpandThrough: partialExpandReady ? expandMigrations[partialExpandIndex] : null,
    expandReady,
    postCompatibilityReady,
    compatibilityReady,
    activationReady: compatibilityReady,
    blockingPrecondition: compatibilityReady ? null : expandReady ? "COMPATIBILITY_MIGRATION_0032_REQUIRED" : "EXPAND_MIGRATIONS_0028_THROUGH_0031_REQUIRED",
    principals: principals.map(({ id, principalName, secretName, receiver, capabilities }) => ({ id, principalName, secretName, receiver, capabilities })),
    grants,
    operationsIfApplied: {
      stagedWebSecrets: principals.map(({ secretName, principalName }) => ({ worker: "thot-os-staging", secretName, principalName })),
      d1Principals: principals.length,
      d1CredentialHashes: principals.length,
      d1CreatorCapabilityGrants: grants.length,
      auditSteps: ["PLANNED", "SECRET_STAGED", "D1_ACTIVE", "VERIFIED", "ACTIVE"],
      legacyAuthenticationRemoved: false,
    },
    rollback: {
      canonicalD1: "The activation executor can idempotently revoke only its deterministic canonical principals, credentials, and grants; it never deletes audit history or touches legacy authentication.",
      stagedWorkerSecrets: "Secret staging creates an un-routed Worker version only. Do not route it if activation fails or the D1 outcome is uncertain.",
      cutover: "If a later verification fails after a separately approved traffic change, roll Workers back before revoking canonical credentials.",
    },
  };
  return withActivationStatus(plan, activationStatus);
}

export function assertApplyGates({ plan, confirmation, cleanGit, currentGit, backupReceipt, registry }) {
  if (plan?.activationStatus?.state !== "ABSENT") throw new Error(`Activation apply is blocked by ${plan?.blockingPrecondition ?? "ACTIVATION_STATE_CONFLICT"}.`);
  if (plan?.mode !== "plan" || plan.environment !== "staging" || !plan.expandReady || !plan.compatibilityReady || !plan.activationReady) throw new Error("Activation apply requires both expanded and compatibility-ready staging state.");
  if (confirmation !== activationConfirmation(plan.activationId, plan.planSha256)) throw new Error("Activation confirmation does not match the approved plan.");
  if (!cleanGit || currentGit?.sha !== plan.git?.sha || currentGit?.branch !== plan.git?.branch) throw new Error("Activation apply requires the exact clean Git identity used for the plan.");
  assertActivationBackupReceipt({ backupReceipt, plan, registry });
  if (registry?.environments?.production?.provisioned || registry?.environments?.production?.deployable) throw new Error("Production must remain unprovisioned for activation.");
  return true;
}

export function assertRevokeGates({ plan, confirmation, registry }) {
  if (plan?.mode !== "plan" || plan.environment !== "staging") throw new Error("Activation recovery is restricted to a staging plan.");
  if (confirmation !== revokeConfirmation(plan.activationId, plan.planSha256)) throw new Error("Recovery confirmation does not match the approved plan.");
  if (!["SATISFIED", "CONFLICT"].includes(plan?.activationStatus?.state) || !plan.activationStatus.activationRunPresent) {
    throw new Error("Recovery requires a structured status showing this activation run is present and requires revocation.");
  }
  if (registry?.environments?.production?.provisioned || registry?.environments?.production?.deployable) throw new Error("Production must remain unprovisioned for recovery.");
  return true;
}

export function redactActivationReceipt(receipt) {
  const visit = (value, key = "") => {
    if (/^(token|bearer|credential|credentials|tokenHash|credentialHash|secret|secrets|secretValue|credentialValue)$/i.test(key)) throw new Error("Activation receipt contains prohibited credential material.");
    if (Array.isArray(value)) value.forEach((entry) => visit(entry));
    else if (value && typeof value === "object") Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
  };
  visit(receipt);
  return receipt;
}
