import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertUnauthenticatedHealthDenied, healthSummary, validateAuthenticatedHealth } from "./health-contract.mjs";

const defaultHealthUrl = "https://thot-os-staging.thot-os.workers.dev/health";

function parseArguments(argv) {
  const options = { url: defaultHealthUrl };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--url") options.url = argv[++index];
    else if (argument === "--artifact-manifest") options.artifactManifest = argv[++index];
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return "Usage: node scripts/check-authenticated-health.mjs --artifact-manifest <.open-next/staging-artifact-manifest.json> [--url <https-url>]";
}

function authenticatedHeaders() {
  const accessToken = process.env.THOT_OS_ACCESS_TOKEN?.trim();
  const accessCookie = process.env.THOT_OS_ACCESS_COOKIE?.trim();
  if (!accessToken && !accessCookie) throw new Error("Set THOT_OS_ACCESS_TOKEN or THOT_OS_ACCESS_COOKIE to an authenticated Cloudflare Access session. The credential is never printed.");
  const headers = new Headers({ accept: "application/json" });
  if (accessToken) headers.set("cf-access-token", accessToken);
  if (accessCookie) headers.set("cookie", `CF_Authorization=${accessCookie}`);
  return headers;
}

async function readArtifactManifest(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) { throw new Error(`Unable to read artifact manifest: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (!options.artifactManifest) throw new Error(usage());
  const url = new URL(options.url);
  if (url.protocol !== "https:") throw new Error("Authenticated staging health checks require an HTTPS URL.");
  const manifest = await readArtifactManifest(path.resolve(options.artifactManifest));
  const expected = { component: manifest.component, environment: manifest.environment, gitSha: manifest.source?.gitSha, gitBranch: manifest.source?.gitBranch, buildTime: manifest.build?.timestamp };

  const anonymous = await fetch(url, { headers: { accept: "application/json" }, redirect: "manual" });
  assertUnauthenticatedHealthDenied(anonymous.status);

  const response = await fetch(url, { headers: authenticatedHeaders(), redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Authenticated health check did not return JSON.");
  const result = await response.json();
  validateAuthenticatedHealth({ status: response.status, result, expected });
  console.log(JSON.stringify(healthSummary(result)));
}

main().catch((error) => {
  console.error(`Authenticated health check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
