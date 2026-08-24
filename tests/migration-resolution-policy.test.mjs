import assert from "node:assert/strict";
import test from "node:test";
import { automatedReconcile, groupedExceptions } from "../scripts/migration/automated-reconcile.mjs";
import { evaluateResolutionPolicy } from "../scripts/migration/resolution-policy.mjs";

const mapping = { approval: "identity_match_only" };
const deterministic = { confidence: "DETERMINISTIC", autoResolutionEligible: true };

test("policy never lets confidence bypass target authority, credentials, consent, or dependencies", () => {
  assert.equal(evaluateResolutionPolicy({ resolution: deterministic, domain: "assets", creatorMapping: mapping, targetAuthoritative: true }).eligibility, "BLOCKED");
  assert.equal(evaluateResolutionPolicy({ resolution: deterministic, domain: "credentials", creatorMapping: mapping }).eligibility, "ARCHIVE_ONLY");
  assert.equal(evaluateResolutionPolicy({ resolution: deterministic, domain: "assets", creatorMapping: mapping, consent: "UNKNOWN" }).eligibility, "REVIEW_REQUIRED");
  assert.equal(evaluateResolutionPolicy({ resolution: deterministic, domain: "assets", creatorMapping: mapping, accountDependency: "UNRESOLVED" }).eligibility, "REVIEW_REQUIRED");
});

test("candidate policy marks a unique supported source asset as future-only auto eligible", () => {
  const policy = evaluateResolutionPolicy({ resolution: deterministic, domain: "assets", creatorMapping: mapping, sourceObjectVerified: true, transformationSupported: true });
  assert.equal(policy.eligibility, "AUTO_ELIGIBLE");
  assert.equal(policy.resolutionAction, "PRESERVE_SEPARATELY");
  assert.equal(policy.blockers.includes("UPDATE"), false);
});

test("future canonical authority is planning-only", () => {
  const policy = evaluateResolutionPolicy({ resolution: deterministic, domain: "assets", creatorMapping: { approval: "planning_only" }, futureCanonical: true });
  assert.equal(policy.eligibility, "BLOCKED");
});

test("automated reconciliation preserves the global kill switch and production rejection", () => {
  assert.throws(() => automatedReconcile({ apply: true }), /Migration apply is disabled by the Phase 1C\.6 safety contract\./);
  assert.throws(() => automatedReconcile({ environment: "production", creator: "adelaide", source_snapshot: "/tmp/source.sqlite", target_snapshot: "/tmp/target.sqlite", output: "/tmp/report.json" }), /Only the explicitly provisioned staging/);
});

test("exceptions group duplicate record decisions without raw records", () => {
  const exceptions = groupedExceptions([
    { creatorId: "adelaide", domain: "messages", entityType: "message", classification: "AMBIGUOUS", confidence: "AMBIGUOUS", evidence: ["A"], conflictingEvidence: [], reasonCodes: ["CONNECTION"], risk: "medium", recommendedResolution: "Confirm connection", requiresHumanInput: true, recordRefs: ["one"], automaticInvestigation: ["scan"] },
    { creatorId: "adelaide", domain: "messages", entityType: "message", classification: "AMBIGUOUS", confidence: "AMBIGUOUS", evidence: ["A"], conflictingEvidence: [], reasonCodes: ["CONNECTION"], risk: "medium", recommendedResolution: "Confirm connection", requiresHumanInput: true, recordRefs: ["two"], automaticInvestigation: ["scan"] },
  ], "fixture");
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].affectedRecordCount, 2);
  assert.equal(exceptions[0].sampleRecordRefs.length, 2);
});
