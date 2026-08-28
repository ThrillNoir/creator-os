import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workspace = path.resolve(import.meta.dirname, "..");
const script = path.join(workspace, "scripts/source-media-migration.mjs");

test("source-media inventory is read-only, creator-mapped, and does not print an absolute source path", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "creatoros-source-media-cli-"));
  try {
    const sourceRoot = path.join(temporary, "source");
    const folder = path.join(sourceRoot, "creator");
    const mapping = path.join(temporary, "map.json");
    const manifest = path.join(temporary, "manifest.json");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "image.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    await writeFile(mapping, JSON.stringify({ schemaVersion: 1, creators: [{ creatorId: "example", sourceFolder: "creator", assets: [{ assetId: "asset-1", relativePath: "image.jpg" }] }] }));
    const result = spawnSync(process.execPath, [script, "inventory", "--source-root", sourceRoot, "--creator-map", mapping, "--output", manifest], { cwd: workspace, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const output = JSON.parse(await readFile(manifest, "utf8"));
    assert.equal(output.items.length, 1);
    assert.equal(output.items[0].relativePath, "creator/image.jpg");
    assert.match(output.items[0].sha256, /^[a-f0-9]{64}$/);
    assert.match(output.items[0].objectKey, /^originals\/v1\/[0-9a-f-]+$/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
