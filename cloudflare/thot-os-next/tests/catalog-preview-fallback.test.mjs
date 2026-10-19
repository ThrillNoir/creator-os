import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import Database from "better-sqlite3";

const source = await readFile(new URL("../src/components/asset-card.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const exports = {};
const requireFixture = (name) => {
  if (name === "react/jsx-runtime") return jsxRuntime;
  if (name === "next/link") return (props) => React.createElement("a", props);
  if (name === "@/lib/library") return { objectIdFor: (asset) => asset.preview_r2_key?.match(/\/assets\/([a-f0-9]{64})\//)?.[1] ?? null };
  if (name === "@/components/private-stream-player") return { PrivateStreamPlayer: () => null };
  if (name === "@/components/verified-video-preview") return { VerifiedVideoPreview: () => null };
  if (name === "@/lib/verified-video-preview") return { canPreviewVerifiedVideo: () => false };
  throw new Error(`Unexpected dependency: ${name}`);
};
new Function("require", "exports", compiled)(requireFixture, exports);

test("a photo without a ready preview still opens its stable asset review page", () => {
  const id = "source-a";
  const html = renderToStaticMarkup(React.createElement(exports.AssetCard, { asset: {
    id, basename: "photo.heic", extension: "heic", bytes: 1024,
    preview_r2_key: null, media_state: "preview_failed", video_state: null,
    safety: null, destinations: "", is_teaser: 0, is_multi: 0,
  } }));
  assert.match(html, new RegExp(`href="/library/${id}"`));
  assert.match(html, /Private preview needs a retry/);
  assert.doesNotMatch(html, /<img/);
});

test("a ready photo keeps its creator-scoped preview and review link", () => {
  const objectId = "a".repeat(64);
  const html = renderToStaticMarkup(React.createElement(exports.AssetCard, { asset: {
    id: "00000000-0000-4000-8000-000000000001", basename: "photo.jpg", extension: "jpg", bytes: 1024,
    preview_r2_key: `creators/own/assets/${objectId}/previews/${"b".repeat(64)}.jpg`,
    media_state: "preview_ready", video_state: null, safety: null,
    destinations: "", is_teaser: 0, is_multi: 0,
  } }));
  assert.match(html, new RegExp(`href="/library/${objectId}"`));
  assert.match(html, new RegExp(`src="/api/preview/${objectId}"`));
});

test("metadata review resolves a bounded legacy asset ID without exposing another creator", async () => {
  const library = await readFile(new URL("../src/lib/library.ts", import.meta.url), "utf8");
  const start = library.indexOf("export async function getAssetByObjectId(");
  const end = library.indexOf("\nexport ", start + 1);
  const code = ts.transpileModule(library.slice(start, end).replace("export async", "async"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,basename TEXT,extension TEXT,bytes INTEGER,modified_at TEXT,creator_notes TEXT,preview_r2_key TEXT,source_available INTEGER);
      CREATE TABLE asset_classifications(asset_id TEXT,creator_id TEXT,safety TEXT,is_teaser INTEGER,is_multi INTEGER,notes TEXT);
      CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT);
      CREATE TABLE asset_video_playback_states(asset_id TEXT,creator_id TEXT,state TEXT,source_codec TEXT,playback_provider TEXT,failure_code TEXT);
      CREATE TABLE asset_destinations(asset_id TEXT,creator_id TEXT,destination TEXT);
      INSERT INTO assets VALUES ('source-a','own','a.heic','heic',10,'2026-10-04','',NULL,1),('source-b','foreign','b.heic','heic',10,'2026-10-04','private',NULL,1);
      INSERT INTO asset_media_authorities VALUES ('source-a','own','r2_native','preview_failed'),('source-b','foreign','r2_native','preview_failed');`);
    let reads = 0;
    const lookup = new Function("cloudflareEnv", `${code}; return getAssetByObjectId;`)(() => ({ DB: {
      prepare(sql) { return { bind(...args) { return { async first() { reads++; return db.prepare(sql).get(...args) ?? null; } }; } }; },
    } }));
    assert.equal((await lookup("own", "source-a")).id, "source-a");
    assert.equal(await lookup("own", "source-b"), null);
    for (const value of ["../source-a", "source/a", "a".repeat(201), "source-a?token=x"]) {
      assert.equal(await lookup("own", value), null);
    }
    assert.equal(reads, 2, "invalid route identifiers are rejected before data access");
  } finally { db.close(); }
});
