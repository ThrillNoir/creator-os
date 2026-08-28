import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createStagingArtifactManifest, stagingArtifactManifestFilename, validateStagingArtifactMetadata, verifyStagingArtifactManifest } from "./staging-artifact-lib.mjs";
import { projectRoot, runPreflight } from "./deployment-preflight.mjs";

const directory = path.join(projectRoot, "cloudflare/vault-bridge");
const config = path.join(directory, "wrangler.jsonc");
const wrangler = path.join(directory, "node_modules/.bin/wrangler");
const artifactDirectory = path.join(directory, ".wrangler/staging-vault-artifact");
const manifestPath = path.join(artifactDirectory, stagingArtifactManifestFilename);
const lockfilePath = path.join(directory, "package-lock.json");

function git(args) { return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim(); }

export function buildVaultStagingArtifact() {
  if (git(["status", "--porcelain"])) throw new Error("A Vault staging artifact requires a clean Git worktree.");
  const preflight = runPreflight({ environment: "staging", component: "vault", all: false, requireClean: true, registry: path.join(projectRoot, "config/deployments.json") });
  if (!preflight.ok || preflight.results.length !== 1) throw new Error(preflight.results.flatMap((entry) => entry.errors).join(" "));
  const metadata = preflight.results[0].metadata; const errors = validateStagingArtifactMetadata(metadata); if (errors.length) throw new Error(errors.join(" "));
  if (!existsSync(wrangler)) throw new Error("Install the pinned Vault dependencies before building its staging artifact.");
  rmSync(artifactDirectory, { recursive: true, force: true }); mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  execFileSync(wrangler, ["deploy", "--dry-run", "--outdir", artifactDirectory, "--config", config], { cwd: directory, env: { ...process.env, CI: "1", THOT_OS_COMPONENT: metadata.component, THOT_OS_ENVIRONMENT: metadata.environment, THOT_OS_GIT_SHA: metadata.gitSha, THOT_OS_GIT_BRANCH: metadata.gitBranch, THOT_OS_BUILD_TIME: metadata.buildTime }, stdio: "inherit" });
  const manifest = createStagingArtifactManifest({ artifactDirectory, lockfilePath, metadata });
  manifest.artifact.directory = "cloudflare/vault-bridge/.wrangler/staging-vault-artifact";
  manifest.lockfile.path = "cloudflare/vault-bridge/package-lock.json";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  verifyStagingArtifactManifest({ artifactDirectory, lockfilePath, manifest, expectedMetadata: metadata });
  return { manifestPath, artifactDigest: manifest.artifact.sha256, metadata };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { const result = buildVaultStagingArtifact(); console.log(`Vault staging artifact verified at ${result.metadata.gitSha} (${result.artifactDigest}).`); }
  catch (error) { console.error(`Vault staging artifact build failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
