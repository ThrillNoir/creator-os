import { readFile, mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createVideoThumbnailStorageAdapter } from "./video-thumbnail-storage-adapter.mjs";
import { createRemoteD1Port, createRemoteR2Port, createRemotePosterCommitPort } from "./video-thumbnail-remote-ports.mjs";
import { planVideoThumbnailRun, applyVideoThumbnailRun, runVideoThumbnailTimerTick } from "./video-thumbnail-runner.mjs";
import { readD1ReadTokenFromSecureStore } from "./service-auth-activate.mjs";

const CREATOR = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PLAN = /^thumbnail:[0-9a-f]{16}$/;
const configPath = new URL("../cloudflare/thot-os-next/wrangler.jsonc", import.meta.url);

export function parseThumbnailRunnerArgs(argv) {
  const options = { mode: "plan", maxItems: 2, maxSourceBytes: 3 * 1024 ** 3, afterId: "" };
  let modeSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plan" || arg === "--tick" || arg === "--apply") {
      if (modeSeen) throw new Error("thumbnail_mode_ambiguous");
      modeSeen = true; options.mode = arg.slice(2);
      if (arg === "--apply") options.planId = argv[++i];
    } else if (arg === "--creator") options.creatorId = argv[++i];
    else if (arg === "--after") options.afterId = argv[++i];
    else if (arg === "--max-items") options.maxItems = Number(argv[++i]);
    else if (arg === "--max-source-bytes") options.maxSourceBytes = Number(argv[++i]);
    else throw new Error("thumbnail_argument_invalid");
  }
  if (!CREATOR.test(options.creatorId ?? "") || !Number.isInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 25
    || !Number.isSafeInteger(options.maxSourceBytes) || options.maxSourceBytes < 1 || options.maxSourceBytes > 5 * 1024 ** 3
    || (options.mode === "apply" && !PLAN.test(options.planId ?? ""))
    || (options.mode === "tick" && options.afterId)) throw new Error("thumbnail_argument_invalid");
  return options;
}

export function thumbnailTarget(config) {
  const DB = config.d1_databases?.find((item) => item.binding === "DB");
  const source = config.r2_buckets?.find((item) => item.binding === "LIBRARY_MEDIA");
  const previews = config.r2_buckets?.find((item) => item.binding === "PREVIEWS");
  if (config.name !== "thot-os-staging" || config.account_id !== "3e7cfa6efb7a97825f1dc24515410c63"
    || DB?.database_name !== "thot-os-staging" || DB.database_id !== "174532e8-5ada-4e30-abba-1276b3540b3f"
    || source?.bucket_name !== "thot-os-library-media-staging"
    || previews?.bucket_name !== "thot-os-previews-staging") {
    throw new Error("thumbnail_target_mismatch");
  }
  return { accountId: config.account_id, databaseId: DB.database_id, databaseName: DB.database_name,
    sourceBucket: source.bucket_name, previewBucket: previews.bucket_name };
}

export function createThumbnailStateStore({ root = join(homedir(), ".local", "state", "thot-os", "video-thumbnails") } = {}) {
  const file = (creatorId) => {
    if (!CREATOR.test(creatorId)) throw new Error("thumbnail_argument_invalid");
    return join(root, `${creatorId}.json`);
  };
  return {
    async read(creatorId) {
      try { return JSON.parse(await readFile(file(creatorId), "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return { afterId: "" }; throw error; }
    },
    async write(creatorId, state) {
      const path = file(creatorId);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      const handle = await open(tmp, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ afterId: state.afterId ?? "" }) + "\n"); }
      finally { await handle.close(); }
      try { await rename(tmp, path); }
      finally { await rm(tmp, { force: true }); }
    },
  };
}

export async function runThumbnailMindCommand({ argv, env = process.env, readToken = readD1ReadTokenFromSecureStore,
  config = null, portFactory = { d1: createRemoteD1Port, r2: createRemoteR2Port, commit: createRemotePosterCommitPort },
  stateStore = createThumbnailStateStore() }) {
  const options = parseThumbnailRunnerArgs(argv);
  const target = thumbnailTarget(config ?? JSON.parse(await readFile(configPath, "utf8")));
  if (options.mode === "apply" && env.THOT_THUMBNAIL_ALLOW_APPLY !== "1") throw new Error("thumbnail_apply_not_enabled");
  if (options.mode === "tick" && env.THOT_THUMBNAIL_TIMER_ENABLED !== "1") throw new Error("thumbnail_timer_not_enabled");
  const write = options.mode !== "plan";
  const d1Token = readToken();
  if (!d1Token) throw new Error("thumbnail_d1_credential_missing");
  const DB = portFactory.d1({ accountId: target.accountId, databaseId: target.databaseId,
    databaseName: target.databaseName, token: d1Token });
  const credentials = write ? {
    source: [env.THOT_THUMBNAIL_SOURCE_R2_KEY_ID, env.THOT_THUMBNAIL_SOURCE_R2_SECRET],
  } : null;
  if (write && !credentials.source.every(Boolean)) throw new Error("thumbnail_r2_credential_missing");
  if (write && (![env.THOT_THUMBNAIL_SERVICE_TOKEN, env.THOT_THUMBNAIL_ACCESS_CLIENT_ID,
    env.THOT_THUMBNAIL_ACCESS_CLIENT_SECRET].every(Boolean) || typeof portFactory.commit !== "function"))
    throw new Error("thumbnail_commit_credential_missing");
  const missing = { async head() { throw new Error("thumbnail_plan_is_read_only"); },
    async get() { throw new Error("thumbnail_plan_is_read_only"); },
    async put() { throw new Error("thumbnail_plan_is_read_only"); } };
  const LIBRARY_MEDIA = write ? portFactory.r2({ accountId: target.accountId, bucket: target.sourceBucket,
    accessKeyId: credentials.source[0], secretAccessKey: credentials.source[1] }) : missing;
  const PREVIEWS = write ? null : missing;
  const COMMIT_REFERENCE = write ? portFactory.commit({
    endpoint: "https://thot-os-staging.thot-os.workers.dev/api/internal/video-thumbnail/commit",
    serviceToken: env.THOT_THUMBNAIL_SERVICE_TOKEN,
    accessClientId: env.THOT_THUMBNAIL_ACCESS_CLIENT_ID,
    accessClientSecret: env.THOT_THUMBNAIL_ACCESS_CLIENT_SECRET,
  }) : null;
  const adapter = createVideoThumbnailStorageAdapter({ DB, LIBRARY_MEDIA, PREVIEWS, COMMIT_REFERENCE });
  const targetName = { accountId: target.accountId, databaseId: target.databaseId,
    database: target.databaseName, sourceBucket: target.sourceBucket, previewBucket: target.previewBucket };
  const common = { adapter, target: targetName, creatorId: options.creatorId,
    maxItems: options.maxItems, maxSourceBytes: options.maxSourceBytes };
  if (options.mode === "tick") return runVideoThumbnailTimerTick({ ...common, stateStore });
  const plan = await planVideoThumbnailRun({ ...common, afterId: options.afterId });
  if (options.mode === "plan") return plan;
  if (plan.planId !== options.planId) throw new Error("thumbnail_plan_changed");
  return applyVideoThumbnailRun({ adapter, plan });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runThumbnailMindCommand({ argv: process.argv.slice(2) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "thumbnail_runner_failed";
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    });
}
