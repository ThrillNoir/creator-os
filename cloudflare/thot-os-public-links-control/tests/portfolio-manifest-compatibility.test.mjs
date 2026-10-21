import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../src/portfolio-release.ts", import.meta.url), "utf8");
const start = source.indexOf("function onlyKeys(");
const end = source.indexOf("\nasync function releaseRow(", start);
const code = stripTypeScriptTypes(source.slice(start, end).replace("export function", "function"));
const parsePortfolioManifest = new Function("ID", "ASSET_ID", "LABEL", "TELEGRAM", "EMAIL", `${code};return parsePortfolioManifest;`)(
  /^[a-z0-9][a-z0-9-]{0,79}$/,
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/,
  /^[^\u0000-\u001f\u007f<>]{1,50}$/,
  /^[A-Za-z0-9_]{5,32}$/,
  /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/,
);

const card = { id: "card-one", assetId: "preview-one", fullLengthAssetId: null, kind: "image",
  title: "Preview", description: "", section: "Clips", previewKey: "private.jpg", posterKey: null };

test("an approved legacy manifest with a 255-character email remains readable", () => {
  const email = `${"a".repeat(64)}@${"b".repeat(190)}`;
  assert.equal(email.length, 255);
  const manifest = { schemaVersion: 2, contact: { email }, cards: [card] };
  assert.deepEqual(parsePortfolioManifest(manifest), manifest);
  assert.equal(parsePortfolioManifest({ ...manifest, contact: { email: `${email}x` } }), null);
});
