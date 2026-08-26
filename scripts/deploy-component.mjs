import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPreflight } from "./deployment-preflight.mjs";
import { verifyStagingArtifactManifest } from "./staging-artifact-lib.mjs";
import { captureWorkerMetadata, createActivationD1ReadClient, mutationWranglerEnvironment, runWranglerMetadataRead } from "./service-auth-activate.mjs";
import { assertApprovedPlan, createApplyReceipt, createDeploymentPlan } from "./staging-web-deployment-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "config/deployments.json");
const ledgerPath = path.join(root, "config/staging-d1-migration-ledger.json");
const webDirectory = path.join(root, "cloudflare/thot-os-next");
const lockfilePath = path.join(webDirectory, "package-lock.json");
const openNextBinary = path.join(webDirectory, "node_modules/.bin/opennextjs-cloudflare");

function usage() {
  return "Usage: npm run deploy -- --plan|--apply --environment staging --component web --artifact-manifest <path> --output <owner-only-json> [--approved-plan <path> --confirmation <deploy:...>]";
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plan" || argument === "--apply") {
      if (options.mode) throw new Error("Choose exactly one of --plan or --apply.");
      options.mode = argument.slice(2);
    } else if (argument === "--environment") options.environment = argv[++index];
    else if (argument === "--component") options.component = argv[++index];
    else if (argument === "--artifact-manifest") options.artifactManifest = path.resolve(argv[++index]);
    else if (argument === "--approved-plan") options.approvedPlan = path.resolve(argv[++index]);
    else if (argument === "--confirmation") options.confirmation = argv[++index];
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

function writeOwnerOnlyJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

function targetContext(options) {
  if (options.environment !== "staging" || options.component !== "web") throw new Error("Controlled deployment requires explicit --environment staging --component web.");
  if (!options.artifactManifest || !options.output) throw new Error(usage());
  const registry = readJson(registryPath, "deployment registry");
  const component = registry.environments?.staging?.components?.web;
  const database = registry.environments?.staging?.resources?.d1?.["thot-os-staging"];
  if (!component || component.worker !== "thot-os-staging" || !database) throw new Error("Reviewed staging deployment target is unavailable.");
  const artifactManifest = readJson(options.artifactManifest, "artifact manifest");
  const preflight = runPreflight({ environment: "staging", component: "web", all: false, requireClean: true, registry: registryPath, gitSha: artifactManifest.source?.gitSha, gitBranch: artifactManifest.source?.gitBranch, buildTime: artifactManifest.build?.timestamp });
  if (!preflight.ok || preflight.results.length !== 1) throw new Error(`Deployment preflight failed: ${preflight.results.flatMap((result) => result.errors).join(" ")}`);
  verifyStagingArtifactManifest({ artifactDirectory: path.dirname(options.artifactManifest), lockfilePath, manifest: artifactManifest, expectedMetadata: preflight.results[0].metadata });
  const ledger = readJson(ledgerPath, "staging migration ledger");
  if (ledger.environment !== "staging" || ledger.databaseId !== database.id || !ledger.migrations?.length || ledger.migrations.some((entry) => !Number.isInteger(entry.remoteId))) throw new Error("Staging migration ledger is not a fully applied authoritative ledger.");
  return {
    registry,
    artifactManifest,
    metadata: { ...preflight.results[0].metadata, accountId: registry.environments.staging.accountId, config: component.config, databaseId: database.id },
    migrationNames: ledger.migrations.map((entry) => entry.name),
    requiredSecretNames: component.requiredSecrets,
    d1Target: { accountId: registry.environments.staging.accountId, databaseId: database.id, databaseName: "thot-os-staging" },
  };
}

async function observeStaging(context) {
  const migrationNames = await createActivationD1ReadClient().readMigrationHistory(context.d1Target);
  if (JSON.stringify(migrationNames) !== JSON.stringify(context.migrationNames)) throw new Error("Remote staging D1 migration history differs from the authoritative repository ledger.");
  let secretInventory;
  try { secretInventory = JSON.parse(runWranglerMetadataRead(["secret", "list", "--format", "json", "--config", context.metadata.config], context.registry)); } catch { throw new Error("Wrangler staging secret-name inventory was not clean JSON."); }
  if (!Array.isArray(secretInventory) || !secretInventory.every((entry) => entry && typeof entry === "object" && /^[A-Z][A-Z0-9_]*$/.test(entry.name))) throw new Error("Wrangler staging secret-name inventory was malformed.");
  const secretNames = secretInventory.map((entry) => entry.name).sort();
  if (new Set(secretNames).size !== secretNames.length) throw new Error("Wrangler staging secret-name inventory contained duplicate names.");
  return { migrationNames, workerState: { ...captureWorkerMetadata(context.registry), secretNames } };
}

function deployOpenNext(registry, config) {
  try {
    execFileSync(openNextBinary, ["deploy", "--config", path.join(root, config)], { cwd: webDirectory, env: { ...mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId }), CI: "1" }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return { commandOutcome: "SUCCEEDED" };
  } catch {
    return { commandOutcome: "NONZERO_OR_TRANSPORT_FAILURE" };
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (!options.mode) throw new Error("Deployments are disabled by default; choose the controlled --plan or --apply flow. " + usage());
  const context = targetContext(options);
  const before = await observeStaging(context);
  if (options.mode === "plan") {
    const plan = createDeploymentPlan({ ...context, migrationNames: before.migrationNames, workerState: before.workerState });
    writeOwnerOnlyJson(options.output, plan);
    console.log(`Staging/web deployment plan written to ${options.output}`);
    console.log(`Approval confirmation: ${plan.confirmation}`);
    return;
  }
  if (!options.approvedPlan || !options.confirmation) throw new Error("Apply requires --approved-plan and its exact --confirmation value.");
  const plan = readJson(options.approvedPlan, "approved deployment plan");
  assertApprovedPlan({ plan, confirmation: options.confirmation, metadata: context.metadata, artifactManifest: context.artifactManifest, migrationNames: before.migrationNames, workerState: before.workerState });
  const command = deployOpenNext(context.registry, context.metadata.config);
  try {
    const after = captureWorkerMetadata(context.registry);
    const receipt = createApplyReceipt({ plan, before: before.workerState, after });
    receipt.commandOutcome = command.commandOutcome;
    receipt.outcome = "APPLIED_AND_REMOTE_VERIFIED";
    writeOwnerOnlyJson(options.output, receipt);
    console.log(`Staging web deployment remotely verified at Worker version ${receipt.deployment.workerVersion}.`);
    console.log(`Owner-only apply receipt written to ${options.output}`);
  } catch (error) {
    writeOwnerOnlyJson(options.output, { schemaVersion: 1, kind: "staging-web-deployment-uncertain-outcome", environment: "staging", component: "web", observedAt: new Date().toISOString(), planSha256: plan.planSha256, commandOutcome: command.commandOutcome, outcome: "UNKNOWN_REQUIRES_READ_ONLY_RECONCILIATION", previousLatestVersion: before.workerState.latestVersionId, previousTraffic: before.workerState.deployment.versions, diagnosticCategory: "REMOTE_POST_DEPLOYMENT_VERIFICATION_FAILED" });
    throw new Error(`Deployment outcome could not be proven; do not retry. Reconcile Cloudflare version and traffic metadata first. ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(`Controlled deployment failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
