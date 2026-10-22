import { isPublicCreatorSlug } from "../../shared/public-profile-slug.ts";
import { livePublicHostGuard } from "../../shared/live-public-host.ts";
import { validatePreviewMetadata } from "../../shared/public-preview.ts";

type PublicMediaItem = {
  id: string;
  href: string;
  checksum: string;
  contentType: "image/webp";
  imageRole: "avatar" | "background" | "gallery";
  position?: number;
};

type PublicSnapshot = {
  schemaVersion: 4 | 5;
  publishedVersionId: string;
  creator: { slug: string; displayName: string; headline: string; bio: string };
  media: PublicMediaItem[];
  og?: { title: string; description: string; image: string; alt: string };
};

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function snapshotKey(slug: string) { return `public-profile:${slug}`; }
function mediaKey(slug: string, versionId: string, attachmentId: string) { return `public-media/${slug}/${versionId}/${attachmentId}.webp`; }

function headers(cacheControl: string) {
  return {
    "cache-control": cacheControl,
    "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "cross-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
  };
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { ...headers("no-store"), "content-type": "text/plain; charset=utf-8" } });
}

function hasOnlyKeys(value: object, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validHref(value: unknown, requestOrigin: string, slug: string, versionId: string, attachmentId: string) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === requestOrigin && !url.search && !url.hash
      && url.pathname === `/media/${encodeURIComponent(slug)}/${encodeURIComponent(versionId)}/${encodeURIComponent(attachmentId)}`;
  } catch {
    return false;
  }
}

function validCreator(value: unknown, slug: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const creator = value as Partial<PublicSnapshot["creator"]>;
  return hasOnlyKeys(creator, ["slug", "displayName", "headline", "bio"])
    && creator.slug === slug && isPublicCreatorSlug(creator.slug)
    && typeof creator.displayName === "string" && creator.displayName.length >= 1 && creator.displayName.length <= 120
    && typeof creator.headline === "string" && creator.headline.length <= 280
    && typeof creator.bio === "string" && creator.bio.length <= 2000;
}

function validSnapshot(value: unknown, requestOrigin: string, slug: string, versionId: string, attachmentId: string): value is PublicSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<PublicSnapshot>;
  if (!hasOnlyKeys(snapshot, ["schemaVersion", "publishedVersionId", "creator", "links", "actions", "appearance", "media", "og"])
    || (snapshot.schemaVersion !== 4 && snapshot.schemaVersion !== 5) || snapshot.publishedVersionId !== versionId || !validCreator(snapshot.creator, slug) || !Array.isArray(snapshot.media)) return false;
  if (snapshot.schemaVersion === 5 && (snapshot.media.length < 1 || snapshot.media.length > 6
    || new Set(snapshot.media.map((item) => item?.id)).size !== snapshot.media.length
    || !snapshot.media.every((item, index) => item && ID.test(item.id)
    && item.position === index && item.imageRole === (index === 0 ? "avatar" : "gallery")
    && item.contentType === "image/webp" && SHA256.test(item.checksum)
    && validHref(item.href, requestOrigin, slug, versionId, item.id)))) return false;
  const selected = snapshot.media.filter((item) => item && typeof item === "object" && item.id === attachmentId);
  if (selected.length !== 1) return false;
  const media = selected[0];
  const position = snapshot.media.findIndex((item) => item.id === attachmentId);
  return hasOnlyKeys(media, snapshot.schemaVersion === 5 ? ["id", "href", "altText", "contentType", "imageRole", "checksum", "position"] : ["id", "href", "altText", "contentType", "imageRole", "checksum"])
    && media.contentType === "image/webp" && (snapshot.schemaVersion === 5
      ? media.position === position && media.imageRole === (position === 0 ? "avatar" : "gallery")
      : media.imageRole === "avatar" || media.imageRole === "background")
    && typeof media.checksum === "string" && SHA256.test(media.checksum)
    && validHref(media.href, requestOrigin, slug, versionId, attachmentId);
}

function checksumHex(value: ArrayBuffer | undefined) {
  return value ? Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
}

