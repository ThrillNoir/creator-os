import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { canPreviewVerifiedVideo, verifiedVideoPreviewUrl } from "../src/lib/verified-video-preview.ts";

function compile(source, dependencies) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "exports", code)((name) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  return exports;
}

test("browser review is offered only for verified original video states", () => {
  for (const state of ["canonical_verified", "processing_queued", "processing", "playback_ready", "processing_failed"]) {
    assert.equal(canPreviewVerifiedVideo(state), true, state);
  }
  for (const state of [null, "uploading", "archived", "pending"]) {
    assert.equal(canPreviewVerifiedVideo(state), false, String(state));
  }
  assert.equal(verifiedVideoPreviewUrl("asset/id"), "/api/source-media/videos/asset%2Fid/download?preview=1");
});

test("Operations picker previews a verified video without changing its selection control", async () => {
  const videoSource = await readFile(new URL("../src/components/verified-video-preview.tsx", import.meta.url), "utf8");
  const preview = compile(videoSource, {
    "react/jsx-runtime": jsxRuntime,
    "@/lib/verified-video-preview": { verifiedVideoPreviewUrl },
  });
  const choiceSource = await readFile(new URL("../src/components/operations-asset-choice.tsx", import.meta.url), "utf8");
  const choice = compile(choiceSource, {
    "react/jsx-runtime": jsxRuntime,
    "next/image": () => null,
    "@/lib/library": { objectIdFor: () => null },
    "@/components/verified-video-preview": preview,
    "@/lib/verified-video-preview": { canPreviewVerifiedVideo },
  });
  const asset = { id: "video-one", basename: "original.mp4", extension: "mp4", video_state: "canonical_verified" };
  const html = renderToStaticMarkup(React.createElement(choice.OperationsAssetChoice, { asset, type: "radio", status: "Ready" }));
  assert.match(html, /<input type="radio"[^>]*name="assetId" value="video-one"/);
  assert.match(html, /<details class="ops-video-preview"><summary>Preview video<\/summary>/);
  assert.match(html, /<video[^>]*controls=""[^>]*src="\/api\/source-media\/videos\/video-one\/download\?preview=1"/);
  assert.ok(html.indexOf("</label>") < html.indexOf("<details"), "player controls stay outside the selection label");
  const uploading = renderToStaticMarkup(React.createElement(choice.OperationsAssetChoice, { asset: { ...asset, video_state: "uploading" }, type: "radio", status: "Uploading" }));
  assert.doesNotMatch(uploading, /<video|Preview video/);
});

test("Instagram reply picker retains preview for older verified R2 videos", async () => {
  const source = await readFile(new URL("../src/components/message-attachment-picker.tsx", import.meta.url), "utf8");
  const picker = compile(source, {
    "react/jsx-runtime": jsxRuntime,
    "@/lib/verified-video-preview": { canPreviewVerifiedVideo, verifiedVideoPreviewUrl },
  });
  const asset = { id: "video-one", basename: "reply.mp4", extension: "mp4", bytes: 1024, verifiedMimeType: "video/mp4", previewUrl: null };
  const render = (videoState) => renderToStaticMarkup(React.createElement(picker.MessageAttachmentPicker, {
    assets: [{ ...asset, videoState }], value: asset.id, onChange: () => {},
  }));
  assert.match(render("canonical_verified"), /src="\/api\/source-media\/videos\/video-one\/download\?preview=1"/);
  assert.match(render(null), /src="\/api\/source-media\/video-one"/);
});
