import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const stagingArtifactManifestFilename = "staging-artifact-manifest.json";

const metadataFields = [
  ["component", "THOT_OS_COMPONENT"],
  ["environment", "THOT_OS_ENVIRONMENT"],
  ["gitSha", "THOT_OS_GIT_SHA"],
  ["gitBranch", "THOT_OS_GIT_BRANCH"],
  ["buildTime", "THOT_OS_BUILD_TIME"],
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function artifactFiles(root, relativePath = "", excluded = new Set()) {
  const directory = path.join(root, relativePath);
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const childRelativePath = normalizedRelativePath(path.join(relativePath, entry.name));
    if (excluded.has(childRelativePath)) continue;
    const childPath = path.join(root, childRelativePath);
    if (entry.isSymbolicLink()) throw new Error(`Deployable artifact cannot contain symbolic links: ${childRelativePath}.`);
    if (entry.isDirectory()) files.push(...artifactFiles(root, childRelativePath, excluded));
    else if (entry.isFile()) {
      const contents = readFileSync(childPath);
      files.push({ path: childRelativePath, bytes: contents.length, sha256: sha256(contents) });
    } else {
      throw new Error(`Deployable artifact contains an unsupported filesystem entry: ${childRelativePath}.`);
    }
  }
  return files;
}

export function validateStagingArtifactMetadata(metadata) {
  const errors = [];
  if (metadata?.environment !== "staging") errors.push("Staging artifacts must declare environment staging.");
  for (const [field] of metadataFields) {
    const value = metadata?.[field];
    if (typeof value !== "string" || !value.trim() || value === "unknown" || value === "local") errors.push(`Staging artifact metadata ${field} must be explicit and cannot be local or unknown.`);
  }
  return errors;
}

export function artifactDigest({ artifactDirectory, excludedPaths = [] }) {
  if (!existsSync(artifactDirectory) || !statSync(artifactDirectory).isDirectory()) throw new Error("Deployable artifact directory is missing.");
  const files = artifactFiles(artifactDirectory, "", new Set(excludedPaths));
  if (!files.length) throw new Error("Deployable artifact contains no files.");
  return { files, sha256: sha256(JSON.stringify(files)) };
}

export function createStagingArtifactManifest({ artifactDirectory, lockfilePath, metadata, nodeVersion = process.version }) {
  const metadataErrors = validateStagingArtifactMetadata(metadata);
  if (metadataErrors.length) throw new Error(metadataErrors.join(" "));
  if (!existsSync(lockfilePath)) throw new Error("Pinned web lockfile is missing.");
  const digest = artifactDigest({ artifactDirectory, excludedPaths: [stagingArtifactManifestFilename] });
  return {
    schemaVersion: 1,
    component: metadata.component,
    environment: metadata.environment,
    source: { gitSha: metadata.gitSha, gitBranch: metadata.gitBranch, clean: true },
    build: { timestamp: metadata.buildTime, nodeVersion },
    artifact: { directory: ".open-next", sha256: digest.sha256, fileCount: digest.files.length, files: digest.files },
    lockfile: { path: "cloudflare/thot-os-next/package-lock.json", sha256: sha256(readFileSync(lockfilePath)) },
  };
}

export function verifyStagingArtifactManifest({ artifactDirectory, lockfilePath, manifest, expectedMetadata }) {
  if (manifest?.schemaVersion !== 1) throw new Error("Unsupported or missing staging artifact manifest schemaVersion.");
  const metadataErrors = validateStagingArtifactMetadata(expectedMetadata);
  if (metadataErrors.length) throw new Error(metadataErrors.join(" "));
  if (manifest.component !== expectedMetadata.component || manifest.environment !== expectedMetadata.environment) throw new Error("Artifact manifest component or environment does not match the deployment request.");
  if (manifest.source?.gitSha !== expectedMetadata.gitSha || manifest.source?.gitBranch !== expectedMetadata.gitBranch) throw new Error("Artifact manifest source Git identity does not match the deployment request.");
  if (manifest.source?.clean !== true) throw new Error("Artifact manifest does not attest to a clean source worktree.");
  if (manifest.build?.timestamp !== expectedMetadata.buildTime) throw new Error("Artifact manifest build timestamp does not match the deployment request.");
  if (!manifest.artifact?.sha256 || !Array.isArray(manifest.artifact.files)) throw new Error("Artifact manifest is missing an artifact digest inventory.");
  if (!manifest.lockfile?.sha256 || !existsSync(lockfilePath)) throw new Error("Artifact manifest cannot verify the pinned lockfile.");

  const actualArtifact = artifactDigest({ artifactDirectory, excludedPaths: [stagingArtifactManifestFilename] });
  if (manifest.artifact.sha256 !== actualArtifact.sha256 || manifest.artifact.fileCount !== actualArtifact.files.length || JSON.stringify(manifest.artifact.files) !== JSON.stringify(actualArtifact.files)) throw new Error("Deployable artifact digest does not match the verified manifest.");
  if (manifest.lockfile.sha256 !== sha256(readFileSync(lockfilePath))) throw new Error("Pinned lockfile digest does not match the verified manifest.");
  return true;
}

export function assertCompiledHealthMetadata({ artifactPath, metadata }) {
  const metadataErrors = validateStagingArtifactMetadata(metadata);
  if (metadataErrors.length) throw new Error(metadataErrors.join(" "));
  const compiled = readFileSync(artifactPath, "utf8");
  if (!compiled.includes('"/health"')) throw new Error("Compiled artifact does not contain the protected health route.");
  for (const [field, environmentKey] of metadataFields) {
    const expected = metadata[field];
    const expectedPattern = new RegExp(`['\"]${environmentKey}['\"]\\s*:\\s*['\"]${escapeRegExp(expected)}['\"]`);
    if (!expectedPattern.test(compiled)) throw new Error(`Compiled health artifact is missing ${environmentKey}=${expected}.`);
    const fallbackPattern = new RegExp(`['\"]${environmentKey}['\"]\\s*:\\s*['\"](?:local|unknown)['\"]`);
    if (fallbackPattern.test(compiled)) throw new Error(`Compiled health artifact contains an unsafe fallback for ${environmentKey}.`);
  }
  return true;
}
