export const selfServeSocialPlatforms = ["instagram", "tiktok", "reddit"] as const;

export type SelfServeSocialPlatform = (typeof selfServeSocialPlatforms)[number];

export function normalizeSocialHandle(platform: SelfServeSocialPlatform, input: string) {
  const handle = input.trim().replace(platform === "reddit" ? /^(?:u\/|@)/i : /^@/, "").toLowerCase();
  if (!/^[a-z0-9._-]{1,120}$/.test(handle)) throw new Error("Enter a username, without a profile URL or spaces.");
  return handle;
}
