import { readFileSync, writeFileSync } from "node:fs";

const creator = process.argv[2];
if (!["amber", "birch", "coral"].includes(creator)) throw new Error("Unknown synthetic creator");
const file = "/app/cloudflare/thot-os-next/wrangler.jsonc";
let config = readFileSync(file, "utf8");
const emailField = /"ACCESS_ALLOWED_EMAIL": "(?:connect@thrillnoir\.com|(?:amber|birch|coral)@synthetic\.invalid)"/;
if (!emailField.test(config)) throw new Error("Fixture allowed-email source changed");
config = config.replace(emailField, `"ACCESS_ALLOWED_EMAIL": "${creator}@synthetic.invalid"`);
// Neither provider is used by the local Portfolio journey. Remove their
// bindings from the copied fixture config so a browser action cannot call one.
config = config.replace('  "ai": {\n    "binding": "AI"\n  },\n', "");
config = config.replace('  "stream": {\n    "binding": "STREAM"\n  },\n', "");
const replacements = new Map([
  ['"account_id": "3e7cfa6efb7a97825f1dc24515410c63"', '"account_id": "00000000000000000000000000000000"'],
  ['"PORTFOLIO_PUBLISHING_ENABLED": "1"', '"PORTFOLIO_PUBLISHING_ENABLED": "0"'],
  ['"database_name": "thot-os-staging"', '"database_name": "thot-os-fixture"'],
  ['"database_id": "174532e8-5ada-4e30-abba-1276b3540b3f"', '"database_id": "00000000-0000-4000-8000-000000000000"'],
  ['"bucket_name": "thot-os-library-media-staging"', '"bucket_name": "thot-os-fixture-library"'],
  ['"bucket_name": "thot-os-previews-staging"', '"bucket_name": "thot-os-fixture-previews"'],
  ['"bucket_name": "thot-os-media-staging"', '"bucket_name": "thot-os-fixture-media"'],
]);
for (const [oldValue, newValue] of replacements) {
  if (config.includes(newValue)) continue;
  if (!config.includes(oldValue)) throw new Error(`Fixture config source changed: ${oldValue.split(":")[0]}`);
  config = config.replace(oldValue, newValue);
}
writeFileSync(file, config);

// The fixture is reached through host loopback, while Next runs inside the
// container. Permit that origin for dev assets and React hydration without
// changing the production Next config.
const nextFile = "/app/cloudflare/thot-os-next/next.config.ts";
let nextConfig = readFileSync(nextFile, "utf8");
if (!nextConfig.includes('allowedDevOrigins: ["127.0.0.1"]')) {
  const marker = "  poweredByHeader: false,";
  if (!nextConfig.includes(marker)) throw new Error("Fixture Next config source changed");
  nextConfig = nextConfig.replace(marker, '  allowedDevOrigins: ["127.0.0.1"],\n' + marker);
  writeFileSync(nextFile, nextConfig);
}
