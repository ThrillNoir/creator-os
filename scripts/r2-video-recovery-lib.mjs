import { createHash } from "node:crypto";

export const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);
export const digest = (value) => createHash("sha256").update(stableJson(value)).digest("hex");
export const cleanupConfirmation = (value) => `cleanup:${value.slice(0, 16)}`;
export const configConfirmation = (value) => `r2-config:${value.slice(0, 16)}`;
export const STAGING_VIDEO_UPLOAD_ORIGIN = "https://thot-os-staging.thot-os.workers.dev";
export const REQUIRED_VIDEO_UPLOAD_SECRETS = ["R2_VIDEO_UPLOAD_ACCESS_KEY_ID", "R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY"];

function normalizedStringList(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((item) => typeof item !== "string" || !item || item.length > 4096)) throw new Error(`r2_cors_${field}_invalid`);
  return [...new Set(value)].sort();
}

// This is Cloudflare R2's native API shape, not the AWS S3 CORS document
// shape. Keeping one canonical representation makes plan digests and the
// post-apply readback comparison meaningful.
export function normalizeR2CorsRules(rules) {
  if (!Array.isArray(rules) || rules.length > 20) throw new Error("r2_cors_rules_invalid");
  return rules.map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("r2_cors_rule_invalid");
    if (Object.keys(rule).some((key) => !["allowed", "exposeHeaders", "maxAgeSeconds"].includes(key))) throw new Error("r2_cors_rule_unknown_field");
    const allowed = rule.allowed;
    if (!allowed || typeof allowed !== "object" || Array.isArray(allowed) || Object.keys(allowed).some((key) => !["origins", "methods", "headers"].includes(key))) throw new Error("r2_cors_allowed_invalid");
    if (!Number.isSafeInteger(rule.maxAgeSeconds ?? 0) || (rule.maxAgeSeconds ?? 0) < 0 || (rule.maxAgeSeconds ?? 0) > 86_400) throw new Error("r2_cors_max_age_invalid");
    return {
      allowed: {
        origins: normalizedStringList(allowed.origins, "origins", { required: true }),
        methods: normalizedStringList(allowed.methods, "methods", { required: true }),
        headers: normalizedStringList(allowed.headers ?? [], "headers"),
      },
      exposeHeaders: normalizedStringList(rule.exposeHeaders ?? [], "expose_headers"),
      maxAgeSeconds: rule.maxAgeSeconds ?? 0,
    };
  }).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
}

export function stagingVideoUploadCorsRules(origin = STAGING_VIDEO_UPLOAD_ORIGIN) {
  if (origin !== STAGING_VIDEO_UPLOAD_ORIGIN) throw new Error("r2_cors_origin_not_staging");
  return normalizeR2CorsRules([{
    allowed: { origins: [origin], methods: ["PUT"], headers: ["content-type"] },
    exposeHeaders: ["etag"],
    maxAgeSeconds: 300,
  }]);
}

