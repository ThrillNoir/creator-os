import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { runPreflight, projectRoot } from "./deployment-preflight.mjs";
import { assertCompiledHealthMetadata, validateStagingArtifactMetadata } from "./staging-artifact-lib.mjs";

const webDirectory = path.join(projectRoot, "cloudflare/thot-os-next");
const nextBinary = path.join(webDirectory, "node_modules/.bin/next");
const openNextBinary = path.join(webDirectory, "node_modules/.bin/opennextjs-cloudflare");
const healthArtifact = path.join(webDirectory, ".open-next/server-functions/default/index.mjs");

function usage() {
  return "Usage: node scripts/build-staging-artifact.mjs [--component web]";
}

function parseArguments(argv) {
  const options = { component: "web" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--component") options.component = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.component !== "web") throw new Error("Only the web component has a compiled protected health route; use --component web.");
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
  execFileSync(process.execPath, [nextBinary, "build"], { cwd: webDirectory, env, stdio: "inherit" });
  execFileSync(process.execPath, [openNextBinary, "build"], { cwd: webDirectory, env, stdio: "inherit" });
  assertCompiledHealthMetadata({ artifactPath: healthArtifact, metadata });
  return { metadata, healthArtifact };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      const outcome = buildStagingArtifact();
      console.log(`Staging artifact verified: ${outcome.metadata.component}/${outcome.metadata.environment} at ${outcome.metadata.gitSha}.`);
    }
  } catch (error) {
    console.error(`Staging artifact build failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
