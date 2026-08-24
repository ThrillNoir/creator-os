import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPinnedWorkerRuntime, validateWorkerCompatibility } from "./cloudflare-runtime-compatibility.mjs";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sorted(values) {
  return [...values].sort();
}

function listsMatch(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

export function stripJsonComments(source) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

export function readJsoncFile(filePath) {
  return JSON.parse(stripJsonComments(readFileSync(filePath, "utf8")));
}

export function readDeploymentRegistry(registryPath = path.join(projectRoot, "config/deployments.json")) {
  return JSON.parse(readFileSync(registryPath, "utf8"));
}

function configResources(config) {
  const d1 = config.d1_databases ?? [];
  const r2 = config.r2_buckets ?? [];
  const analytics = config.analytics_engine_datasets ?? [];
  const kv = config.kv_namespaces ?? [];
  const queueProducers = config.queues?.producers ?? [];
  const services = config.services ?? [];
  return {
    d1: d1.map((binding) => ({ name: binding.database_name, id: binding.database_id, migrationsDir: binding.migrations_dir })),
    r2: r2.map((binding) => binding.bucket_name),
    images: config.images?.binding ? [config.images.binding] : [],
    analytics: analytics.map((binding) => binding.dataset),
    kv: kv.map((binding) => binding.id),
    queues: [
      ...queueProducers.map((binding) => binding.queue),
      ...(config.queues?.consumers ?? []).map((binding) => binding.queue),
      ...(config.queues?.consumers ?? []).map((binding) => binding.dead_letter_queue).filter(Boolean),
    ],
    services: Object.fromEntries(services.map((binding) => [binding.binding, binding.service])),
    secrets: config.secrets?.required ?? [],
    bindingNames: {
      d1: d1.map((binding) => binding.binding),
      r2: r2.map((binding) => binding.binding),
      assets: config.assets?.binding ? [config.assets.binding] : [],
      images: config.images?.binding ? [config.images.binding] : [],
      analytics: analytics.map((binding) => binding.binding),
      kv: kv.map((binding) => binding.binding),
      queues: queueProducers.map((binding) => binding.binding),
      services: services.map((binding) => binding.binding),
    },
  };
}

function resourceNames(environment) {
  return {
    d1: new Set(Object.keys(environment.resources?.d1 ?? {})),
    r2: new Set(environment.resources?.r2 ?? []),
    analytics: new Set(environment.resources?.analytics ?? []),
    kv: new Set(environment.resources?.kv ?? []),
    queues: new Set(environment.resources?.queues ?? []),
    workers: new Set(Object.values(environment.resources?.workers ?? {})),
  };
}

function addExactListError(errors, label, actual, expected) {
  if (!listsMatch(actual, expected)) {
    errors.push(`${label} mismatch: expected [${sorted(expected).join(", ")}], found [${sorted(actual).join(", ")}].`);
  }
}

const publicationModes = new Set(["disabled", "synthetic-only", "enabled"]);
const creatorIdPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

function validPublicationPolicy(policy) {
  return policy
    && publicationModes.has(policy.mode)
    && Array.isArray(policy.syntheticCreatorIds)
    && policy.syntheticCreatorIds.every((creatorId) => typeof creatorId === "string" && creatorIdPattern.test(creatorId));
}

function validatePublicationPolicyConfig(errors, componentName, component, config) {
  if (componentName !== "publicLinksControl") return;
  const policy = component.publicationPolicy;
  if (!policy || !validPublicationPolicy(policy.publicProfile) || !validPublicationPolicy(policy.adultProfile)) {
    errors.push("publicLinksControl requires valid publicProfile and adultProfile publication policies.");
    return;
  }
  const vars = config.vars ?? {};
  const expected = {
    PUBLIC_PROFILE_PUBLICATION_MODE: policy.publicProfile.mode,
    PUBLIC_PROFILE_SYNTHETIC_CREATOR_IDS: policy.publicProfile.syntheticCreatorIds.join(","),
    ADULT_PROFILE_PUBLICATION_MODE: policy.adultProfile.mode,
    ADULT_PROFILE_SYNTHETIC_CREATOR_IDS: policy.adultProfile.syntheticCreatorIds.join(","),
  };
  for (const [name, value] of Object.entries(expected)) {
    if (vars[name] !== value) errors.push(`Publication policy var ${name} does not match the ${componentName} registry policy.`);
  }
  if (policy.publicProfile.mode === "synthetic-only" && policy.publicProfile.syntheticCreatorIds.length === 0) {
    errors.push("Synthetic-only public profile publication requires at least one configured synthetic creator ID.");
  }
  if (policy.adultProfile.mode !== "disabled") {
    if (component.protectedAdultRelease !== true) errors.push("Adult publication requires an explicitly approved protected-service configuration.");
    const requiredVars = {
      ADULT_MEDIA_DELIVERY_ENABLED: "1",
      ADULT_GATEWAY_BASE_URL: "https://more-staging.thathuboverthere.com",
      SAFE_PUBLIC_PROFILE_BASE_URL: "https://public-profile-staging.thathuboverthere.com",
    };
    for (const [name, value] of Object.entries(requiredVars)) {
      if (vars[name] !== value) errors.push(`Protected adult release requires ${name}=${value}.`);
    }
    if (!(config.kv_namespaces ?? []).some((binding) => binding.binding === "ADULT_PROFILES")) errors.push("Protected adult release requires the isolated ADULT_PROFILES KV binding.");
    if (!(config.r2_buckets ?? []).some((binding) => binding.binding === "ADULT_MEDIA" && binding.bucket_name === "thot-os-adult-media-staging")) errors.push("Protected adult release requires the isolated ADULT_MEDIA bucket.");
    const workflows = config.workflows ?? [];
    if (!workflows.some((workflow) => workflow.binding === "ADULT_PROFILE_PUBLISH" && workflow.class_name === "AdultProfilePublishWorkflow")
      || !workflows.some((workflow) => workflow.binding === "ADULT_PROFILE_WITHDRAW" && workflow.class_name === "AdultProfileWithdrawWorkflow")) {
      errors.push("Protected adult release requires publish and withdrawal Workflows.");
    }
  }
}

function currentGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function currentGitBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd: projectRoot, encoding: "utf8" }).trim() || "detached";
  } catch {
    return "unknown";
  }
}

