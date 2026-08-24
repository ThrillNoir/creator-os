import path from "node:path";
import { parsePreflightArguments, projectRoot, readDeploymentRegistry, readJsoncFile } from "./deployment-preflight.mjs";
import { readPinnedWorkerRuntime, validateWorkerCompatibility } from "./cloudflare-runtime-compatibility.mjs";

function usage() {
  return "Usage: node scripts/check-cloudflare-compatibility.mjs --environment <staging> (--component <name> | --all) [--json]";
}

export function runCompatibilityPreflight(options) {
  const registry = readDeploymentRegistry(options.registry);
  const environment = registry.environments?.[options.environment];
  if (!environment) return { ok: false, errors: [`Unknown environment: ${options.environment}.`], results: [] };
  const componentNames = options.all
    ? Object.entries(environment.components ?? {}).filter(([, component]) => component.deployable).map(([name]) => name)
    : [options.component];
  if (!componentNames.length || componentNames.some((name) => !name)) return { ok: false, errors: ["An explicit --component or --all is required."], results: [] };

  const components = [];
  const errors = [];
  for (const componentName of componentNames) {
    const component = environment.components?.[componentName];
    if (!component?.config) {
      errors.push(`Unknown component ${componentName} for ${options.environment}.`);
      continue;
    }
    const configPath = path.join(projectRoot, component.config);
    try {
      components.push({ label: `${options.environment}/${componentName}`, configPath: component.config, config: readJsoncFile(configPath) });
    } catch (error) {
      errors.push(`Unable to read ${component.config}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) return { ok: false, errors, results: [] };

  try {
    const runtime = readPinnedWorkerRuntime(path.join(projectRoot, "cloudflare/thot-os-next"));
    const outcome = validateWorkerCompatibility({ components, runtime });
    return { ...outcome, errors: [...errors, ...outcome.errors] };
  } catch (error) {
    return { ok: false, errors: [...errors, error instanceof Error ? error.message : String(error)], results: [] };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parsePreflightArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      const outcome = runCompatibilityPreflight(options);
      if (options.json) console.log(JSON.stringify(outcome, null, 2));
      else if (outcome.ok) {
        console.log(`Compatibility preflight passed: Wrangler ${outcome.runtime.wranglerVersion}, workerd ${outcome.runtime.workerdVersion} supports through ${outcome.runtime.maximumCompatibilityDate}.`);
        for (const result of outcome.results) console.log(`Compatibility preflight passed: ${result.label} (${result.compatibilityDate}).`);
      } else {
        for (const error of outcome.errors) console.error(`Compatibility preflight failed: ${error}`);
      }
      if (!outcome.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Compatibility preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
