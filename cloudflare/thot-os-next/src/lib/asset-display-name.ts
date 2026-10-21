export function originalAssetStem(basename: string, extension: string) {
  const suffix = `.${extension}`;
  return basename.toLowerCase().endsWith(suffix.toLowerCase()) ? basename.slice(0, -suffix.length) : basename;
}

export function assetDisplayName(asset: { basename: string; extension: string; display_stem?: string | null }) {
  return asset.display_stem ? `${asset.display_stem}.${asset.extension}` : asset.basename;
}

export function portfolioInitialTitle(asset: { basename: string; display_stem?: string | null }) {
  const originalDefault = asset.basename.replace(/\.[^.]+$/, "").trim().slice(0, 100) || "Untitled preview";
  return asset.display_stem ? asset.display_stem.slice(0, 100) : originalDefault;
}

export function validDisplayStem(value: string) {
  const stem = value.trim();
  if (!stem || stem.length > 120 || stem === "." || stem === ".." || /[\\/\x00-\x1f\x7f<>:"|?*]/u.test(stem) || /[. ]$/u.test(stem)) {
    throw new Error("Enter a name of 1–120 characters without file-path or control characters.");
  }
  return stem;
}

export function numberedDisplayStems(prefix: string, startAt: number, count: number) {
  const cleanPrefix = validDisplayStem(prefix);
  if (!Number.isSafeInteger(startAt) || startAt < 1 || startAt > 999999 || !Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("Choose a starting number from 1 to 999999 and up to 50 files.");
  }
  return Array.from({ length: count }, (_, index) => validDisplayStem(`${cleanPrefix}_${startAt + index}`));
}
