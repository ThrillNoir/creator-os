import { resolveIdentity } from "./identity-resolver.mjs";

const evidenceSignals = {
  same_creator: ["creator_ownership", "MEDIUM", "SUPPORTS"],
  same_platform: ["account_type", "MEDIUM", "SUPPORTS"],
  exact_handle: ["exact_platform_handle", "MEDIUM", "SUPPORTS"],
  source_and_target_identity_confirmed: ["connection_identity_state", "MEDIUM", "SUPPORTS"],
  target_browser_profile_verified: ["browser_profile_verified", "MEDIUM", "SUPPORTS"],
  confirmed_provider_external_identity: ["provider_connection_corroboration", "MEDIUM", "SUPPORTS"],
  one_target_platform_candidate: ["single_target_candidate", "MEDIUM", "SUPPORTS"],
  target_validated_state: ["target_validated_state", "MEDIUM", "SUPPORTS"],
  confirmed_account_or_bridge_evidence: ["parent_account_or_bridge", "MEDIUM", "SUPPORTS"],
  handle_mismatch: ["exact_platform_handle", "MEDIUM", "CONTRADICTS"],
  external_identity_mismatch: ["immutable_external_id", "STRONG", "CONTRADICTS"],
  two_source_accounts_to_one_target_candidate: ["one_target_to_many_source", "STRONG", "CONTRADICTS"],
  exact_external_identity: ["immutable_external_id", "STRONG", "SUPPORTS", true],
  exact_private_external_identity: ["immutable_external_id", "STRONG", "SUPPORTS", true],
  target_identity_confirmed: ["connection_identity_state", "MEDIUM", "SUPPORTS"],
  target_polled: ["target_validated_state", "MEDIUM", "SUPPORTS"],
};

export function resolveConnectionEntry(entry, supplementalSignals = []) {
  const mappedSignals = (entry.evidence ?? []).map((code) => {
      const [family, strength, relation, deterministic] = evidenceSignals[code] ?? [code, "WEAK", "SUPPORTS"];
      return { code, family, strength, relation, deterministic };
    });
  if (entry.classification === "CONFIRMED") return {
    ...resolveIdentity({ entityType: entry.kind, sourceCreatorId: entry.creatorId, targetCreatorId: entry.creatorId, signals: [...mappedSignals, ...supplementalSignals] }),
    declaredClassification: entry.classification,
  };
  return {
    ...resolveIdentity({ entityType: entry.kind, sourceCreatorId: entry.creatorId, targetCreatorId: entry.targetRef ? entry.creatorId : undefined, signals: [
      ...mappedSignals,
      ...supplementalSignals,
      ...(entry.classification === "CONFLICT" ? [{ code: "DECLARED_MAPPING_CONFLICT", family: "declared_mapping", strength: "STRONG", relation: "CONTRADICTS" }] : []),
    ] }),
    declaredClassification: entry.classification,
  };
}
