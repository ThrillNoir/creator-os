import { readFileSync } from "node:fs";

const metadataFields = [
  ["component", "THOT_OS_COMPONENT"],
  ["environment", "THOT_OS_ENVIRONMENT"],
  ["gitSha", "THOT_OS_GIT_SHA"],
  ["gitBranch", "THOT_OS_GIT_BRANCH"],
  ["buildTime", "THOT_OS_BUILD_TIME"],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateStagingArtifactMetadata(metadata) {
  const errors = [];
  if (metadata?.environment !== "staging") errors.push("Staging artifacts must declare environment staging.");
  for (const [field] of metadataFields) {
    const value = metadata?.[field];
    if (typeof value !== "string" || !value.trim() || value === "unknown" || value === "local") errors.push(`Staging artifact metadata ${field} must be explicit and cannot be local or unknown.`);
  }
  return errors;
}

export function assertCompiledHealthMetadata({ artifactPath, metadata }) {
  const metadataErrors = validateStagingArtifactMetadata(metadata);
  if (metadataErrors.length) throw new Error(metadataErrors.join(" "));
  const compiled = readFileSync(artifactPath, "utf8");
  if (!compiled.includes('"/health"')) throw new Error("Compiled artifact does not contain the protected health route.");
  for (const [field, environmentKey] of metadataFields) {
    const expected = metadata[field];
    const expectedPattern = new RegExp(`['\"]${environmentKey}['\"]\\s*:\\s*['\"]${escapeRegExp(expected)}['\"]`);
    if (!expectedPattern.test(compiled)) throw new Error(`Compiled health artifact is missing ${environmentKey}=${expected}.`);
    const fallbackPattern = new RegExp(`['\"]${environmentKey}['\"]\\s*:\\s*['\"](?:local|unknown)['\"]`);
    if (fallbackPattern.test(compiled)) throw new Error(`Compiled health artifact contains an unsafe fallback for ${environmentKey}.`);
  }
  return true;
}