function stripAnsi(value) { return value.replaceAll(/\u001B\[[0-?]*[ -\/]*[@-~]/g, ""); }
function csv(value, emptyMarker) {
  const text = value.trim();
  if (text === emptyMarker) return [];
  if (!text) throw new Error("r2_cors_metadata_invalid");
  return text.split(",").map((part) => part.trim());
}

// Wrangler's CORS list command is deliberately human-readable. This parser is
// strict so an unrecognised CLI format cannot be mistaken for an empty policy.
export function parseR2CorsListOutput(output) {
  if (typeof output !== "string") throw new Error("r2_cors_metadata_invalid");
  const lines = stripAnsi(output).replaceAll("\r", "").split("\n");
  if (lines.some((line) => /There is no CORS configuration defined for bucket/.test(line))) return [];
  const labels = new Map([
    ["allowed_origins", "origins"], ["allowed_methods", "methods"], ["allowed_headers", "headers"],
    ["exposed_headers", "exposeHeaders"], ["max_age_seconds", "maxAgeSeconds"],
  ]);
  const rules = []; let rule = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^⛅️\s+wrangler\s/.test(line) || /^─+$/.test(line) || /^Listing CORS rules for bucket /.test(line)) continue;
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match || !labels.has(match[1])) throw new Error("r2_cors_metadata_unrecognized_output");
    if (!rule) rule = {};
    const key = labels.get(match[1]);
    if (Object.hasOwn(rule, key)) throw new Error("r2_cors_metadata_duplicate_field");
    const value = match[2];
    if (key === "origins") rule.origins = csv(value, "(no origins)");
    else if (key === "methods") rule.methods = csv(value, "(no methods)");
    else if (key === "headers") rule.headers = csv(value, "(no headers)");
    else if (key === "exposeHeaders") rule.exposeHeaders = csv(value, "(no exposed headers)");
    else {
      const age = value === "(0 seconds)" ? 0 : Number(value);
      if (!Number.isSafeInteger(age)) throw new Error("r2_cors_metadata_invalid_max_age");
      rule.maxAgeSeconds = age;
    }
    if (Object.keys(rule).length === 5) {
      rules.push({ allowed: { origins: rule.origins, methods: rule.methods, headers: rule.headers }, exposeHeaders: rule.exposeHeaders, maxAgeSeconds: rule.maxAgeSeconds });
      rule = null;
    }
  }
  if (rule || rules.length === 0) throw new Error("r2_cors_metadata_incomplete");
  return normalizeR2CorsRules(rules);
}

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
  const desiredCors = stagingVideoUploadCorsRules(origin);
  const normalizedCurrentCors = normalizeR2CorsRules(currentCors);
  if (!REQUIRED_VIDEO_UPLOAD_SECRETS.every((name) => worker?.secretNames?.includes(name))) throw new Error("r2_video_upload_secrets_not_installed");
  const plan = {
    schemaVersion: 2,
    kind: "staging-r2-video-direct-upload-configuration-plan",
    environment: "staging",
    mode: "plan",
    authority,
    git,
    worker,
    targetBucket: authority.bucket,
    origin,
    currentCorsDigest: digest(normalizedCurrentCors),
    desiredCors,
    desiredCorsDigest: digest(desiredCors),
    requiredSecretNames: REQUIRED_VIDEO_UPLOAD_SECRETS,
    featureFlag: { name: "R2_VIDEO_DIRECT_UPLOADS_ENABLED", value: "1" },
    createdAt,
    constraints: { productionTouched: false, noPublicRead: true, noListDeleteCompleteAuthority: true, stagingOriginOnly: true },
  };
  const planSha256 = digest(plan);
  return { ...plan, planSha256, confirmation: configConfirmation(planSha256) };
}

export function assertApprovedVideoR2ConfigurationPlan(plan, confirmation, current) {
  if (plan?.schemaVersion !== 2 || plan.kind !== "staging-r2-video-direct-upload-configuration-plan" || plan.environment !== "staging" || plan.mode !== "plan") throw new Error("r2_configuration_plan_invalid");
  const unsigned = { ...plan }; delete unsigned.planSha256; delete unsigned.confirmation;
  if (plan.planSha256 !== digest(unsigned) || plan.confirmation !== configConfirmation(plan.planSha256) || confirmation !== plan.confirmation) throw new Error("r2_configuration_plan_integrity_invalid");
  const desired = stagingVideoUploadCorsRules(plan.origin);
  if (stableJson(plan.desiredCors) !== stableJson(desired) || plan.desiredCorsDigest !== digest(desired) || stableJson(plan.requiredSecretNames) !== stableJson(REQUIRED_VIDEO_UPLOAD_SECRETS) || stableJson(plan.featureFlag) !== stableJson({ name: "R2_VIDEO_DIRECT_UPLOADS_ENABLED", value: "1" })) throw new Error("r2_configuration_plan_scope_invalid");
  const currentCors = normalizeR2CorsRules(current.currentCors);
  if (stableJson(plan.authority) !== stableJson(current.authority) || stableJson(plan.git) !== stableJson(current.git) || stableJson(plan.worker) !== stableJson(current.worker) || plan.targetBucket !== current.authority.bucket || plan.currentCorsDigest !== digest(currentCors)) throw new Error("r2_configuration_plan_drift");
  if (!REQUIRED_VIDEO_UPLOAD_SECRETS.every((name) => current.worker?.secretNames?.includes(name))) throw new Error("r2_video_upload_secrets_not_installed");
  return true;
}
