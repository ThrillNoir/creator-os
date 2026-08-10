import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface D1Result<T> { results: T[]; success: boolean }

export function cloudflareEnv(): CloudflareEnv {
  return getCloudflareContext().env;
}
