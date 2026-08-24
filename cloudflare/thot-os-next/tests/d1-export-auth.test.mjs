import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

test("the bounded D1 export uses the approved OAuth Keychain without injecting a raw bearer", async () => {
  const source = await readFile(path.join(root, "scripts/migration/export-target.mjs"), "utf8");
  assert.match(source, /readOnlyD1ExportEnvironment/);
  assert.match(source, /CLOUDFLARE_AUTH_USE_KEYRING: "true"/);
  assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN/);
  assert.match(source, /env: readOnlyD1ExportEnvironment/);
});
