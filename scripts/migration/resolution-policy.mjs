export function evaluateResolutionPolicy({ resolution, domain, creatorMapping, targetAuthoritative = false, credentialTreatment = null, consent = "NOT_REQUIRED", accountDependency = "RESOLVED", sourceObjectVerified = true, transformationSupported = true, futureCanonical = false }) {
  const blockers = [];
  if (targetAuthoritative) return { resolutionAction: "PRESERVE_SEPARATELY", eligibility: "BLOCKED", blockers: ["TARGET_AUTHORITATIVE"], reasonCodes: ["TARGET_AUTHORITATIVE_DATA_MUST_NOT_BE_DOWNGRADED"] };
  if (futureCanonical || creatorMapping?.approval === "planning_only") return { resolutionAction: "PRESERVE_SEPARATELY", eligibility: "BLOCKED", blockers: ["FUTURE_CANONICAL_CREATOR_NOT_CREATED"], reasonCodes: ["D1_CREATOR_CREATION_FORBIDDEN_IN_PHASE_1C_6"] };
  if (credentialTreatment === "RETIRED" || credentialTreatment === "RECONNECT_REQUIRED" || domain === "credentials") return { resolutionAction: "PRESERVE_SEPARATELY", eligibility: "ARCHIVE_ONLY", blockers: ["CREDENTIAL_OR_CONNECTION_EXCLUDED"], reasonCodes: ["CREDENTIAL_MIGRATION_FORBIDDEN"] };
  if (!creatorMapping || creatorMapping.approval !== "identity_match_only") blockers.push("CREATOR_MAPPING_NOT_CONFIRMED");
  if (consent === "UNKNOWN") blockers.push("CONSENT_UNRESOLVED");
  if (accountDependency !== "RESOLVED") blockers.push("ACCOUNT_OR_CONNECTION_DEPENDENCY_UNRESOLVED");
  if (!sourceObjectVerified) blockers.push("SOURCE_OBJECT_UNVERIFIED");
  if (!transformationSupported) blockers.push("TRANSFORMATION_NOT_SUPPORTED");
  if (resolution?.confidence === "CONFLICT") blockers.push("IDENTITY_CONFLICT");
  if (resolution?.confidence === "AMBIGUOUS" || resolution?.confidence === "PROBABLE") blockers.push("IDENTITY_NOT_AUTOMATIC");
  if (blockers.length) return { resolutionAction: resolution?.confidence === "PROBABLE" ? "INVESTIGATE" : "EXCEPTION", eligibility: "REVIEW_REQUIRED", blockers, reasonCodes: blockers };
  if (resolution?.autoResolutionEligible && ["DETERMINISTIC", "HIGH_CONFIDENCE"].includes(resolution.confidence)) {
    const nonDestructive = domain === "accounts" || domain === "connections" || domain === "messaging_connections";
    return { resolutionAction: nonDestructive ? "AUTO_RESOLVE" : "PRESERVE_SEPARATELY", eligibility: domain === "assets" ? "AUTO_ELIGIBLE" : "REVIEW_REQUIRED", blockers: [], reasonCodes: [nonDestructive ? "NON_DESTRUCTIVE_MAPPING_ONLY" : "FUTURE_MANIFEST_REQUIRED"] };
  }
  return { resolutionAction: "EXCEPTION", eligibility: "REVIEW_REQUIRED", blockers: ["IDENTITY_NOT_AUTOMATIC"], reasonCodes: ["IDENTITY_NOT_AUTOMATIC"] };
}
