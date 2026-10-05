import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const component = await readFile(new URL("../src/components/native-media-uploader.tsx", import.meta.url), "utf8");
const typeSource = component.match(/type UploadItem =[\s\S]*?\n/)[0] + component.match(/type IntentResponse =[\s\S]*?\n/)[0] + component.match(/type FinalizeResponse =[\s\S]*?\n/)[0] + component.match(/type FinalizeRecoveryDependencies =[\s\S]*?\n};/)[0];
const functionSource = ["finalizeSavedNativeImage", "retryNativeImagePreview", "resumeNativeImageIntent"].map((name) => {
  const match = component.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n}`));
  assert.ok(match, `${name} exists`);
  return match[0];
}).join("\n");
const compiled = ts.transpileModule(`${typeSource}\n${functionSource}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function("exports", `const resumeFinalizationStates = new Set(["completing", "completed_unreconciled", "verifying", "verified"]); const terminalFinalizationStates = new Set(["failed", "quarantined", "expired", "aborted"]);\n${compiled}`)(moduleExports);
const { finalizeSavedNativeImage, retryNativeImagePreview, resumeNativeImageIntent } = moduleExports;

function fixture(fetcher) {
  const changes = [];
  const removed = [];
  const calls = [];
  let refreshes = 0;
  const item = { id: "img-1", file: { name: "photo.jpg" }, status: "attention", detail: "preview failed", progress: 100, sessionId: "session-1", sourceHash: "hash-1" };
  const dependencies = {
    fetcher: async (...args) => { calls.push(args); return fetcher(...args); },
    parse: async (response) => response.json(),
    update: (id, patch) => changes.push({ id, patch }),
    removeSession: (hash) => removed.push(hash),
    refresh: () => { refreshes += 1; },
  };
  return { item, dependencies, changes, removed, calls, refreshCount: () => refreshes };
}

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

test("preview retry network rejection returns to retryable attention and preserves resume identity", async () => {
  const state = fixture(async () => { throw new TypeError("network unavailable"); });
  await retryNativeImagePreview(state.item, state.dependencies);
  assert.deepEqual(state.calls.map(([url]) => url), ["/api/source-media/intents/session-1/finalize"]);
  assert.equal(state.changes.at(-1).patch.status, "attention");
  assert.match(state.changes.at(-1).patch.detail, /preview retry failed/i);
  assert.deepEqual(state.removed, []);
  assert.equal(state.refreshCount(), 0);
});

test("successful finalize with unavailable preview refreshes the catalog and keeps the original retry session", async () => {
  const state = fixture(async () => jsonResponse({ ok: true, preview: "failed" }));
  await finalizeSavedNativeImage(state.item, state.item.sessionId, state.item.sourceHash, "Original saved; preview retry needed.", state.dependencies);
  assert.deepEqual(state.calls.map(([url]) => url), ["/api/source-media/intents/session-1/finalize"]);
  assert.equal(state.changes.at(-1).patch.status, "attention");
  assert.deepEqual(state.removed, []);
  assert.equal(state.refreshCount(), 1);
});

test("ready preview removes the resumable key, completes the item and refreshes the catalog", async () => {
  const state = fixture(async () => jsonResponse({ ok: true, preview: "ready" }));
  await finalizeSavedNativeImage(state.item, state.item.sessionId, state.item.sourceHash, "unused", state.dependencies);
  assert.equal(state.changes.at(-1).patch.status, "complete");
  assert.deepEqual(state.removed, ["hash-1"]);
  assert.equal(state.refreshCount(), 1);
});

test("replayed completing intent finalizes directly and never uploads another part", async () => {
  const state = fixture(async () => jsonResponse({ ok: true, preview: "ready" }));
  let parts = 0;
  const outcome = await resumeNativeImageIntent(state.item, {
    ok: true, replay: true, sessionId: state.item.sessionId, status: "uploading", finalizationState: "completing", partBytes: 1024,
  }, state.item.sourceHash, state.dependencies, async () => { parts++; });
  assert.equal(outcome, "finalized");
  assert.equal(parts, 0);
  assert.deepEqual(state.calls.map(([url]) => url), ["/api/source-media/intents/session-1/finalize"]);
});

test("quarantined replay remains terminal and does not upload parts", async () => {
  const state = fixture(async () => { throw new Error("finalize should not run"); });
  let parts = 0;
  await assert.rejects(resumeNativeImageIntent(state.item, {
    ok: true, replay: true, sessionId: state.item.sessionId, status: "failed", finalizationState: "quarantined",
  }, state.item.sourceHash, state.dependencies, async () => { parts++; }), /session_quarantined/);
  assert.equal(parts, 0);
  assert.equal(state.calls.length, 0);
});

test("uncertain finalize failure keeps retry identity and retries finalize without parts", async () => {
  const state = fixture(async () => { throw new TypeError("connection lost after request"); });
  let parts = 0;
  const intent = { ok: true, replay: true, sessionId: state.item.sessionId, status: "uploading", finalizationState: "completed_unreconciled", partBytes: 1024 };
  await assert.rejects(resumeNativeImageIntent(state.item, intent, state.item.sourceHash, state.dependencies, async () => { parts++; }));
  assert.deepEqual(state.removed, []);
  state.dependencies.fetcher = async (...args) => { state.calls.push(args); return jsonResponse({ ok: true, preview: "ready" }); };
  const result = await resumeNativeImageIntent(state.item, intent, state.item.sourceHash, state.dependencies, async () => { parts++; });
  assert.equal(result, "finalized");
  assert.equal(parts, 0);
  assert.deepEqual(state.calls.map(([url]) => url), ["/api/source-media/intents/session-1/finalize", "/api/source-media/intents/session-1/finalize"]);
  assert.deepEqual(state.removed, ["hash-1"]);
});