function validObject(object: R2ObjectBody, snapshot: PublicSnapshot, attachmentId: string) {
  const media = snapshot.media.find((item) => item.id === attachmentId);
  const metadata = object.customMetadata;
  return Boolean(media && object.httpMetadata?.contentType === "image/webp"
    && metadata?.creatorSlug === snapshot.creator.slug
    && metadata.versionId === snapshot.publishedVersionId
    && metadata.attachmentId === attachmentId
    && metadata.surface === "public_sfw"
    && metadata.imageRole === media.imageRole
    && metadata.checksum === media.checksum
    && checksumHex(object.checksums.sha256) === media.checksum);
}

const PREVIEW_CACHE = "public, s-maxage=300, stale-while-revalidate=86400";

async function previewImage(request: Request, env: Env, slug: string, siteFallback = false): Promise<Response> {
  const snapshot = siteFallback ? null : await env.PUBLIC_LINKS.get(snapshotKey(slug), "json") as Partial<PublicSnapshot> | null;
  if (!siteFallback && (!snapshot || !snapshot.creator || snapshot.creator.slug !== slug || !isPublicCreatorSlug(slug)
    || typeof snapshot.publishedVersionId !== "string" || !ID.test(snapshot.publishedVersionId)
    || (snapshot.og !== undefined && validatePreviewMetadata(snapshot.og, slug).length > 0))) return notFound();
  if (!siteFallback && snapshot?.og) {
    const object = await env.PUBLIC_MEDIA.get(`preview/${slug}.png`);
    const metadata = object?.customMetadata;
    if (object && object.httpMetadata?.contentType === "image/png"
      && metadata?.creatorSlug === slug && metadata.versionId === snapshot.publishedVersionId
      && metadata.surface === "public_sfw" && /^[a-f0-9]{64}$/i.test(metadata.checksum ?? "")
      && checksumHex(object.checksums.sha256) === metadata.checksum) {
      const headers = { ...headersForPreview(), etag: `"${metadata.checksum}"` };
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }
  }
  // No published custom card: the bundled image is public and contains no creator data.
  const fallback = await env.ASSETS.fetch(new Request(new URL("/fallback.png", request.url)));
  if (!fallback.ok) return notFound();
  return new Response(request.method === "HEAD" ? null : fallback.body, { headers: headersForPreview() });
}

function headersForPreview() {
  return { ...headers(PREVIEW_CACHE), "content-type": "image/png" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { ...headers("no-store"), allow: "GET, HEAD" } });
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const previewSlug = parts.length === 2 && parts[0] === "preview" && parts[1].endsWith(".png") ? parts[1].slice(0, -4) : null;
    const guarded = livePublicHostGuard(request, env, "media", parts[0] === "media" ? parts[1] : previewSlug === "site" ? undefined : previewSlug ?? undefined);
    if (guarded) return guarded;
    if (previewSlug && !url.search && !url.hash && (previewSlug === "site" || isPublicCreatorSlug(previewSlug))) {
      return previewImage(request, env, previewSlug, previewSlug === "site");
    }
    if (parts.length !== 4 || parts[0] !== "media" || !isPublicCreatorSlug(parts[1]) || !ID.test(parts[2]) || !ID.test(parts[3]) || url.search || url.hash) return notFound();
    const [_, slug, versionId, attachmentId] = parts;
    const snapshot = await env.PUBLIC_LINKS.get(snapshotKey(slug), "json");
    if (!validSnapshot(snapshot, url.origin, slug, versionId, attachmentId)) return notFound();
    const object = await env.PUBLIC_MEDIA.get(mediaKey(slug, versionId, attachmentId));
    if (!object || !validObject(object, snapshot, attachmentId)) return notFound();
    const media = snapshot.media.find((item) => item.id === attachmentId)!;
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers("public, max-age=31536000, immutable"), "content-type": "image/webp", etag: `\"${media.checksum}\"` } });
    return new Response(object.body, { headers: { ...headers("public, max-age=31536000, immutable"), "content-type": "image/webp", etag: `\"${media.checksum}\"` } });
  },
} satisfies ExportedHandler<Env>;
