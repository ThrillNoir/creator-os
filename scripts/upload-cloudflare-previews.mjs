import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const arguments_ = process.argv.slice(2);
if (arguments_[0] !== "--environment" || arguments_[1] !== "staging" || !arguments_.includes("--execute")) {
  throw new Error("Refusing remote R2 upload. Use --environment staging --execute only after the deployment preflight and an approved upload runbook.");
}

const creatorId = arguments_.find((argument) => !argument.startsWith("--") && argument !== "staging")?.trim() || "adelaide";
const manifestPath = path.resolve("output/cloudflare", `${creatorId}-previews.json`);
const configPath = path.resolve("cloudflare/thot-os-app/wrangler.jsonc");
const bucket = "thot-os-previews-staging";
const concurrency = 3;
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const npmCache = await mkdtemp(path.join(os.tmpdir(), "thot-os-wrangler-"));

function upload(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", [
      "--yes", "wrangler@4.119.0", "r2", "object", "put", `${bucket}/${entry.key}`,
      "--file", path.resolve(entry.file), "--content-type", entry.contentType,
      "--cache-control", "private, max-age=86400", "--remote", "--config", configPath,
    ], {
      env: { ...process.env, npm_config_cache: npmCache },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `Wrangler exited ${code}`)));
  });
}

let cursor = 0;
let uploaded = 0;
const failures = [];
async function worker() {
  while (cursor < manifest.entries.length) {
    const entry = manifest.entries[cursor++];
    try {
      await upload(entry);
      uploaded += 1;
      if (uploaded % 25 === 0 || uploaded === manifest.entries.length) {
        console.log(JSON.stringify({ uploaded, total: manifest.entries.length }));
      }
    } catch (error) {
      failures.push({ assetId: entry.assetId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
console.log(JSON.stringify({ uploaded, total: manifest.entries.length, failed: failures.length }));
if (failures.length) {
  console.error(JSON.stringify(failures));
  process.exitCode = 1;
}
