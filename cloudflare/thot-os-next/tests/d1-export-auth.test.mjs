import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

test("the bounded D1 export gives Wrangler only the scoped Keychain credential", async () => {
  const source = await readFile(path.join(root, "scripts/migration/export-target.mjs"), "utf8");
  assert.match(source, /readD1ReadTokenFromKeychain/);
  assert.match(source, /readOnlyD1ExportEnvironment/);
  assert.match(source, /CLOUDFLARE_API_TOKEN: readToken\(\)/);
  assert.match(source, /env: readOnlyD1ExportEnvironment/);
});
