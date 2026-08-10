import path from "node:path";

export const LOCAL_BRIDGE_PLATFORMS = ["onlyfans", "fansly"] as const;
export type LocalBridgePlatform = (typeof LOCAL_BRIDGE_PLATFORMS)[number];

const platformUrls: Record<LocalBridgePlatform, { login: string; inbox: string; earnings: string; vault:string }> = {
  onlyfans: { login: "https://onlyfans.com/", inbox: "https://onlyfans.com/my/chats/", earnings: "https://onlyfans.com/my/statements/earnings/", vault:"https://onlyfans.com/my/vault/" },
  fansly: { login: "https://fansly.com/", inbox: "https://fansly.com/messages", earnings: "https://fansly.com/creator/earnings", vault:"https://fansly.com/creator/vault" },
};

export function isLocalBridgePlatform(value: string): value is LocalBridgePlatform {
  return LOCAL_BRIDGE_PLATFORMS.includes(value as LocalBridgePlatform);
}

export function getLocalBridgeUrl(platform: LocalBridgePlatform, destination: "login" | "inbox" | "earnings" | "vault") {
  return platformUrls[platform][destination];
}

export function localBridgeProfilePath(baseDirectory: string, creatorId: string, accountId: string) {
  if (!/^[a-z0-9-]+$/i.test(creatorId) || !/^[a-z0-9-]+$/i.test(accountId)) throw new Error("Bridge profile identifiers contain unsupported characters.");
  const root = path.resolve(baseDirectory);
  const resolved = path.resolve(root, creatorId, accountId);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Bridge profile path escaped its approved root.");
  return resolved;
}

export function normalisePlatformUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}
