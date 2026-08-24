export type PublicationMode = "disabled" | "synthetic-only" | "enabled";

const CREATOR_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

export type PublicationPolicy = {
  mode: PublicationMode;
  syntheticCreatorIds: ReadonlySet<string>;
};

/** Missing, malformed, or empty policy configuration never enables a release. */
export function publicationPolicy(modeValue: unknown, syntheticCreatorIdsValue: unknown): PublicationPolicy {
  const mode: PublicationMode = modeValue === "disabled" || modeValue === "synthetic-only" || modeValue === "enabled"
    ? modeValue
    : "disabled";
  const syntheticCreatorIds = new Set(
    typeof syntheticCreatorIdsValue === "string"
      ? syntheticCreatorIdsValue.split(",").map((value) => value.trim()).filter((value) => CREATOR_ID.test(value))
      : [],
  );
  return { mode, syntheticCreatorIds };
}

export function publicationIsAllowed(policy: PublicationPolicy, creatorId: string): boolean {
  if (!CREATOR_ID.test(creatorId)) return false;
  if (policy.mode === "enabled") return true;
  if (policy.mode === "synthetic-only") return policy.syntheticCreatorIds.has(creatorId);
  return false;
}
