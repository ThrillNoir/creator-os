import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseThumbnailRunnerArgs, runThumbnailMindCommand } from "./video-thumbnail-mind-runner.mjs";

const ACCOUNT = "thot-os-thumbnail-runner";
const ITEMS = Object.freeze({
  THOT_THUMBNAIL_SOURCE_R2_KEY_ID: "thot-os-thumbnail-source-r2-key-id",
  THOT_THUMBNAIL_SOURCE_R2_SECRET: "thot-os-thumbnail-source-r2-secret",
  THOT_THUMBNAIL_SERVICE_TOKEN: "thot-os-thumbnail-service-token",
  THOT_THUMBNAIL_ACCESS_CLIENT_ID: "thot-os-thumbnail-access-client-id",
  THOT_THUMBNAIL_ACCESS_CLIENT_SECRET: "thot-os-thumbnail-access-client-secret",
});

/** Read existing, named OS keyring entries. Never create, print or persist a credential. */
export function readThumbnailCredential(service, { execFileSyncImpl = execFileSync,
  platform = process.platform } = {}) {
  if (!Object.values(ITEMS).includes(service)) throw new Error("thumbnail_keyring_item_invalid");
  const command = platform === "darwin" ? "/usr/bin/security" : platform === "linux" ? "/usr/bin/secret-tool" : null;
  const args = platform === "darwin"
    ? ["find-generic-password", "-s", service, "-a", ACCOUNT, "-w"]
    : ["lookup", "service", service, "account", ACCOUNT];
  try {
    if (!command) throw new Error("unsupported_platform");
    const value = String(execFileSyncImpl(command, args,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).trim();
    if (!value) throw new Error("empty_keyring_value");
    return value;
  } catch { throw new Error("thumbnail_keyring_credential_unavailable"); }
}

export async function runThumbnailKeyringCommand({ argv, baseEnv = process.env,
  readCredential = readThumbnailCredential, runCommand = runThumbnailMindCommand } = {}) {
  const options = parseThumbnailRunnerArgs(argv);
  if (options.mode === "tick") throw new Error("thumbnail_timer_not_enabled");
  if (options.mode === "plan") return runCommand({ argv, env: baseEnv });
  if (baseEnv.THOT_THUMBNAIL_ALLOW_APPLY !== "1") throw new Error("thumbnail_apply_not_enabled");
  // Apply remains bound to an explicit exact plan ID. Secrets are held only in
  // this process, and no child process is created or environment exported.
  const credentials = Object.fromEntries(Object.entries(ITEMS)
    .map(([variable, service]) => [variable, readCredential(service)]));
  const env = { ...baseEnv, ...credentials };
  delete env.THOT_THUMBNAIL_PREVIEW_R2_KEY_ID;
  delete env.THOT_THUMBNAIL_PREVIEW_R2_SECRET;
  return runCommand({ argv, env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runThumbnailKeyringCommand({ argv: process.argv.slice(2) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
        ? error.message : "thumbnail_runner_failed";
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    });
}
