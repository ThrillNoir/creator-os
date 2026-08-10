import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("preview builder uses creator-scoped opaque R2 keys", async () => {
  const source = await readFile(path.join(root, "scripts/build-cloudflare-previews.mjs"), "utf8");
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /creators\/\$\{creatorId\}\/assets\/\$\{objectId\}\/preview\.jpg/);
  assert.match(source, /WHERE id=\$\{quote\(entry\.assetId\)\} AND creator_id=\$\{quote\(creatorId\)\}/);
  assert.doesNotMatch(source, /basename/);
});

test("preview uploader keeps the R2 bucket private", async () => {
  const source = await readFile(path.join(root, "scripts/upload-cloudflare-previews.mjs"), "utf8");
  assert.match(source, /thot-os-previews-staging/);
  assert.match(source, /private, max-age=86400/);
  assert.doesNotMatch(source, /public|r2\.dev/);
});
