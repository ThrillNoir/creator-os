import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

test("bounded D1 planning uses the approved Keychain read client instead of an ambient token", async () => {
  const source = await readFile(path.join(root, "scripts/bounded-d1-migrations.mjs"), "utf8");
  assert.match(source, /createActivationD1ReadClient/);
  assert.doesNotMatch(source, /createStructuredD1ReadClient/);
});