function workingTreeClean() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" }).trim().length === 0;
  } catch {
    return false;
  }
}

export function validateRegistry(registry) {
  const errors = [];
  if (registry.schemaVersion !== 1) errors.push("Unsupported or missing deployment registry schemaVersion.");
  for (const [environmentName, environment] of Object.entries(registry.environments ?? {})) {
    if (!environment.resources) errors.push(`${environmentName} has no resource inventory.`);
    if (environment.kind === "cloudflare" && environment.provisioned && environment.deployable && !environment.accountId) {
      errors.push(`${environmentName} is deployable but has no Cloudflare account identifier.`);
    }
    const owners = new Map();
    for (const [componentName, component] of Object.entries(environment.components ?? {})) {
      if (!component.worker) {
        errors.push(`${environmentName}/${componentName} has no Worker name.`);
        continue;
      }
      if (!component.config) errors.push(`${environmentName}/${componentName} has no Wrangler configuration path.`);
      if (typeof component.deployable !== "boolean") errors.push(`${environmentName}/${componentName} has no deployable state.`);
      if (!component.resources) errors.push(`${environmentName}/${componentName} has no resource ownership declaration.`);
      if (component.bindings !== undefined && (typeof component.bindings !== "object" || Array.isArray(component.bindings))) errors.push(`${environmentName}/${componentName} binding contract must be an object when declared.`);
      if (!Array.isArray(component.requiredSecrets)) errors.push(`${environmentName}/${componentName} has no required secret-name declaration.`);
      if (componentName === "publicLinksControl" && (!component.publicationPolicy || !validPublicationPolicy(component.publicationPolicy.publicProfile) || !validPublicationPolicy(component.publicationPolicy.adultProfile))) {
        errors.push(`${environmentName}/${componentName} has no valid publication policy declaration.`);
      }
      const existing = owners.get(component.worker);
      if (existing) errors.push(`Duplicate Worker ownership in ${environmentName}: ${existing} and ${componentName} both own ${component.worker}.`);
      owners.set(component.worker, componentName);
    }
    for (const [componentName, worker] of Object.entries(environment.resources?.workers ?? {})) {
      const component = environment.components?.[componentName];
      if (component && component.worker !== worker) errors.push(`${environmentName}/${componentName} Worker registry does not match resources.workers.`);
    }
  }
  return errors;
}

