import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJsoncFile, runPreflight } from "./deployment-preflight.mjs";
import { verifyStagingArtifactManifest } from "./staging-artifact-lib.mjs";
import { captureWorkerMetadata, createActivationD1ReadClient, mutationWranglerEnvironment, runWranglerMetadataRead } from "./service-auth-activate.mjs";
import { assertApprovedPlan, assertReconciliationPlan, createApplyReceipt, createDeploymentPlan, stagingDeploymentWorkers, stagingToolchainDirectory } from "./staging-web-deployment-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "config/deployments.json");
const ledgerPath = path.join(root, "config/staging-d1-migration-ledger.json");

function usage() {
  return `Usage: npm run deploy -- --plan|--apply|--reconcile --environment staging --component ${Object.keys(stagingDeploymentWorkers).join("|")} --artifact-manifest <path> --output <owner-only-json> [--approved-plan <path> --confirmation <deploy:...>]`;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plan" || argument === "--apply" || argument === "--reconcile") {
      if (options.mode) throw new Error("Choose exactly one of --plan or --apply.");
      options.mode = argument.slice(2);
    } else if (argument === "--environment") options.environment = argv[++index];
    else if (argument === "--component") options.component = argv[++index];
    else if (argument === "--artifact-manifest") options.artifactManifest = path.resolve(argv[++index]);
    else if (argument === "--approved-plan") options.approvedPlan = path.resolve(argv[++index]);
    else if (argument === "--confirmation") options.confirmation = argv[++index];
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--bootstrap-secrets-file") options.bootstrapSecretsFile = path.resolve(argv[++index]);
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

export function deploymentWranglerEnvironment({ accountId, baseEnvironment = process.env } = {}) {
  const environment = mutationWranglerEnvironment({ accountId, baseEnvironment });
  for (const name of ["CLOUDFLARE_ACCESS_CLIENT_ID", "CLOUDFLARE_ACCESS_CLIENT_SECRET"]) {
    if (typeof baseEnvironment[name] === "string" && baseEnvironment[name].trim()) environment[name] = baseEnvironment[name];
  }
  return environment;
}

export function assertRouteLessFirstBootstrapConfig(config) {
  if (!config || config.workers_dev !== false || config.preview_urls !== false || Object.hasOwn(config, "route") || Object.hasOwn(config, "routes")) {
    throw new Error("Public-contact first bootstrap requires workers_dev=false, preview_urls=false, and no routes.");
  }
  return true;
}

export function workerNotFoundProviderCode(error, { accountId, worker } = {}) {
  if (typeof accountId !== "string" || typeof worker !== "string") return null;
  const diagnostic = typeof error?.stderr === "string" ? error.stderr : "";
  if (/\b(?:401|403|auth(?:entication|orization)?|permission|timeout|network|econn|enotfound)\b/i.test(diagnostic)) return null;
  const codes = [...diagnostic.matchAll(/\[code:\s*(\d+)\]/ig)].map((match) => Number(match[1]));
  const endpoint = `/accounts/${accountId}/workers/scripts/${worker}/versions`;
  return codes.length === 1 && [10007, 10090].includes(codes[0]) && diagnostic.includes(endpoint) ? codes[0] : null;
}

/** Reads the Worker inventory directly because the redacted metadata helper
 * intentionally discards the provider code that proves first-deploy absence. */
export function observeAbsentPublicContactWorker(registry, metadata, { execFileSyncImpl = execFileSync } = {}) {
  if (metadata?.environment !== "staging" || metadata?.component !== "publicContact" || metadata?.worker !== stagingDeploymentWorkers.publicContact || metadata?.accountId !== registry?.environments?.staging?.accountId) {
    throw new Error("First-bootstrap absence checks support only the reviewed publicContact staging Worker.");
  }
  const executable = path.join(root, stagingToolchainDirectory(registry, metadata.component), "node_modules/.bin/wrangler");
  try {
    execFileSyncImpl(executable, ["versions", "list", "--json", "--config", metadata.config], {
      cwd: root,
      encoding: "utf8",
      env: mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId }),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const absenceCode = workerNotFoundProviderCode(error, metadata);
    if (absenceCode) return { absent: true, absenceCode, versionIds: [], deployment: { versions: [] }, secretNames: [] };
    throw new Error("Public-contact Worker absence was not proven by a known Cloudflare not-found code.");
  }
  return { absent: false };
}

