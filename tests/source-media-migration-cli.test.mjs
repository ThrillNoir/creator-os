import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workspace = path.resolve(import.meta.dirname, "..");
const script = path.join(workspace, "scripts/source-media-migration.mjs");

test("source-media inventory rejects an unapproved root without printing its absolute path", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "creatoros-source-media-cli-"));
  try {
    const sourceRoot = path.join(temporary, "source");
    const folder = path.join(sourceRoot, "creator");
    const mapping = path.join(temporary, "map.json");
    const manifest = path.join(temporary, "manifest.json");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "image.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    await writeFile(mapping, JSON.stringify({ schemaVersion: 1, creators: [{ creatorId: "example", sourceFolder: "creator", assets: [{ assetId: "asset-1", relativePath: "image.png", sourceRevision: "rev-1" }] }] }));
    const result = spawnSync(process.execPath, [script, "inventory", "--source-root", sourceRoot, "--creator-map", mapping, "--output", manifest], { cwd: workspace, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /source_root_not_authorized/);
    assert.doesNotMatch(result.stdout, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await assert.rejects(readFile(manifest, "utf8"), /ENOENT/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
