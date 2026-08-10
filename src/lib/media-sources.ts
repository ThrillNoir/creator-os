import "server-only";

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MEDIA_ROOT = "/Users/BR/Library/CloudStorage/Dropbox/# Creator OS";
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".mov", ".mp4"]);

export function getCreatorMediaRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.CREATOR_OS_CREATOR_MEDIA_ROOT?.trim() || DEFAULT_MEDIA_ROOT);
}

function mediaCount(directory: string): number {
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const absolute = path.join(/* turbopackIgnore: true */ directory, entry.name);
    if (entry.isDirectory()) count += mediaCount(absolute);
    else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) count += 1;
  }
  return count;
}

export function getAvailableCreatorMediaSources() {
  const root = getCreatorMediaRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const absolutePath = path.join(/* turbopackIgnore: true */ root, entry.name);
      const subfolders = readdirSync(absolutePath, { withFileTypes: true })
        .filter((child) => child.isDirectory())
        .map((child) => child.name)
        .sort();
      return { name: entry.name, absolutePath, subfolders, mediaCount: mediaCount(absolutePath) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function validateCreatorMediaSource(candidate: string) {
  const root = getCreatorMediaRoot();
  const resolved = path.resolve(/* turbopackIgnore: true */ candidate);
  if (path.dirname(resolved) !== root || !existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("Choose a creator folder directly inside the approved Creator OS Dropbox root.");
  }
  return resolved;
}
