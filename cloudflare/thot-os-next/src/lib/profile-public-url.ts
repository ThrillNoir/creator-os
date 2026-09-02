import { isPublicCreatorSlug } from "../../../shared/public-profile-slug.ts";

function configuredProfileOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function publicProfileUrl(baseUrl: string | undefined, path: string, slug: string) {
  if (!isPublicCreatorSlug(slug)) return null;
  const url = configuredProfileOrigin(baseUrl);
  if (!url) return null;
  url.pathname = `${path}/${encodeURIComponent(slug)}`;
  return url.toString();
}

/**
 * These URLs are composed solely from an environment-controlled public host
 * and a database-owned creator slug. They never include a dashboard host,
 * saved destination, query parameter, or protected profile data.
 */
export function safePublicProfileUrl(baseUrl: string | undefined, slug: string) {
  return publicProfileUrl(baseUrl, "", slug);
}

export function adultAgeGateUrl(baseUrl: string | undefined, slug: string) {
  return publicProfileUrl(baseUrl, "/age", slug);
}
