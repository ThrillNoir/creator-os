import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssetIdentity, resolveIdentity } from "../scripts/migration/identity-resolver.mjs";

test("a verified provider identifier deterministically resolves an identity", () => {
  const result = resolveIdentity({ sourceCreatorId: "adelaide", targetCreatorId: "adelaide", signals: [{ code: "PROVIDER_ID", family: "provider_id", strength: "STRONG", relation: "SUPPORTS", deterministic: true }] });
  assert.equal(result.confidence, "DETERMINISTIC");
  assert.equal(result.autoResolutionEligible, true);
});

test("independent strong and medium evidence yields explainable high confidence", () => {
  const result = resolveIdentity({ sourceCreatorId: "adelaide", targetCreatorId: "adelaide", signals: [
    { code: "CANONICAL_SOURCE", family: "canonical_source", strength: "STRONG", relation: "SUPPORTS" },
    { code: "EXACT_HANDLE", family: "handle", strength: "MEDIUM", relation: "SUPPORTS" },
  ] });
  assert.equal(result.confidence, "HIGH_CONFIDENCE");
  assert.deepEqual(result.evidence, ["CANONICAL_SOURCE", "EXACT_HANDLE"]);
});

test("weak display-name evidence cannot create an automatic match", () => {
  const result = resolveIdentity({ sourceCreatorId: "adelaide", targetCreatorId: "adelaide", signals: [{ code: "DISPLAY_NAME", family: "display_name", strength: "WEAK", relation: "SUPPORTS" }] });
  assert.equal(result.confidence, "AMBIGUOUS");
  assert.equal(result.autoResolutionEligible, false);
});

test("conflicting provider identities and cross-creator comparisons fail closed", () => {
  const conflict = resolveIdentity({ sourceCreatorId: "adelaide", targetCreatorId: "adelaide", signals: [{ code: "PROVIDER_ID_MISMATCH", family: "provider_id", strength: "STRONG", relation: "CONTRADICTS" }] });
  assert.equal(conflict.confidence, "CONFLICT");
  const crossCreator = resolveIdentity({ sourceCreatorId: "adelaide", targetCreatorId: "bryshanagy", signals: [] });
  assert.equal(crossCreator.reasonCodes[0], "CREATOR_ISOLATION_BLOCK");
});

test("resolver deduplicates correlated evidence by family", () => {
  const result = resolveIdentity({ sourceCreatorId: "adelaide", targetCreatorId: "adelaide", signals: [
    { code: "HANDLE_ONE", family: "handle", strength: "MEDIUM", relation: "SUPPORTS" },
    { code: "HANDLE_TWO", family: "handle", strength: "MEDIUM", relation: "SUPPORTS" },
  ] });
  assert.equal(result.confidence, "AMBIGUOUS");
});

test("asset resolution prefers checksums and rejects filename-only collisions", () => {
  const source = { creator_id: "adelaide", basename: "same.jpg", extension: "jpg", bytes: 1, source_available: true, checksum: "source" };
  const same = resolveAssetIdentity({ creatorId: "adelaide", source, targetCandidates: [{ creator_id: "adelaide", checksum: "source" }] });
  assert.equal(same.assetStatus, "SAME_AS_TARGET");
  const differentChecksum = resolveAssetIdentity({ creatorId: "adelaide", source, targetCandidates: [{ creator_id: "adelaide", basename: "same.jpg", extension: "jpg", bytes: 1, checksum: "other" }] });
  assert.equal(differentChecksum.assetStatus, "NO_MATCH");
  const otherCreator = resolveAssetIdentity({ creatorId: "adelaide", source, targetCandidates: [{ creator_id: "bryshanagy", checksum: "source" }] });
  assert.equal(otherCreator.assetStatus, "SOURCE_ONLY");
  assert.ok(otherCreator.conflictingEvidence.includes("CREATOR_ISOLATION_BLOCK"));
});

test("missing source media cannot become a migration candidate", () => {
  const result = resolveAssetIdentity({ creatorId: "bryshanagy", source: { creator_id: "bryshanagy", source_available: false }, targetCandidates: [] });
  assert.equal(result.assetStatus, "SOURCE_MISSING");
});
