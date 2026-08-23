import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPreflight } from "./deployment-preflight.mjs";
import { registryHasProductionOperationalSurface } from "./service-auth-activation-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultContract = path.join(projectRoot, "config/service-principals.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

export function parseServicePrincipalPlanArguments(argv) {
  const options = { grants: [], contract: defaultContract, registry: path.join(projectRoot, "config/deployments.json"), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--environment") options.environment = argv[++index];
    else if (argument === "--grant") options.grants.push(argv[++index]);
    else if (argument === "--contract") options.contract = path.resolve(argv[++index]);
    else if (argument === "--registry") options.registry = path.resolve(argv[++index]);
    else if (argument === "--json") options.json = true;
    else if (argument === "--apply") throw new Error("Service-principal provisioning is plan-only. Remote writes require an approved operator runbook.");
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export function parseGrant(value, principals) {
  const [principalName, creatorId, capability, ...extra] = String(value ?? "").split(":");
  if (extra.length || !principalName || !creatorId || !capability) throw new Error("A grant must be principal:creator:capability.");
  assertIdentifier(creatorId, "Grant creator");
  const principal = principals.find((entry) => entry.principalName === principalName);
  if (!principal) throw new Error(`Unknown service principal: ${principalName}.`);
  if (!principal.capabilities.includes(capability)) throw new Error(`Capability ${capability} is not allowed for ${principalName}.`);
  return { principalName, creatorId, capability };
}

export function validateContract(contract) {
  if (contract?.schemaVersion !== 1 || !Array.isArray(contract.principals) || !contract.principals.length) throw new Error("Unsupported service-principal contract.");
  const ids = new Set();
  const names = new Set();
  const secrets = new Set();
  for (const principal of contract.principals) {
    if (!principal?.id || !principal?.principalName || !principal?.secretName || !Array.isArray(principal.capabilities) || !principal.capabilities.length) throw new Error("Each service principal requires an id, name, secret name, and capabilities.");
    if (ids.has(principal.id) || names.has(principal.principalName) || secrets.has(principal.secretName)) throw new Error("Service principal ids, names, and secret names must be unique.");
    ids.add(principal.id);
    names.add(principal.principalName);
    secrets.add(principal.secretName);
  }
}

export function buildServicePrincipalPlan({ environment, contract, registry, grants = [] }) {
  validateContract(contract);
  if (environment !== "staging" || contract.environment !== "staging") throw new Error("Service-principal planning is restricted to the explicit staging contract.");
  const staging = registry?.environments?.staging;
  if (!staging?.provisioned || !staging?.deployable || registryHasProductionOperationalSurface(registry)) throw new Error("Staging must be the only provisioned operational target for this plan; an isolated production public-links foundation is permitted.");
  const web = staging.components?.web;
  if (!web || !Array.isArray(web.requiredSecrets)) throw new Error("Canonical web deployment metadata is missing.");
  const expectedSecrets = contract.principals.map((principal) => principal.secretName).sort();
  const actualSecrets = [...web.requiredSecrets].sort();
  if (JSON.stringify(expectedSecrets) !== JSON.stringify(actualSecrets)) throw new Error("Canonical web secret contract does not match the service-principal contract.");
  const normalizedGrants = grants.map((grant) => parseGrant(grant, contract.principals));
  const distinctGrantKeys = new Set(normalizedGrants.map((grant) => `${grant.principalName}:${grant.creatorId}:${grant.capability}`));
  if (distinctGrantKeys.size !== normalizedGrants.length) throw new Error("Duplicate service-principal grant requested.");
  return {
    schemaVersion: 1,
    mode: "plan-only",
    environment,
    principalCount: contract.principals.length,
    principals: contract.principals.map(({ id, principalName, secretName, receiver, capabilities }) => ({ id, principalName, secretName, receiver, capabilities })),
    grants: normalizedGrants,
    requiredRemoteGates: [
      "Verify the staging D1 identity and take a fresh recoverable backup/export.",
      "Apply reviewed EXPAND migrations 0028, 0029, 0030, and 0031, stop and verify the unchanged legacy trigger, then apply separately approved COMPATIBILITY migration 0032 before activation; do not remove the legacy branch.",
      "Generate one high-entropy credential per principal outside source control; do not print, commit, or place it in this plan.",
      "Store each raw credential only as its named canonical-web Cloudflare secret and store only its SHA-256 hash in service_principal_credentials.",
      "Create only the explicitly listed creator/capability grants and append lifecycle audit receipts.",
      "Deploy the compatible web and receiver Workers as one controlled release, then test granted, missing-capability, foreign-creator, and revoked-credential cases.",
    ],
    prohibited: ["remote write", "secret generation", "secret output", "credential hashing", "credential rotation", "grant creation", "deployment"],
  };
}

function usage() {
  return "Usage: node scripts/service-principal-plan.mjs --environment staging [--grant <principal:creator:capability>] [--json]. This command is plan-only and never creates secrets or remote records.";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseServicePrincipalPlanArguments(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      if (!options.environment) throw new Error("An explicit --environment is required.");
      const preflight = runPreflight({ environment: options.environment, component: "web", all: false, requireClean: false, registry: options.registry });
      if (!preflight.ok) throw new Error(`Deployment preflight failed: ${preflight.results.flatMap((result) => result.errors).join(" ")}`);
      const plan = buildServicePrincipalPlan({ environment: options.environment, contract: readJson(options.contract), registry: readJson(options.registry), grants: options.grants });
      if (options.json) console.log(JSON.stringify(plan, null, 2));
      else {
        console.log(`Service-principal plan is safe but not executed: ${plan.principalCount} principals, ${plan.grants.length} explicit grants.`);
        for (const gate of plan.requiredRemoteGates) console.log(`Gate: ${gate}`);
      }
    }
  } catch (error) {
    console.error(`Service-principal plan failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