export function validatePreflightRequest(options) {
  const errors = [];
  if (!options.environment) errors.push("An explicit --environment is required.");
  if (!options.component && !options.all) errors.push("An explicit --component or --all is required.");
  if (options.component && options.all) errors.push("Use either --component or --all, not both.");
  return errors;
}

export function buildDeploymentMetadata({ environment, componentName, component, gitSha = currentGitSha(), gitBranch = currentGitBranch(), buildTime = new Date().toISOString() }) {
  return {
    service: component.service,
    environment,
    component: componentName,
    worker: component.worker,
    gitSha,
    gitBranch,
    buildTime,
  };
}

export function validateDeployment({ registry, environmentName, componentName, config, requireClean = false, gitSha, gitBranch, buildTime }) {
  const errors = [...validateRegistry(registry)];
  const environment = registry.environments?.[environmentName];
  if (!environment) return { ok: false, errors: [...errors, `Unknown environment: ${environmentName}.`] };
  const component = environment.components?.[componentName];
  if (!component) return { ok: false, errors: [...errors, `Unknown component ${componentName} for ${environmentName}.`] };
  if (!environment.provisioned || !environment.deployable) errors.push(`${environmentName} is not a provisioned deployable environment.`);
  if (!component.deployable) errors.push(`${environmentName}/${componentName} is disabled: ${component.retirement ?? "no deployment authority"}`);
  if (requireClean && !workingTreeClean()) errors.push("Deployment requires a clean Git working tree.");

  if (config) {
    const resources = configResources(config);
    if (config.name !== component.worker) errors.push(`Worker name mismatch: registry owns ${component.worker}, config declares ${config.name ?? "nothing"}.`);
    if (environment.accountId && config.account_id !== environment.accountId) errors.push(`Account mismatch for ${environmentName}/${componentName}.`);
    addExactListError(errors, "D1 bindings", resources.d1.map((binding) => binding.name), component.resources?.d1 ?? []);
    addExactListError(errors, "R2 bindings", resources.r2, component.resources?.r2 ?? []);
    addExactListError(errors, "Images bindings", resources.images, component.resources?.images ?? []);
    addExactListError(errors, "Queue bindings", [...new Set(resources.queues)], component.resources?.queues ?? []);
    addExactListError(errors, "KV namespace bindings", resources.kv, component.resources?.kv ?? []);
    const expectedServices = component.resources?.services ?? {};
    if (JSON.stringify(resources.services) !== JSON.stringify(expectedServices)) errors.push(`Service bindings mismatch for ${environmentName}/${componentName}.`);
    addExactListError(errors, "Required secret names", resources.secrets, component.requiredSecrets ?? []);
    for (const [resourceType, expectedBindings] of Object.entries(component.bindings ?? {})) {
      if (!Array.isArray(expectedBindings)) {
        errors.push(`${environmentName}/${componentName} binding contract ${resourceType} must be an array.`);
        continue;
      }
      const actualBindings = resources.bindingNames[resourceType];
      if (!actualBindings) {
        errors.push(`${environmentName}/${componentName} binding contract has unsupported resource type ${resourceType}.`);
        continue;
      }
      addExactListError(errors, `${resourceType} logical bindings`, actualBindings, expectedBindings);
    }
    validatePublicationPolicyConfig(errors, componentName, component, config);

    const d1Registry = environment.resources?.d1 ?? {};
    for (const binding of resources.d1) {
      const expected = d1Registry[binding.name];
      if (!expected) errors.push(`D1 binding ${binding.name} is not owned by ${environmentName}.`);
      else {
        if (expected.id && binding.id !== expected.id) errors.push(`D1 ID mismatch for ${binding.name}.`);
        if (expected.migrationsDir && binding.migrationsDir !== expected.migrationsDir) errors.push(`D1 migration directory mismatch for ${binding.name}.`);
      }
    }

    const currentResources = resourceNames(environment);
    const allOtherResources = Object.entries(registry.environments ?? {})
      .filter(([name]) => name !== environmentName)
      .map(([, otherEnvironment]) => resourceNames(otherEnvironment));
    const checks = [
      ["D1", resources.d1.map((binding) => binding.name), currentResources.d1],
      ["R2", resources.r2, currentResources.r2],
      ["Analytics Engine", resources.analytics, currentResources.analytics],
      ["KV namespace", resources.kv, currentResources.kv],
      ["Queue", resources.queues, currentResources.queues],
      ["service Worker", Object.values(resources.services), currentResources.workers],
    ];
    for (const [label, values, ownedValues] of checks) {
      for (const value of values) {
        if (!ownedValues.has(value)) errors.push(`${label} ${value} is not owned by ${environmentName}.`);
        for (const otherResources of allOtherResources) {
          if (otherResources.d1.has(value) || otherResources.r2.has(value) || otherResources.kv.has(value) || otherResources.queues.has(value) || otherResources.workers.has(value)) {
            errors.push(`Cross-environment binding: ${environmentName}/${componentName} references ${value}.`);
          }
        }
      }
    }
  } else {
    errors.push(`Missing Wrangler configuration for ${environmentName}/${componentName}.`);
  }

  const metadata = buildDeploymentMetadata({ environment: environmentName, componentName, component, gitSha, gitBranch, buildTime });
  return { ok: errors.length === 0, errors, metadata };
}

