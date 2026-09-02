import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runPreflight, projectRoot } from "./deployment-preflight.mjs";
import { assertCompiledHealthMetadata, createStagingArtifactManifest, stagingArtifactManifestFilename, validateStagingArtifactMetadata, verifyStagingArtifactManifest } from "./staging-artifact-lib.mjs";
import { buildVaultStagingArtifact } from "./build-vault-staging-artifact.mjs";
import { stagingDeploymentWorkers } from "./staging-web-deployment-lib.mjs";

const webDirectory = path.join(projectRoot, "cloudflare/thot-os-next");
const nextBinary = path.join(webDirectory, "node_modules/.bin/next");
const openNextBinary = path.join(webDirectory, "node_modules/.bin/opennextjs-cloudflare");
const healthArtifact = path.join(webDirectory, ".open-next/server-functions/default/index.mjs");
const artifactDirectory = path.join(webDirectory, ".open-next");
const artifactManifest = path.join(artifactDirectory, stagingArtifactManifestFilename);
const lockfilePath = path.join(webDirectory, "package-lock.json");

function usage() {
  return `Usage: node scripts/build-staging-artifact.mjs [--component ${Object.keys(stagingDeploymentWorkers).join("|")}]`;
}

function parseArguments(argv) {
  const options = { component: "web" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--component") options.component = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Object.hasOwn(stagingDeploymentWorkers, options.component)) throw new Error("Select a reviewed staging component.");
  return options;
}

function commandOutput(command, args) {
  return execFileSync(command, args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function requireCleanWorktree() {
  if (commandOutput("git", ["status", "--porcelain"])) throw new Error("A staging artifact must be built from a clean Git worktree so its Git SHA identifies the compiled source.");
}

function buildEnvironment(metadata) {
  return {
    ...process.env,
    CI: "1",
    // Match the standalone/output-tracing mode OpenNext sets when it owns the
    // Next build, while retaining the explicit worktree-safe Webpack command.
    NEXT_PRIVATE_STANDALONE: "true",
    NEXT_PRIVATE_OUTPUT_TRACE_ROOT: webDirectory,
    THOT_OS_COMPONENT: metadata.component,
    THOT_OS_ENVIRONMENT: metadata.environment,
    THOT_OS_GIT_SHA: metadata.gitSha,
    THOT_OS_GIT_BRANCH: metadata.gitBranch,
    THOT_OS_BUILD_TIME: metadata.buildTime,
  };
}

export function buildStagingArtifact() {
  requireCleanWorktree();
  const preflight = runPreflight({ environment: "staging", component: "web", all: false, requireClean: true, registry: path.join(projectRoot, "config/deployments.json") });
  if (!preflight.ok) throw new Error(preflight.results.flatMap((result) => result.errors).join(" "));
  const metadata = preflight.results[0].metadata;
  const metadataErrors = validateStagingArtifactMetadata(metadata);
  if (metadataErrors.length) throw new Error(metadataErrors.join(" "));
  if (!existsSync(nextBinary) || !existsSync(openNextBinary)) throw new Error("Install the pinned web dependencies before building a staging artifact.");

  const env = buildEnvironment(metadata);
  // Turbopack rejects the intentionally external node_modules symlink used by
  // isolated release worktrees. Webpack is explicit so the same pinned build
  // remains reproducible in both the canonical checkout and safe worktrees.
  execFileSync(process.execPath, [nextBinary, "build", "--webpack"], { cwd: webDirectory, env, stdio: "inherit" });
  execFileSync(process.execPath, [openNextBinary, "build", "--skipNextBuild"], { cwd: webDirectory, env, stdio: "inherit" });
  assertCompiledHealthMetadata({ artifactPath: healthArtifact, metadata });
  const manifest = createStagingArtifactManifest({ artifactDirectory, lockfilePath, metadata });
  writeFileSync(artifactManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  verifyStagingArtifactManifest({ artifactDirectory, lockfilePath, manifest, expectedMetadata: metadata });
  return { metadata, healthArtifact, artifactManifest, artifactDigest: manifest.artifact.sha256 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      const outcome = options.component === "web" ? buildStagingArtifact() : buildVaultStagingArtifact(options.component);
      console.log(`Staging artifact verified: ${outcome.metadata.component}/${outcome.metadata.environment} at ${outcome.metadata.gitSha} (${outcome.artifactDigest}).`);
    }
  } catch (error) {
    console.error(`Staging artifact build failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
