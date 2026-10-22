// One-off public KV backfill. Run after the metadata-aware public Worker is live.
// Preview first: node --experimental-strip-types scripts/backfill-public-preview.mjs
// Apply only with a private backup directory: ... --apply --backup-dir /private/path
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPreviewMetadata, validatePreviewMetadata } from "../cloudflare/shared/public-preview.ts";
import { classifyWranglerMutationFailure, mutationWranglerEnvironment } from "./service-auth-activate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(root, "cloudflare/thot-os-public-links/wrangler.jsonc");
const wrangler = path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler");
const accountId = JSON.parse(readFileSync(config, "utf8")).account_id;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const backupIndex = args.indexOf("--backup-dir");
const backupDir = backupIndex >= 0 ? args[backupIndex + 1] : null;
if (args.some((arg, index) => arg !== "--apply" && arg !== "--backup-dir" && (index === 0 || args[index - 1] !== "--backup-dir")) || (apply && !backupDir)) {
  throw new Error("Usage: node --experimental-strip-types scripts/backfill-public-preview.mjs [--apply --backup-dir <private-dir>]");
}

function runKv(command) {
  return execFileSync(wrangler, ["kv", "key", ...command, "--binding", "PUBLIC_LINKS", "--config", config, "--remote"], {
    cwd: root, encoding: "utf8", env: mutationWranglerEnvironment({ accountId }), stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
  });
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }

try {
  const entries = JSON.parse(runKv(["list", "--prefix", "public-profile:"]));
  if (!Array.isArray(entries)) throw new Error("Unexpected KV listing.");
  if (apply) { mkdirSync(backupDir, { recursive: true, mode: 0o700 }); chmodSync(backupDir, 0o700); }
  let changed = 0; let skipped = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || !/^public-profile:[a-z0-9][a-z0-9-]{0,79}$/.test(entry.name)) throw new Error("Unexpected public profile key.");
    const slug = entry.name.slice("public-profile:".length);
    const original = runKv(["get", entry.name, "--text"]);
    const snapshot = JSON.parse(original);
    if (snapshot.creator?.slug !== slug || !snapshot.creator.displayName || typeof snapshot.creator.bio !== "string") throw new Error(`Invalid published snapshot for ${slug}.`);
    if (snapshot.og) {
      if (validatePreviewMetadata(snapshot.og, slug).length) throw new Error(`Invalid existing preview metadata for ${slug}.`);
      skipped++; continue;
    }
    snapshot.og = defaultPreviewMetadata(snapshot.creator);
    if (validatePreviewMetadata(snapshot.og, slug).length) throw new Error(`Derived preview metadata is invalid for ${slug}.`);
    const updated = JSON.stringify(snapshot);
    if (apply) {
      // Preserve the exact prior value and listing metadata for rollback. Backups are owner-only.
      const backupPath = path.join(backupDir, `${slug}.json`);
      writeFileSync(backupPath, JSON.stringify({ key: entry.name, value: original, metadata: entry.metadata ?? null, expiration: entry.expiration ?? null }), { mode: 0o600, flag: "wx" });
      if (runKv(["get", entry.name, "--text"]) !== original) throw new Error(`Snapshot changed while backing up ${slug}; stopped.`);
      const updatePath = path.join(backupDir, `${slug}.new.json`);
      writeFileSync(updatePath, updated, { mode: 0o600, flag: "wx" });
      try {
        const putArgs = ["put", entry.name, "--path", updatePath];
        if (entry.metadata) putArgs.push("--metadata", JSON.stringify(entry.metadata));
        if (entry.expiration) putArgs.push("--expiration", String(entry.expiration));
        runKv(putArgs);
      } finally { rmSync(updatePath, { force: true }); }
      console.log(`${slug}: backed up ${digest(original).slice(0, 12)}, submitted ${digest(updated).slice(0, 12)}`);
    }
    changed++;
  }
  console.log(`${apply ? "Applied" : "Planned"} ${changed} preview metadata update(s); ${skipped} already current; ${entries.length} published key(s) inspected.`);
} catch (error) {
  // Wrangler stderr can contain provider details; do not print it or snapshot content.
  console.error(`Public preview backfill stopped: ${classifyWranglerMutationFailure(error)}`);
  process.exitCode = 1;
}
