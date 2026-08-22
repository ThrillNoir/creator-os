import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateWorkerCompatibility, workerdCompatibilityDate } from "../scripts/cloudflare-runtime-compatibility.mjs";
import { assertCompiledHealthMetadata, validateStagingArtifactMetadata } from "../scripts/staging-artifact-lib.mjs";

const metadata = {
  component: "web",
  environment: "staging",
  gitSha: "47f980a4628da4d75f690ec7b25da53897b382d0",
  gitBranch: "codex/creator-profile-staging",
  buildTime: "2026-08-22T05:00:00.000Z",
};

test("pinned workerd compatibility date is derived from the published runtime version", () => {
  assert.equal(workerdCompatibilityDate("1.20260820.1"), "2026-08-20");
  assert.throws(() => workerdCompatibilityDate("invalid"), /Unable to derive/);
});

test("compatibility preflight fails closed when a Worker asks for a newer date", () => {
  const runtime = { wranglerVersion: "4.125.0", workerdVersion: "1.20260820.1", maximumCompatibilityDate: "2026-08-20" };
  const outcome = validateWorkerCompatibility({
    runtime,
    components: [
      { label: "staging/web", config: { compatibility_date: "2026-08-17" } },
      { label: "template/adult", config: { compatibility_date: "2026-08-21" } },
    ],
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.errors.join("\n"), /template\/adult requires compatibility date 2026-08-21/);
});

test("compiled staging health artifact requires explicit metadata and rejects local fallbacks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "thot-os-artifact-test-"));
  const artifact = path.join(directory, "index.mjs");
  try {
    writeFileSync(artifact, `var NextConfig = ${JSON.stringify({
      env: {
        THOT_OS_COMPONENT: metadata.component,
        THOT_OS_ENVIRONMENT: metadata.environment,
        THOT_OS_GIT_SHA: metadata.gitSha,
        THOT_OS_GIT_BRANCH: metadata.gitBranch,
        THOT_OS_BUILD_TIME: metadata.buildTime,
      },
    })};\nvar RoutesManifest = ${JSON.stringify({ routes: { static: [{ page: "/health" }] } })};\n`);
    assert.equal(assertCompiledHealthMetadata({ artifactPath: artifact, metadata }), true);
    assert.deepEqual(validateStagingArtifactMetadata({ ...metadata, gitSha: "unknown" }), ["Staging artifact metadata gitSha must be explicit and cannot be local or unknown."]);
    writeFileSync(artifact, `${readFileSync(artifact, "utf8")}var fallback = { "THOT_OS_ENVIRONMENT": "local" };\n`);
    assert.throws(() => assertCompiledHealthMetadata({ artifactPath: artifact, metadata }), /unsafe fallback/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
