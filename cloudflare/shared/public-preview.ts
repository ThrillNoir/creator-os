export const SITE_ORIGIN = "https://www.thathuboverthere.com";
export const SITE_NAME = "That Hub Over There";

export type PreviewMetadata = { title: string; description: string; image: string; alt: string };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

export function clampPreviewText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const prefix = normalized.slice(0, limit - 1);
  const wordEnd = prefix.lastIndexOf(" ");
  return `${(wordEnd > limit / 2 ? prefix.slice(0, wordEnd) : prefix).trimEnd()}…`;
}

export function defaultPreviewMetadata(creator: { slug: string; displayName: string; bio: string; headline?: string }): PreviewMetadata {
  return {
    title: clampPreviewText(creator.displayName, 62),
    description: clampPreviewText(creator.bio.trim() || creator.headline?.trim() || `Meet ${creator.displayName} on ${SITE_NAME}.`, 155),
    image: `/preview/${creator.slug}.png`,
    alt: `${clampPreviewText(creator.displayName, 100)} social preview`,
  };
}

export function validatePreviewMetadata(value: unknown, slug: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Preview metadata is missing."];
  const og = value as Partial<PreviewMetadata>;
  const errors: string[] = [];
  if (typeof og.title !== "string" || !og.title.trim() || og.title.length > 62) errors.push("Preview title must be 1–62 characters.");
  if (typeof og.description !== "string" || !og.description.trim() || og.description.length > 155) errors.push("Preview description must be 1–155 characters.");
  if (og.image !== `/preview/${slug}.png`) errors.push("Preview image path must match this creator.");
  if (typeof og.alt !== "string" || !og.alt.trim() || og.alt.length > 160) errors.push("Preview image alt text is required (up to 160 characters).");
  return errors;
}

export type HeadArgs = {
  title: string;
  description: string;
  path: string;
  card: { path: string; alt: string; width?: number; height?: number };
  ogType?: string;
  jsonLd?: unknown;
  robots?: string;
};

function absolutePath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Preview URL must use a same-origin absolute path.");
  const url = new URL(path, SITE_ORIGIN);
  if (url.origin !== SITE_ORIGIN || url.search || url.hash) throw new Error("Preview URL must use a same-origin path without query or fragment.");
  return url.href;
}

export function renderHead(args: HeadArgs): string {
  const title = clampPreviewText(args.title, 62);
  const description = clampPreviewText(args.description, 155);
  const canonical = absolutePath(args.path);
  const image = absolutePath(args.card.path);
  const alt = args.card.alt.trim();
  const width = args.card.width ?? 1200;
  const height = args.card.height ?? 630;
  const e = escapeHtml;
  // Escape angle brackets in JSON as well: a profile name cannot close this script element.
  const structuredData = args.jsonLd === undefined ? "" : `<script type="application/ld+json">${JSON.stringify(args.jsonLd).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`;
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${e(title)}</title>`,
    `<meta name="description" content="${e(description)}">`,
    `<meta name="robots" content="${e(args.robots ?? "index,follow")}">`,
    '<meta name="rating" content="general">',
    '<meta name="theme-color" content="#112c24">',
    `<link rel="canonical" href="${e(canonical)}">`,
    `<meta property="og:type" content="${e(args.ogType ?? "website")}">`,
    `<meta property="og:site_name" content="${e(SITE_NAME)}">`,
    '<meta property="og:locale" content="en_AU">',
    `<meta property="og:url" content="${e(canonical)}">`,
    `<meta property="og:title" content="${e(title)}">`,
    `<meta property="og:description" content="${e(description)}">`,
    `<meta property="og:image" content="${e(image)}">`,
    `<meta property="og:image:secure_url" content="${e(image)}">`,
    '<meta property="og:image:type" content="image/png">',
    `<meta property="og:image:width" content="${width}">`,
    `<meta property="og:image:height" content="${height}">`,
    `<meta property="og:image:alt" content="${e(alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${e(title)}">`,
    `<meta name="twitter:description" content="${e(description)}">`,
    `<meta name="twitter:image" content="${e(image)}">`,
    `<meta name="twitter:image:alt" content="${e(alt)}">`,
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    `<link rel="preload" as="image" href="${e(image)}">`,
    structuredData,
  ].filter(Boolean).join("\n");
}

export function htmlDoc(head: string, body: string): string {
  return `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body>${body}</body></html>`;
}

export function htmlResponse(doc: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(doc, { ...init, headers });
}
