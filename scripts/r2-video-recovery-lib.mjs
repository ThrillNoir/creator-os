import { createHash } from "node:crypto";

export const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);
export const digest = (value) => createHash("sha256").update(stableJson(value)).digest("hex");
export const cleanupConfirmation = (value) => `cleanup:${value.slice(0, 16)}`;
export const configConfirmation = (value) => `r2-config:${value.slice(0, 16)}`;

export function opaqueSession(session) {
  return {
    sessionCorrelation: digest({ id: session.id, creatorId: session.creator_id }),
    multipartIdentityDigest: digest({ objectKey: session.object_key, multipartUploadId: session.multipart_upload_id }),
    actorCorrelation: digest({ actorEmail: session.actor_email, actorRole: session.actor_role }),
    source: "r2_native_video",
    expiry: session.expires_at,
    expectedBytes: Number(session.expected_bytes),
    uploadedBytes: Number(session.uploaded_bytes),
  };
}

export function createVideoCleanupPlan({ authority, git, worker, sessions, targetCount = 2, createdAt = new Date().toISOString() }) {
  if (!Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > 10 || !Array.isArray(sessions) || sessions.length !== targetCount || sessions.some((session) => !session.id || !session.creator_id || !session.object_key || !session.multipart_upload_id || !session.actor_email || !["agency_admin", "operator", "creator", "viewer", "service"].includes(session.actor_role) || session.finalization_state !== "incomplete" || session.status === "finalized")) throw new Error("cleanup_targets_do_not_match_requested_count");
  const targets = sessions.map(opaqueSession).sort((a, b) => a.sessionCorrelation.localeCompare(b.sessionCorrelation));
  const plan = {
    schemaVersion: 1,
    kind: "staging-r2-video-expired-upload-cleanup-plan",
    environment: "staging",
    mode: "plan",
    authority,
    git,
    worker,
    targetCount,
    targets,
    targetDigest: digest(targets),
    createdAt,
    constraints: { productionTouched: false, r2AbortBeforeD1: true, ownerOnlyEvidence: true, allowlistOnly: true },
  };
  const planSha256 = digest(plan);
  return { ...plan, planSha256, confirmation: cleanupConfirmation(planSha256) };
}

export function assertApprovedVideoCleanupPlan(plan, confirmation, current) {
  if (plan?.schemaVersion !== 1 || plan.kind !== "staging-r2-video-expired-upload-cleanup-plan" || plan.environment !== "staging" || plan.mode !== "plan" || !Number.isSafeInteger(plan.targetCount) || plan.targetCount < 1 || plan.targetCount > 10) throw new Error("cleanup_plan_invalid");
  const unsigned = { ...plan }; delete unsigned.planSha256; delete unsigned.confirmation;
  if (plan.planSha256 !== digest(unsigned) || plan.confirmation !== cleanupConfirmation(plan.planSha256) || confirmation !== plan.confirmation) throw new Error("cleanup_plan_integrity_invalid");
  const targets = current.sessions.map(opaqueSession).sort((a, b) => a.sessionCorrelation.localeCompare(b.sessionCorrelation));
  if (current.sessions.length !== plan.targetCount || stableJson(plan.authority) !== stableJson(current.authority) || stableJson(plan.git) !== stableJson(current.git) || stableJson(plan.worker) !== stableJson(current.worker) || plan.targetDigest !== digest(targets) || stableJson(plan.targets) !== stableJson(targets)) throw new Error("cleanup_plan_drift");
  return true;
}

export function createVideoR2ConfigurationPlan({ authority, git, worker, origin, currentCors, createdAt = new Date().toISOString() }) {
  const desiredCors = [{ AllowedOrigins: [origin], AllowedMethods: ["PUT"], AllowedHeaders: ["content-type"], ExposeHeaders: ["etag"], MaxAgeSeconds: 300 }];
  const plan = {
    schemaVersion: 1,
    kind: "staging-r2-video-direct-upload-configuration-plan",
    environment: "staging",
    mode: "plan",
    authority,
    git,
    worker,
    currentCorsDigest: digest(currentCors),
    desiredCors,
    requiredSecretNames: ["R2_VIDEO_UPLOAD_ACCESS_KEY_ID", "R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY"],
    featureFlag: { name: "R2_VIDEO_DIRECT_UPLOADS_ENABLED", value: "1" },
    createdAt,
    constraints: { productionTouched: false, noPublicRead: true, noListDeleteCompleteAuthority: true, stagingOriginOnly: true },
  };
  const planSha256 = digest(plan);
  return { ...plan, planSha256, confirmation: configConfirmation(planSha256) };
}
