import "server-only";

export type InternalService = "instagram" | "reddit" | "telegram" | "vault" | "public_links_control";
export type InternalServiceCapability =
  | "instagram.status.read" | "instagram.connection.manage" | "instagram.publish.execute" | "instagram.sync.execute" | "instagram.messages.sync" | "instagram.messages.write"
  | "reddit.status.read" | "reddit.connection.manage" | "reddit.communities.read" | "reddit.publish.execute"
  | "telegram.status.read" | "telegram.connection.manage" | "telegram.messages.sync" | "telegram.messages.write"
  | "vault.source_media.health"
  | "public.profile.publish" | "public.profile.withdraw"
  | "adult.profile.publish" | "adult.profile.withdraw";

const tokenKey: Record<InternalService, keyof CloudflareEnv> = {
  instagram: "INTERNAL_INSTAGRAM_SCHEDULER_TOKEN",
  reddit: "INTERNAL_REDDIT_SCHEDULER_TOKEN",
  telegram: "INTERNAL_TELEGRAM_BRIDGE_TOKEN",
  vault: "INTERNAL_VAULT_BRIDGE_TOKEN",
  public_links_control: "INTERNAL_PUBLIC_LINKS_CONTROL_TOKEN",
};

/**
 * Adds a credential that the receiving Worker verifies against D1 service
 * credentials and creator grants. Service binding reachability is not treated as
 * authentication.
 */
export function fetchInternalService(
  env: CloudflareEnv,
  service: InternalService,
  capability: InternalServiceCapability,
  fetcher: Fetcher,
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const token = env[tokenKey[service]];
  if (typeof token !== "string" || token.length < 40) throw new Error(`The ${service} internal service credential is not configured.`);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-thot-os-service-capability", capability);
  return fetcher.fetch(input, { ...init, headers });
}