export function parsePreflightArguments(argv) {
  const options = { all: false, requireClean: false, json: false, registry: path.join(projectRoot, "config/deployments.json") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--environment") options.environment = argv[++index];
    else if (argument === "--component") options.component = argv[++index];
    else if (argument === "--all") options.all = true;
    else if (argument === "--require-clean") options.requireClean = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--registry") options.registry = path.resolve(argv[++index]);
    else if (argument === "--git-sha") options.gitSha = argv[++index];
    else if (argument === "--git-branch") options.gitBranch = argv[++index];
    else if (argument === "--build-time") options.buildTime = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return "Usage: node scripts/deployment-preflight.mjs --environment <staging> (--component <name> | --all) [--require-clean] [--json]";
}

export function runPreflight(options) {
  const requestErrors = validatePreflightRequest(options);
  if (requestErrors.length) return { ok: false, errors: requestErrors, results: [] };
  const registry = readDeploymentRegistry(options.registry);
  const environment = registry.environments?.[options.environment];
  if (!environment) return { ok: false, errors: [`Unknown environment: ${options.environment}.`], results: [] };
  const componentNames = options.all
    ? Object.entries(environment.components ?? {}).filter(([, component]) => component.deployable).map(([name]) => name)
    : [options.component];
  if (!componentNames.length) return { ok: false, errors: [`No deployable components are registered for ${options.environment}.`], results: [] };
  let pinnedRuntime;
  let runtimeError;
  try {
    pinnedRuntime = readPinnedWorkerRuntime(path.join(projectRoot, "cloudflare/thot-os-next"));
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error);
  }
  const results = componentNames.map((componentName) => {
    const component = environment.components?.[componentName];
    const configPath = component?.config ? path.join(projectRoot, component.config) : null;
    let config;
    let readError;
    try {
      config = configPath ? readJsoncFile(configPath) : null;
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    const result = validateDeployment({ registry, environmentName: options.environment, componentName, config, requireClean: options.requireClean, gitSha: options.gitSha, gitBranch: options.gitBranch, buildTime: options.buildTime });
    if (readError) result.errors.push(`Unable to read ${component?.config ?? "configuration"}: ${readError}`);
    if (runtimeError) result.errors.push(`Pinned workerd compatibility check failed: ${runtimeError}`);
    else if (config) {
      const compatibility = validateWorkerCompatibility({ components: [{ label: `${options.environment}/${componentName}`, configPath: component?.config, config }], runtime: pinnedRuntime });
      result.compatibility = compatibility;
      result.errors.push(...compatibility.errors);
    }
    result.ok = result.errors.length === 0;
    return result;
  });
  return { ok: results.every((result) => result.ok), errors: [], results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parsePreflightArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      const outcome = runPreflight(options);
      if (options.json) console.log(JSON.stringify(outcome, null, 2));
      else {
        for (const error of outcome.errors) console.error(`Preflight failed: ${error}`);
        for (const result of outcome.results) {
          if (result.ok) console.log(`Preflight passed: ${result.metadata.environment}/${result.metadata.component} → ${result.metadata.worker} at ${result.metadata.gitSha}`);
          else for (const error of result.errors) console.error(`Preflight failed: ${result.metadata?.environment ?? options.environment}/${result.metadata?.component ?? options.component}: ${error}`);
        }
      }
      if (!outcome.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
