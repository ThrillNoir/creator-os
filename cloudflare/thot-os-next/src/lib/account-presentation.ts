/** Display state only; provider and publishing guards remain authoritative. */
export function platformLabel(platform: string) {
  return ({ instagram: "Instagram", reddit: "Reddit", fansly: "Fansly", onlyfans: "OnlyFans", x: "X", tiktok: "TikTok", youtube: "YouTube", telegram: "Telegram" } as Record<string, string>)[platform] ?? platform;
}

export function supportsOperations(platform: string) {
  return ["instagram", "reddit", "fansly"].includes(platform);
}

export function postingStatus(account: { platform: string; connection_status: string; publishing_authority: string }) {
  if (!supportsOperations(account.platform)) return "Manual only · integration unavailable";
  if (account.connection_status === "needs_reconnection") return "Reconnect required";
  if (account.connection_status === "needs_check") return "Needs verification";
  if (account.publishing_authority === "blocked") return "Posting blocked";
  if (account.platform === "fansly" && account.publishing_authority === "device_only") return "Vault uploads · browser required";
  if (account.connection_status === "connected") return account.publishing_authority === "confirmed" ? "Ready for reviewed posts" : "Connected · posting restricted";
  return "Connection required";
}
