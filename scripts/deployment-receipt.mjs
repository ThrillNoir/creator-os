import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePreflightArguments, runPreflight } from "./deployment-preflight.mjs";
import { verifyStagingArtifactManifest } from "./staging-artifact-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function readJson(filePath, label) {
  try { return JSON.parse(readFileSync(filePath, "utf8")); } catch (error) { throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

export function validateDeploymentEvidence({ metadata, artifactManifest, evidence }) {
  if (evidence?.schemaVersion !== 1 || evidence?.kind !== "cloudflare-observed-deployment-evidence" || evidence?.verification !== "remote-observed") {
    throw new Error("Receipt requires versioned remote-observed Cloudflare evidence; synthetic fixtures are test-only.");
  }
  requiredString(evidence.observedAt, "Evidence observation time");
  const deployment = evidence.deployment ?? {};
  const migration = evidence.migration ?? {};
  const smokeTest = evidence.smokeTest ?? {};
  if (deployment.worker !== metadata.worker) throw new Error("Evidence Worker does not match the approved deployment target.");
  requiredString(deployment.workerVersion, "Evidence Worker version");
  if (!deployment.traffic || typeof deployment.traffic !== "object") throw new Error("Evidence must include observed Worker traffic allocation.");
  if (evidence.component !== metadata.component || evidence.environment !== metadata.environment) throw new Error("Evidence component or environment does not match the approved deployment target.");
  if (evidence.source?.gitSha !== artifactManifest.source?.gitSha || evidence.artifact?.sha256 !== artifactManifest.artifact?.sha256) throw new Error("Evidence source or artifact digest does not match the verified artifact manifest.");
  if (migration.verified !== true || !requiredString(migration.state, "Evidence migration state")) throw new Error("Receipt requires verified migration evidence.");
  if (smokeTest.verified !== true || !requiredString(smokeTest.status, "Evidence smoke-test status")) throw new Error("Receipt requires verified smoke-test evidence.");
  return { deployment, migration, smokeTest };
}

export function createDeploymentReceipt({ metadata, artifactManifest, evidence, operator, tool = "controlled-deployment-receipt" }) {
  if (!metadata?.gitSha || !metadata.gitBranch || !metadata.buildTime || !metadata.environment || !metadata.component || !metadata.worker) throw new Error("Deployment metadata must contain Git SHA, Git branch, build time, environment, component and Worker.");
  requiredString(operator, "Operator");
  const observed = validateDeploymentEvidence({ metadata, artifactManifest, evidence });
  return {
    schemaVersion: 2,
    component: metadata.component,
    service: metadata.service,
    environment: metadata.environment,
    source: { gitSha: artifactManifest.source.gitSha, gitBranch: artifactManifest.source.gitBranch, artifactSha256: artifactManifest.artifact.sha256 },
    buildTime: artifactManifest.build.timestamp,
    worker: { name: metadata.worker, version: observed.deployment.workerVersion, traffic: observed.deployment.traffic, observedAt: evidence.observedAt, evidenceSource: evidence.source?.provider ?? "cloudflare" },
    migration: { state: observed.migration.state, observedAt: observed.migration.observedAt ?? evidence.observedAt, verified: true },
    smokeTest: { status: observed.smokeTest.status, observedAt: observed.smokeTest.observedAt ?? evidence.observedAt, verified: true, detail: observed.smokeTest.detail ?? null },
    operator,
    tool,
    verification: "remote-observed",
  };
}

function parseArguments(argv) {
  const preflightArgs = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--environment", "--component", "--registry"].includes(argument)) preflightArgs.push(argument, argv[++index]);
    else if (argument === "--artifact-manifest") options.artifactManifest = argv[++index];
    else if (argument === "--evidence") options.evidence = argv[++index];
    else if (argument === "--operator") options.operator = argv[++index];
    else if (argument === "--receipt") options.receipt = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { options, preflight: parsePreflightArguments(preflightArgs) };
}

function usage() {
  return "Usage: node scripts/deployment-receipt.mjs --environment staging --component web --artifact-manifest <path> --evidence <remote-observed-evidence.json> --operator <name> --receipt <path>";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { options, preflight } = parseArguments(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      if (!options.receipt || !options.artifactManifest || !options.evidence || !options.operator) throw new Error(usage());
      const artifactManifestPath = path.resolve(projectRoot, options.artifactManifest);
      const artifactManifest = readJson(artifactManifestPath, "artifact manifest");
      const outcome = runPreflight({ ...preflight, requireClean: true, gitSha: artifactManifest.source?.gitSha, gitBranch: artifactManifest.source?.gitBranch, buildTime: artifactManifest.build?.timestamp });
      if (!outcome.ok || outcome.results.length !== 1) throw new Error("Receipt refused because deployment preflight did not pass.");
      const metadata = outcome.results[0].metadata;
      verifyStagingArtifactManifest({ artifactDirectory: path.dirname(artifactManifestPath), lockfilePath: path.join(projectRoot, "cloudflare/thot-os-next/package-lock.json"), manifest: artifactManifest, expectedMetadata: metadata });
      const evidence = readJson(path.resolve(projectRoot, options.evidence), "deployment evidence");
      const receipt = createDeploymentReceipt({ metadata, artifactManifest, evidence, operator: options.operator });
      const receiptPath = path.resolve(projectRoot, options.receipt);
      await mkdir(path.dirname(receiptPath), { recursive: true });
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      console.log(`Verified deployment receipt written to ${receiptPath}`);
    }
  } catch (error) {
    console.error(`Receipt failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
