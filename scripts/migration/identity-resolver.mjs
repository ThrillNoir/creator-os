const confidenceOrder = ["DETERMINISTIC", "HIGH_CONFIDENCE", "PROBABLE", "AMBIGUOUS", "CONFLICT", "NO_MATCH"];

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function chooseFamilySignal(signals) {
  const byFamily = new Map();
  const rank = { CONTRADICTS: 3, SEPARATES: 2, SUPPORTS: 1 };
  for (const signal of signals) {
    if (!signal?.code || !signal?.family || !["STRONG", "MEDIUM", "WEAK"].includes(signal.strength) || !["SUPPORTS", "CONTRADICTS", "SEPARATES"].includes(signal.relation)) continue;
    const existing = byFamily.get(signal.family);
    if (!existing || rank[signal.relation] > rank[existing.relation]) byFamily.set(signal.family, signal);
  }
  return [...byFamily.values()].sort((left, right) => left.family.localeCompare(right.family));
}

export function resolveIdentity({ entityType = "entity", sourceCreatorId, targetCreatorId, signals = [] }) {
  if (sourceCreatorId && targetCreatorId && sourceCreatorId !== targetCreatorId) {
    return {
      entityType,
      match: "UNRESOLVED",
      confidence: "CONFLICT",
      evidence: [],
      conflictingEvidence: ["CREATOR_ISOLATION_BLOCK"],
      reasonCodes: ["CREATOR_ISOLATION_BLOCK"],
      autoResolutionEligible: false,
    };
  }
  const independent = chooseFamilySignal(signals);
  const supports = independent.filter((signal) => signal.relation === "SUPPORTS");
  const contradictions = independent.filter((signal) => signal.relation === "CONTRADICTS");
  const separates = independent.filter((signal) => signal.relation === "SEPARATES");
  const evidence = uniqueSorted(supports.map((signal) => signal.code));
  const conflictingEvidence = uniqueSorted([...contradictions, ...separates].map((signal) => signal.code));
  if (contradictions.length || (supports.length && separates.length)) return { entityType, match: "UNRESOLVED", confidence: "CONFLICT", evidence, conflictingEvidence, reasonCodes: ["INCOMPATIBLE_IDENTITY_EVIDENCE"], autoResolutionEligible: false };
  if (separates.length) return { entityType, match: "NO_MATCH", confidence: "NO_MATCH", evidence, conflictingEvidence, reasonCodes: ["STRONG_EVIDENCE_SUPPORTS_SEPARATE_ENTITIES"], autoResolutionEligible: false };
  const deterministic = supports.some((signal) => signal.strength === "STRONG" && signal.deterministic === true);
  const strong = supports.filter((signal) => signal.strength === "STRONG");
  const medium = supports.filter((signal) => signal.strength === "MEDIUM");
  if (deterministic) return { entityType, match: "MATCH", confidence: "DETERMINISTIC", evidence, conflictingEvidence, reasonCodes: ["VERIFIED_STABLE_IDENTIFIER"], autoResolutionEligible: true };
  if (strong.length >= 1 && (medium.length >= 1 || strong.length >= 2)) return { entityType, match: "MATCH", confidence: "HIGH_CONFIDENCE", evidence, conflictingEvidence, reasonCodes: ["INDEPENDENT_STRONG_AND_MEDIUM_EVIDENCE"], autoResolutionEligible: true };
  if (medium.length >= 2 || (strong.length === 1 && medium.length === 0)) return { entityType, match: "UNRESOLVED", confidence: "PROBABLE", evidence, conflictingEvidence, reasonCodes: ["CORROBORATION_NOT_SUFFICIENT_FOR_AUTOMATIC_IDENTITY"], autoResolutionEligible: false };
  return { entityType, match: "UNRESOLVED", confidence: "AMBIGUOUS", evidence, conflictingEvidence, reasonCodes: [supports.length ? "INSUFFICIENT_INDEPENDENT_EVIDENCE" : "NO_STRONG_OR_MEDIUM_EVIDENCE"], autoResolutionEligible: false };
}

