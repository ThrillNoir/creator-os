// Example: node scripts/verify-public-preview.mjs https://www.thathuboverthere.com
// Local Workers: --handles adelaide --media-base http://127.0.0.1:8788
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mutationWranglerEnvironment } from "./service-auth-activate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(root, "cloudflare/thot-os-public-links/wrangler.jsonc");
const args = process.argv.slice(2);
const base = args[0];
const option = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
if (!base || !/^https?:\/\//.test(base)) throw new Error("Usage: node scripts/verify-public-preview.mjs <base-url> [--handles slug,slug] [--media-base <local-media-worker-url>]");
const origin = new URL(base).origin;
const mediaOrigin = option("--media-base") ? new URL(option("--media-base")).origin : origin;
const canonicalOrigin = "https://www.thathuboverthere.com";
const configured = JSON.parse(readFileSync(config, "utf8"));
const wrangler = path.join(root, "cloudflare/thot-os-next/node_modules/.bin/wrangler");

function publishedHandles() {
  const selected = option("--handles");
  if (selected) return selected.split(",").filter(Boolean);
  const listed = execFileSync(wrangler, ["kv", "key", "list", "--binding", "PUBLIC_LINKS", "--prefix", "public-profile:", "--config", config, "--remote"], {
    cwd: root, encoding: "utf8", env: mutationWranglerEnvironment({ accountId: configured.account_id }), stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(listed).map(({ name }) => name.slice("public-profile:".length));
}
function tag(head, key, attribute = "property") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return head.match(new RegExp(`<meta\\s+${attribute}="${escaped}"\\s+content="([^"]*)"`))?.[1] ?? null;
}
function check(condition, message) { if (!condition) throw new Error(message); }
const handles = publishedHandles();
check(handles.length > 0, "No published handles found; pass --handles for local fixtures.");
for (const slug of handles) {
  check(/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug), `Invalid listed slug: ${slug}`);
  const response = await fetch(`${origin}/${slug}`, { redirect: "manual" });
  check(response.status === 200, `${slug}: page status ${response.status}, expected 200`);
  const html = await response.text();
  const head = html.split("</head>")[0];
  for (const key of ["og:title", "og:description", "og:image", "og:url"]) check(Boolean(tag(head, key)), `${slug}: missing ${key}`);
  const canonical = head.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
  check(canonical === `${canonicalOrigin}/${slug}`, `${slug}: canonical mismatch`);
  check(tag(head, "og:url") === canonical, `${slug}: og:url mismatch`);
  const image = tag(head, "og:image");
  check(image === `${canonicalOrigin}/preview/${slug}.png`, `${slug}: image URL mismatch`);
  check(tag(head, "og:image:type") === "image/png" && tag(head, "og:image:width") === "1200" && tag(head, "og:image:height") === "630" && Boolean(tag(head, "og:image:alt")), `${slug}: incomplete image metadata`);
  const imageResponse = await fetch(`${mediaOrigin}/preview/${slug}.png`, { redirect: "manual", headers: { "User-Agent": "PublicPreviewVerifier/1" } });
  check(imageResponse.status === 200 && imageResponse.headers.get("content-type")?.startsWith("image/png"), `${slug}: preview image unavailable without Referer (${imageResponse.status})`);
  console.log(`${slug}: 200; self-canonical metadata; PNG 200 without Referer`);
}
const absent = `missing-preview-check-${Math.random().toString(36).slice(2, 10)}`;
const missing = await fetch(`${origin}/${absent}`, { redirect: "manual" });
check(missing.status === 404 && missing.headers.get("content-type")?.startsWith("text/html") && (await missing.text()).includes("<html"), "Missing creator did not return HTML 404");
console.log(`Missing creator: HTML 404; verified ${handles.length} published handle(s).`);
