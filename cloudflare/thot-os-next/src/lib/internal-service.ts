import "server-only";

export type InternalService = "instagram" | "reddit" | "telegram" | "vault_catalogue";

const tokenKey: Record<InternalService, keyof CloudflareEnv> = {
  instagram: "INTERNAL_INSTAGRAM_SCHEDULER_TOKEN",
  reddit: "INTERNAL_REDDIT_SCHEDULER_TOKEN",
  telegram: "INTERNAL_TELEGRAM_BRIDGE_TOKEN",
  vault_catalogue: "INTERNAL_VAULT_CATALOGUE_TOKEN",
};

/**
 * Adds a credential that the receiving Worker verifies against D1 service
 * credentials and creator grants. Service binding reachability is not treated as
 * authentication.
 */
export function fetchInternalService(
  env: CloudflareEnv,
  service: InternalService,
  fetcher: Fetcher,
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const token = env[tokenKey[service]];
  if (typeof token !== "string" || token.length < 40) throw new Error(`The ${service} internal service credential is not configured.`);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetcher.fetch(input, { ...init, headers });
}