export function snapshotBootstrapSecrets(file, requiredSecretNames, directory) {
  let source;
  try {
    const lexical = lstatSync(file);
    if (!lexical.isFile() || lexical.isSymbolicLink() || (lexical.mode & 0o077) !== 0 || lexical.uid !== process.getuid()) throw new Error();
    source = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(source);
    if (!opened.isFile() || opened.size > 64 * 1024 || opened.uid !== process.getuid() || (opened.mode & 0o077) !== 0) throw new Error();
    const bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(source, bytes, offset, bytes.length - offset, offset); if (!count) throw new Error(); offset += count; }
    const values = JSON.parse(bytes.toString("utf8"));
    if (!values || typeof values !== "object" || Array.isArray(values) || JSON.stringify(Object.keys(values).sort()) !== JSON.stringify([...requiredSecretNames].sort()) || !Object.values(values).every((value) => typeof value === "string" && value.trim())) throw new Error();
    const snapshot = path.join(directory, "bootstrap-secrets.json");
    const destination = openSync(snapshot, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { offset = 0; while (offset < bytes.length) { const count = writeSync(destination, bytes, offset, bytes.length - offset, offset); if (!count) throw new Error(); offset += count; } fsyncSync(destination); } finally { closeSync(destination); }
    chmodSync(snapshot, 0o400);
    return snapshot;
  } catch {
    throw new Error("Bootstrap secrets file must be an owner-only regular JSON file with exactly the required non-empty secret names.");
  } finally { if (source !== undefined) closeSync(source); }
}

export function assertBootstrapSecretsFileOption(options, plan) {
  if (options?.bootstrapSecretsFile && options?.mode !== "apply") throw new Error("--bootstrap-secrets-file is allowed only for an approved first-bootstrap apply.");
  if (options?.mode !== "apply") return true;
  if (plan?.firstBootstrap && !options.bootstrapSecretsFile) throw new Error("Public-contact first bootstrap requires --bootstrap-secrets-file.");
  if (!plan?.firstBootstrap && options?.bootstrapSecretsFile) throw new Error("--bootstrap-secrets-file is allowed only for an approved public-contact first bootstrap.");
  return true;
}

function targetContext(options) {
  if (options.environment !== "staging" || !Object.hasOwn(stagingDeploymentWorkers, options.component)) throw new Error("Controlled deployment requires explicit --environment staging and a reviewed --component.");
  if (!options.artifactManifest || !options.output) throw new Error(usage());
  const registry = readJson(registryPath, "deployment registry");
  const component = registry.environments?.staging?.components?.[options.component];
  const database = registry.environments?.staging?.resources?.d1?.["thot-os-staging"];
  const expectedWorker = stagingDeploymentWorkers[options.component];
  if (!component || component.worker !== expectedWorker || !database) throw new Error("Reviewed staging deployment target is unavailable.");
  const artifactManifest = readJson(options.artifactManifest, "artifact manifest");
  const preflight = runPreflight({ environment: "staging", component: options.component, all: false, requireClean: true, registry: registryPath, gitSha: artifactManifest.source?.gitSha, gitBranch: artifactManifest.source?.gitBranch, buildTime: artifactManifest.build?.timestamp });
  if (!preflight.ok || preflight.results.length !== 1) throw new Error(`Deployment preflight failed: ${preflight.results.flatMap((result) => result.errors).join(" ")}`);
  const lockfilePath = path.join(root, stagingToolchainDirectory(registry, options.component), "package-lock.json");
  verifyStagingArtifactManifest({ artifactDirectory: path.dirname(options.artifactManifest), lockfilePath, manifest: artifactManifest, expectedMetadata: preflight.results[0].metadata });
  const ledger = readJson(ledgerPath, "staging migration ledger");
  const pendingMigrations = ledger.pendingMigrations ?? [];
  if (ledger.environment !== "staging" || ledger.databaseId !== database.id || !ledger.migrations?.length || ledger.migrations.some((entry) => !Number.isInteger(entry.remoteId)) || !Array.isArray(pendingMigrations) || pendingMigrations.length) throw new Error("Staging migration ledger is not a fully applied authoritative ledger.");
  const bootstrapConfig = options.component === "publicContact" ? readJsoncFile(path.join(root, component.config)) : null;
  return {
    registry,
    artifactManifest,
    metadata: { ...preflight.results[0].metadata, accountId: registry.environments.staging.accountId, config: component.config, databaseId: database.id },
    migrationNames: ledger.migrations.map((entry) => entry.name),
    requiredSecretNames: component.requiredSecrets,
    artifactEntrypoint: options.component !== "web" ? (() => {
      const candidates = artifactManifest.artifact.files.filter((entry) => entry.path.endsWith(".js") && !entry.path.endsWith(".js.map"));
      if (candidates.length !== 1) throw new Error("Reviewed Worker artifact must contain exactly one deployable JavaScript entrypoint.");
      return { path: path.join(path.dirname(options.artifactManifest), candidates[0].path), bytes: candidates[0].bytes, sha256: candidates[0].sha256 };
    })() : null,
    d1Target: { accountId: registry.environments.staging.accountId, databaseId: database.id, databaseName: "thot-os-staging" },
    bootstrapConfig,
  };
}