export function resolveAssetIdentity({ creatorId, source, targetCandidates = [] }) {
  const sameCreator = targetCandidates.filter((target) => target.creator_id === creatorId);
  const crossCreator = targetCandidates.length !== sameCreator.length;
  const filenameCandidates = sameCreator.filter((target) => target.basename === source.basename && target.bytes === source.bytes && target.extension === source.extension);
  if (!source.source_available) return {
    assetStatus: "SOURCE_MISSING",
    confidence: "AMBIGUOUS",
    evidence: filenameCandidates.length ? ["FILENAME_BYTES_EXTENSION_MATCH"] : [],
    conflictingEvidence: crossCreator ? ["CREATOR_ISOLATION_BLOCK"] : [],
    reasonCodes: ["SOURCE_OBJECT_UNAVAILABLE", ...(filenameCandidates.length ? ["POSSIBLE_TARGET_DUPLICATE"] : [])],
    candidateCount: filenameCandidates.length,
  };
  const sourceChecksum = source.checksum ?? source.sha256 ?? null;
  const exactChecksum = sourceChecksum && sameCreator.find((target) => (target.checksum ?? target.sha256) === sourceChecksum);
  if (exactChecksum) return { assetStatus: "SAME_AS_TARGET", confidence: "DETERMINISTIC", evidence: ["ASSET_CHECKSUM_MATCH"], conflictingEvidence: [], reasonCodes: ["VERIFIED_STABLE_IDENTIFIER"], candidateCount: 1 };
  const sameObject = source.immutable_source_id && sameCreator.find((target) => target.immutable_source_id === source.immutable_source_id && target.dropbox_revision === source.dropbox_revision);
  if (sameObject) return { assetStatus: "SAME_AS_TARGET", confidence: "DETERMINISTIC", evidence: ["SOURCE_OBJECT_IDENTITY_MATCH"], conflictingEvidence: [], reasonCodes: ["VERIFIED_STABLE_IDENTIFIER"], candidateCount: 1 };
  if (sourceChecksum && filenameCandidates.length && filenameCandidates.every((target) => (target.checksum ?? target.sha256) && (target.checksum ?? target.sha256) !== sourceChecksum)) {
    return { assetStatus: "NO_MATCH", confidence: "NO_MATCH", evidence: ["FILENAME_BYTES_EXTENSION_MATCH"], conflictingEvidence: ["ASSET_CHECKSUM_MISMATCH"], reasonCodes: ["SAME_FILENAME_DIFFERENT_CHECKSUM"], candidateCount: filenameCandidates.length };
  }
  if (filenameCandidates.length) return { assetStatus: "POSSIBLE_DUPLICATE", confidence: "PROBABLE", evidence: ["FILENAME_BYTES_EXTENSION_MATCH"], conflictingEvidence: [], reasonCodes: ["POSSIBLE_TARGET_DUPLICATE", "SOURCE_OBJECT_UNVERIFIED"], candidateCount: filenameCandidates.length };
  const sourceObjectVerified = Boolean(sourceChecksum || source.immutable_source_id);
  if (sourceObjectVerified) return { assetStatus: "SOURCE_ONLY", confidence: "HIGH_CONFIDENCE", evidence: [sourceChecksum ? "ASSET_CHECKSUM_UNIQUE" : "SOURCE_OBJECT_IDENTITY_UNIQUE"], conflictingEvidence: crossCreator ? ["CREATOR_ISOLATION_BLOCK"] : [], reasonCodes: ["UNIQUE_SOURCE_OBJECT"], candidateCount: 0 };
  return { assetStatus: "POSSIBLE_DUPLICATE", confidence: "AMBIGUOUS", evidence: [], conflictingEvidence: [], reasonCodes: ["SOURCE_OBJECT_UNVERIFIED"], candidateCount: 0 };
}

export { confidenceOrder };
