import { parsePreflightArguments, runPreflight } from "./deployment-preflight.mjs";

function usage() {
  return "Deployments are intentionally disabled by default. Use --plan with an explicit --environment and --component to validate a target. A remote deploy requires a separately approved runbook; Phase 1A does not automate deployment.";
}

try {
  const args = process.argv.slice(2);
  if (!args.includes("--plan")) throw new Error(usage());
  const options = parsePreflightArguments(args.filter((argument) => argument !== "--plan"));
  const outcome = runPreflight({ ...options, requireClean: true });
  if (!outcome.ok) {
    for (const error of outcome.errors) console.error(`Deploy plan failed: ${error}`);
    for (const result of outcome.results) for (const error of result.errors) console.error(`Deploy plan failed: ${error}`);
    process.exitCode = 1;
  } else {
    for (const result of outcome.results) console.log(`Deployment plan is safe but not executed: ${result.metadata.environment}/${result.metadata.component} → ${result.metadata.worker}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