async function observeStaging(context) {
  const migrationNames = await createActivationD1ReadClient().readMigrationHistory(context.d1Target);
  if (JSON.stringify(migrationNames) !== JSON.stringify(context.migrationNames)) throw new Error("Remote staging D1 migration history differs from the authoritative repository ledger.");
  if (context.metadata.component === "publicContact") {
    const absent = observeAbsentPublicContactWorker(context.registry, context.metadata);
    if (absent.absent) return { migrationNames, workerState: { ...absent, routeLessConfig: assertRouteLessFirstBootstrapConfig(context.bootstrapConfig) } };
  }
  let secretInventory;
  try { secretInventory = JSON.parse(runWranglerMetadataRead(["secret", "list", "--format", "json", "--config", context.metadata.config], context.registry)); } catch { throw new Error("Wrangler staging secret-name inventory was not clean JSON."); }
  if (!Array.isArray(secretInventory) || !secretInventory.every((entry) => entry && typeof entry === "object" && /^[A-Z][A-Z0-9_]*$/.test(entry.name))) throw new Error("Wrangler staging secret-name inventory was malformed.");
  const secretNames = secretInventory.map((entry) => entry.name).sort();
  if (new Set(secretNames).size !== secretNames.length) throw new Error("Wrangler staging secret-name inventory contained duplicate names.");
  return { migrationNames, workerState: { ...captureWorkerMetadata(context.registry, context.metadata.component), secretNames } };
}

export function assertDirectWebDeployment(config) {
  const overrides = config?.default?.override;
  if (!overrides || overrides.incrementalCache !== "dummy" || overrides.tagCache !== "dummy" || config.cloudflare?.skewProtection?.enabled) {
    throw new Error("Web cache or skew protection requires the OpenNext deployment preparation step.");
  }
}

