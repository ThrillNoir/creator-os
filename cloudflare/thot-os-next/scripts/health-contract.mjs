function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

export function assertUnauthenticatedHealthDenied(status) {
  if (![302, 401, 403].includes(status)) throw new Error(`Unauthenticated health check must be denied by Access, received HTTP ${status}.`);
  return true;
}

export function validateAuthenticatedHealth({ status, result, expected }) {
  if (status !== 200) throw new Error(`Authenticated health check failed with HTTP ${status}.`);
  requiredString(expected?.component, "Expected component");
  requiredString(expected?.environment, "Expected environment");
  requiredString(expected?.gitSha, "Expected Git SHA");
  if (result?.ok !== true || result?.runtime !== "nextjs-opennext") throw new Error("Authenticated health response did not match the THOT OS runtime contract.");
  if (result.service !== expected.component || result.environment !== expected.environment) throw new Error("Authenticated health response did not match the approved component or environment.");
  if (result.deployment?.gitSha !== expected.gitSha || result.deployment?.gitBranch !== expected.gitBranch || result.deployment?.buildTime !== expected.buildTime) throw new Error("Authenticated health response did not match the approved artifact identity.");
  if (typeof result.creatorId !== "string" || !result.creatorId || result.database?.connected !== true || typeof result.database?.migration !== "string" || result.bindings?.d1 !== true) throw new Error("Authenticated health response did not prove the D1-backed creator contract.");
  if (result.sourceMediaCapability !== "r2-source-v2" || result.bindings?.libraryMedia !== true || !result.consumers || !["vault", "instagram", "reddit"].every((name) => typeof result.consumers[name]?.compatible === "boolean")) throw new Error("Authenticated health response did not report the cross-service R2 source-media contract.");
  return true;
}

export function healthSummary(result) {
  return {
    ok: true,
    service: result.service,
    environment: result.environment,
    runtime: result.runtime,
    migration: result.database.migration,
    gitSha: result.deployment.gitSha,
  };
}
