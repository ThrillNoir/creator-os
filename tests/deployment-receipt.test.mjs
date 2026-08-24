import assert from "node:assert/strict";
import test from "node:test";
import { createDeploymentReceipt } from "../scripts/deployment-receipt.mjs";

const metadata = {
  component: "web",
  service: "thot-os-web",
  environment: "staging",
  gitSha: "abc123",
  gitBranch: "codex/staging-readiness-maintenance",
  buildTime: "2026-08-24T00:00:00.000Z",
  worker: "thot-os-staging",
};
const artifactManifest = {
  schemaVersion: 1,
  source: { gitSha: metadata.gitSha, gitBranch: metadata.gitBranch, clean: true },
  build: { timestamp: metadata.buildTime },
  artifact: { sha256: "artifact-digest", files: [] },
};
function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "cloudflare-observed-deployment-evidence",
    verification: "remote-observed",
    observedAt: "2026-08-24T01:00:00.000Z",
    component: "web",
    environment: "staging",
    source: { provider: "wrangler-versions-list", gitSha: "abc123" },
    artifact: { sha256: "artifact-digest" },
    deployment: { worker: "thot-os-staging", workerVersion: "version-123", traffic: { "version-123": 100 } },
    migration: { state: "current", verified: true, observedAt: "2026-08-24T01:00:01.000Z" },
    smokeTest: { status: "verified", verified: true, observedAt: "2026-08-24T01:00:02.000Z", detail: "health contract matched" },
    ...overrides,
  };
}

test("a receipt derives release facts from verified observed evidence", () => {
  const receipt = createDeploymentReceipt({ metadata, artifactManifest, evidence: evidence(), operator: "release-operator" });
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.worker.version, "version-123");
  assert.deepEqual(receipt.worker.traffic, { "version-123": 100 });
  assert.equal(receipt.source.artifactSha256, "artifact-digest");
  assert.equal(receipt.smokeTest.verified, true);
  assert.equal(receipt.migration.verified, true);
});

test("receipts reject caller assertions, forged artifacts, and mismatched targets", () => {
  assert.throws(() => createDeploymentReceipt({ metadata, artifactManifest, evidence: { ...evidence(), verification: "synthetic" }, operator: "release-operator" }), /remote-observed/);
  assert.throws(() => createDeploymentReceipt({ metadata, artifactManifest, evidence: evidence({ artifact: { sha256: "forged" } }), operator: "release-operator" }), /artifact digest/);
  assert.throws(() => createDeploymentReceipt({ metadata, artifactManifest, evidence: evidence({ deployment: { worker: "other-worker", workerVersion: "version-123", traffic: { "version-123": 100 } } }), operator: "release-operator" }), /Worker does not match/);
  assert.throws(() => createDeploymentReceipt({ metadata, artifactManifest, evidence: evidence({ smokeTest: { status: "verified", verified: false } }), operator: "release-operator" }), /smoke-test evidence/);
});
