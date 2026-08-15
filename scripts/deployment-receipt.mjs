import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePreflightArguments, runPreflight } from "./deployment-preflight.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeStatuses = new Set(["deployed", "verified", "not-verified"]);

export function createDeploymentReceipt({ metadata, workerVersion, migrationState, smokeStatus, smokeDetail = null, operator, tool = "manual-controlled-deploy" }) {
  if (!metadata?.gitSha || !metadata.gitBranch || !metadata.buildTime || !metadata.environment || !metadata.component || !metadata.worker) throw new Error("Deployment metadata must contain Git SHA, Git branch, build time, environment, component and Worker.");
  if (!workerVersion) throw new Error("A Cloudflare Worker version is required for a deployment receipt.");
  if (!migrationState) throw new Error("Migration state is required for a deployment receipt.");
  if (!smokeStatuses.has(smokeStatus)) throw new Error("Smoke status must be deployed, verified or not-verified.");
  if (!operator) throw new Error("Operator is required for a deployment receipt.");
  return {
    schemaVersion: 1,
    component: metadata.component,
    service: metadata.service,
    environment: metadata.environment,
    gitSha: metadata.gitSha,
    gitBranch: metadata.gitBranch,
    buildTime: metadata.buildTime,
    worker: metadata.worker,
    workerVersion,
    deploymentTimestamp: new Date().toISOString(),
    migrationState,
    resourceBindingsVerified: {
      mode: "registry-and-config",
      verified: true,
    },
    smokeTest: { status: smokeStatus, detail: smokeDetail },
    operator,
    tool,
  };
}

function parseArguments(argv) {
  const preflightArgs = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--environment", "--component", "--registry", "--git-sha", "--git-branch", "--build-time"].includes(argument)) {
      preflightArgs.push(argument, argv[++index]);
    } else if (argument === "--worker-version") options.workerVersion = argv[++index];
    else if (argument === "--migration-state") options.migrationState = argv[++index];
    else if (argument === "--smoke-status") options.smokeStatus = argv[++index];
    else if (argument === "--smoke-detail") options.smokeDetail = argv[++index];
    else if (argument === "--operator") options.operator = argv[++index];
    else if (argument === "--receipt") options.receipt = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return { options, preflight: parsePreflightArguments(preflightArgs) };
}

function usage() {
  return "Usage: node scripts/deployment-receipt.mjs --environment staging --component web --git-sha <sha> --git-branch <branch> --build-time <ISO-8601> --worker-version <id> --migration-state <state> --smoke-status <deployed|verified|not-verified> --operator <name> --receipt <path>";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { options, preflight } = parseArguments(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      if (!options.receipt) throw new Error("A durable --receipt path is required.");
      if (!preflight.gitSha || !preflight.gitBranch || !preflight.buildTime) throw new Error("A receipt requires explicit --git-sha, --git-branch and --build-time provenance.");
      const outcome = runPreflight({ ...preflight, requireClean: true });
      if (!outcome.ok || outcome.results.length !== 1) throw new Error("Receipt refused because deployment preflight did not pass.");
      const receipt = createDeploymentReceipt({ ...options, metadata: outcome.results[0].metadata });
      const receiptPath = path.resolve(projectRoot, options.receipt);
      await mkdir(path.dirname(receiptPath), { recursive: true });
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      console.log(`Deployment receipt written to ${receiptPath}`);
    }
  } catch (error) {
    console.error(`Receipt failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