async function deployReviewedComponent(registry, metadata, plan, artifactEntrypoint, bootstrapSecretsFile) {
  let sourceDescriptor; let snapshotDescriptor; let snapshotPath; let temporaryDirectory; let commandStarted = false;
  try {
    const directory = path.join(root, registry.environments.staging.components[metadata.component].directory);
    const toolchainDirectory = path.join(root, stagingToolchainDirectory(registry, metadata.component));
    const executable = path.join(toolchainDirectory, "node_modules/.bin/wrangler");
    if (metadata.component === "web") {
      // This app has no cache population or skew mapping to prepare. Deploy the
      // verified OpenNext output directly; don't start a remote preview session.
      const { default: config } = await import(pathToFileURL(path.join(directory, ".open-next/.build/open-next.config.edge.mjs")).href);
      assertDirectWebDeployment(config);
    }
    if (metadata.component !== "web") {
      const lexical = lstatSync(artifactEntrypoint.path); if (!lexical.isFile() || lexical.isSymbolicLink()) throw new Error("reviewed_artifact_replaced");
      sourceDescriptor = openSync(artifactEntrypoint.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const opened = fstatSync(sourceDescriptor);
      if (!opened.isFile() || opened.size !== artifactEntrypoint.bytes || opened.size > 64 * 1024 ** 2) throw new Error("reviewed_artifact_replaced");
      const bytes = Buffer.alloc(opened.size); let offset = 0;
      while (offset < bytes.length) { const count = readSync(sourceDescriptor, bytes, offset, bytes.length - offset, offset); if (!count) throw new Error("reviewed_artifact_replaced"); offset += count; }
      if (createHash("sha256").update(bytes).digest("hex") !== artifactEntrypoint.sha256) throw new Error("reviewed_artifact_replaced");
      closeSync(sourceDescriptor); sourceDescriptor = undefined;
      // Wrangler requires a named entrypoint. Isolate its immutable input from
      // the worktree in a fresh owner-only directory, then verify that snapshot
      // through O_NOFOLLOW immediately before handing the protected path over.
      temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "creatoros-vault-deploy-")); chmodSync(temporaryDirectory, 0o700);
      snapshotPath = path.join(temporaryDirectory, "worker.js"); snapshotDescriptor = openSync(snapshotPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
      offset = 0; while (offset < bytes.length) { const count = writeSync(snapshotDescriptor, bytes, offset, bytes.length - offset, offset); if (!count) throw new Error("reviewed_artifact_snapshot_failed"); offset += count; }
      fsyncSync(snapshotDescriptor); closeSync(snapshotDescriptor); snapshotDescriptor = undefined; chmodSync(snapshotPath, 0o400);
      const snapshotLexical = lstatSync(snapshotPath); if (!snapshotLexical.isFile() || snapshotLexical.isSymbolicLink()) throw new Error("reviewed_artifact_snapshot_failed");
      snapshotDescriptor = openSync(snapshotPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const snapshot = fstatSync(snapshotDescriptor);
      if (!snapshot.isFile() || snapshot.size !== bytes.length) throw new Error("reviewed_artifact_snapshot_failed");
      const snapshotBytes = Buffer.alloc(snapshot.size); offset = 0;
      while (offset < snapshotBytes.length) { const count = readSync(snapshotDescriptor, snapshotBytes, offset, snapshotBytes.length - offset, offset); if (!count) throw new Error("reviewed_artifact_snapshot_failed"); offset += count; }
      if (createHash("sha256").update(snapshotBytes).digest("hex") !== artifactEntrypoint.sha256) throw new Error("reviewed_artifact_snapshot_failed");
      closeSync(snapshotDescriptor); snapshotDescriptor = undefined;
    }
    const bootstrapSecretsSnapshot = plan.firstBootstrap ? snapshotBootstrapSecrets(bootstrapSecretsFile, plan.firstBootstrap.requiredSecretNames, temporaryDirectory) : null;
    const args = metadata.component === "web" ? ["deploy", "--config", path.join(root, metadata.config)] : ["deploy", snapshotPath, "--no-bundle", "--config", path.join(root, metadata.config), "--strict", "--tag", plan.artifact.versionTag, "--message", `Creator OS reviewed artifact ${plan.artifact.sha256}`, ...(bootstrapSecretsSnapshot ? ["--secrets-file", bootstrapSecretsSnapshot] : [])];
    const environment = metadata.component === "web"
      ? deploymentWranglerEnvironment({ accountId: registry.environments.staging.accountId })
      : mutationWranglerEnvironment({ accountId: registry.environments.staging.accountId });
    commandStarted = true;
    execFileSync(executable, args, { cwd: directory, env: { ...environment, CI: "1", ...(metadata.component === "web" ? { OPEN_NEXT_DEPLOY: "true" } : {}) }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return { commandOutcome: "SUCCEEDED" };
  } catch {
    const error = new Error(commandStarted ? "reviewed_deployment_command_failed" : "reviewed_deployment_preflight_failed");
    Object.defineProperty(error, "preMutation", { value: !commandStarted });
    throw error;
  } finally {
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
    if (snapshotDescriptor !== undefined) closeSync(snapshotDescriptor);
    if (temporaryDirectory !== undefined) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function workerStateFromPlanBaseline(plan) {
  return {
    absent: plan?.preDeployment?.workerAbsent === true,
    latestVersionId: plan?.preDeployment?.latestVersionId,
    versionIds: plan?.preDeployment?.versionIds,
    deployment: { versions: plan?.preDeployment?.traffic },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (options.mode !== "apply") assertBootstrapSecretsFileOption(options);
  if (!options.mode) throw new Error("Deployments are disabled by default; choose the controlled --plan or --apply flow. " + usage());
  const context = targetContext(options);
  const before = await observeStaging(context);
  if (options.mode === "plan") {
    const plan = createDeploymentPlan({ ...context, migrationNames: before.migrationNames, workerState: before.workerState });
    writeOwnerOnlyJson(options.output, plan);
    console.log(`Staging/${options.component} deployment plan written to ${options.output}`);
    console.log(`Approval confirmation: ${plan.confirmation}`);
    return;
  }
  if (!options.approvedPlan || !options.confirmation) throw new Error("Apply/reconcile requires --approved-plan and its exact --confirmation value.");
  const plan = readJson(options.approvedPlan, "approved deployment plan");
  assertBootstrapSecretsFileOption(options, plan);
  if (options.mode === "reconcile") {
    assertReconciliationPlan({ plan, confirmation: options.confirmation, metadata: context.metadata, artifactManifest: context.artifactManifest, migrationNames: before.migrationNames, workerState: before.workerState });
    const plannedBefore = workerStateFromPlanBaseline(plan);
    const receipt = createApplyReceipt({ plan, before: plannedBefore, after: before.workerState });
    receipt.commandOutcome = "RECONCILED_AFTER_UNCERTAIN_OUTCOME";
    receipt.outcome = "APPLIED_AND_REMOTE_RECONCILED";
    writeOwnerOnlyJson(options.output, receipt);
    console.log(`Staging ${options.component} deployment reconciled at Worker version ${receipt.deployment.workerVersion}.`);
    console.log(`Owner-only reconciliation receipt written to ${options.output}`);
    return;
  }
  assertApprovedPlan({ plan, confirmation: options.confirmation, metadata: context.metadata, artifactManifest: context.artifactManifest, migrationNames: before.migrationNames, workerState: before.workerState });
  let command;
  try { command = await deployReviewedComponent(context.registry, context.metadata, plan, context.artifactEntrypoint, options.bootstrapSecretsFile); }
  catch (error) {
    if (error?.preMutation) throw error;
    writeOwnerOnlyJson(options.output, { schemaVersion: 1, kind: `staging-${options.component}-deployment-uncertain-outcome`, environment: "staging", component: options.component, observedAt: new Date().toISOString(), planSha256: plan.planSha256, commandOutcome: "NONZERO_OR_TRANSPORT_FAILURE", outcome: "UNKNOWN_REQUIRES_READ_ONLY_RECONCILIATION", previousLatestVersion: before.workerState.latestVersionId, previousTraffic: before.workerState.deployment.versions, diagnosticCategory: "DEPLOYMENT_COMMAND_FAILED" });
    throw new Error("Deployment command failed; do not attribute any subsequently observed Worker version to this artifact. Reconcile before retrying.");
  }
  try {
    const after = captureWorkerMetadata(context.registry, options.component);
    const receipt = createApplyReceipt({ plan, before: before.workerState, after });
    receipt.commandOutcome = command.commandOutcome;
    receipt.outcome = "APPLIED_AND_REMOTE_VERIFIED";
    writeOwnerOnlyJson(options.output, receipt);
    console.log(`Staging ${options.component} deployment remotely verified at Worker version ${receipt.deployment.workerVersion}.`);
    console.log(`Owner-only apply receipt written to ${options.output}`);
  } catch (error) {
    writeOwnerOnlyJson(options.output, { schemaVersion: 1, kind: `staging-${options.component}-deployment-uncertain-outcome`, environment: "staging", component: options.component, observedAt: new Date().toISOString(), planSha256: plan.planSha256, commandOutcome: command.commandOutcome, outcome: "UNKNOWN_REQUIRES_READ_ONLY_RECONCILIATION", previousLatestVersion: before.workerState.latestVersionId, previousTraffic: before.workerState.deployment.versions, diagnosticCategory: "REMOTE_POST_DEPLOYMENT_VERIFICATION_FAILED" });
    throw new Error(`Deployment outcome could not be proven; do not retry. Reconcile Cloudflare version and traffic metadata first. ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(`Controlled deployment failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
