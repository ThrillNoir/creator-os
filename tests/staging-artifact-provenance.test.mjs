import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStagingArtifactManifest, stagingArtifactManifestFilename, verifyStagingArtifactManifest } from "../scripts/staging-artifact-lib.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "thot-os-artifact-"));
  const artifactDirectory = path.join(root, ".open-next");
  const lockfilePath = path.join(root, "package-lock.json");
  mkdirSync(path.join(artifactDirectory, "server-functions"), { recursive: true });
  writeFileSync(path.join(artifactDirectory, "worker.js"), "export default { fetch() {} };\n");
  writeFileSync(path.join(artifactDirectory, "server-functions", "health.js"), "export const health = true;\n");
  writeFileSync(lockfilePath, '{"lockfileVersion":3}\n');
  const metadata = { component: "web", environment: "staging", gitSha: "abc123", gitBranch: "codex/staging-readiness-maintenance", buildTime: "2026-08-24T00:00:00.000Z" };
  return { root, artifactDirectory, lockfilePath, metadata };
}

function withFixture(run) {
  const value = fixture();
  try { run(value); } finally { rmSync(value.root, { recursive: true, force: true }); }
}

test("a staging artifact manifest binds deployable files, source identity, and the pinned lockfile", () => withFixture(({ artifactDirectory, lockfilePath, metadata }) => {
  const manifest = createStagingArtifactManifest({ artifactDirectory, lockfilePath, metadata, nodeVersion: "v-test" });
  writeFileSync(path.join(artifactDirectory, stagingArtifactManifestFilename), `${JSON.stringify(manifest)}\n`);
  assert.equal(manifest.source.clean, true);
  assert.equal(manifest.artifact.fileCount, 2);
  assert.equal(verifyStagingArtifactManifest({ artifactDirectory, lockfilePath, manifest, expectedMetadata: metadata }), true);
}));

test("artifact, lockfile, and source identity mismatches fail closed", () => withFixture(({ artifactDirectory, lockfilePath, metadata }) => {
  const manifest = createStagingArtifactManifest({ artifactDirectory, lockfilePath, metadata });
  writeFileSync(path.join(artifactDirectory, stagingArtifactManifestFilename), `${JSON.stringify(manifest)}\n`);
  writeFileSync(path.join(artifactDirectory, "worker.js"), "tampered\n");
  assert.throws(() => verifyStagingArtifactManifest({ artifactDirectory, lockfilePath, manifest, expectedMetadata: metadata }), /artifact digest/);

  const cleanManifest = createStagingArtifactManifest({ artifactDirectory, lockfilePath, metadata });
  writeFileSync(path.join(artifactDirectory, stagingArtifactManifestFilename), `${JSON.stringify(cleanManifest)}\n`);
  writeFileSync(lockfilePath, '{"lockfileVersion":4}\n');
  assert.throws(() => verifyStagingArtifactManifest({ artifactDirectory, lockfilePath, manifest: cleanManifest, expectedMetadata: metadata }), /lockfile digest/);
  assert.throws(() => verifyStagingArtifactManifest({ artifactDirectory, lockfilePath, manifest: cleanManifest, expectedMetadata: { ...metadata, gitSha: "different" } }), /source Git identity/);
}));
