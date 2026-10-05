import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const source = await readFile(new URL("../src/app/api/source-media/native/intents/route.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function POST(");
assert.ok(start >= 0, "native image intent POST handler exists");
const handlerJs = ts.transpileModule(source.slice(start).replace("export async function", "async function"), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function loadHandler(existing) {
  const statements = [];
  const DB = {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        async first() { return existing; },
      };
    },
    async batch() { throw new Error("replay must not create another original"); },
  };
  const cloudflareEnv = () => ({ DB, LIBRARY_MEDIA: {} });
  const noStoreJson = (body, status = 200) => Response.json(body, { status });
  const nativeImageDetails = () => ({ filename: "photo.jpg", extension: "jpg", mimeType: "image/jpeg" });
  const validClientUploadId = (value) => typeof value === "string" && value.length > 0;
  const isSameOriginRequest = () => true;
  const rejectClientActorRole = () => {};
  const requireCreatorContext = async () => ({ creator: { creator_id: "creator-a", role: "owner" }, email: "owner@example.test" });
  const constants = { SOURCE_MEDIA_MAX_IMAGE_BYTES: 1000000, SOURCE_MEDIA_SESSION_MINUTES: 30 };
  const isSha256 = (value) => /^[a-f0-9]{64}$/.test(value);
  const multipartPartSize = () => 1024;
  const privateOriginalKey = () => "private-key";
  const validSourceFilename = () => true;
  const humanAuditActor = () => ({});
  const identityAuditStatement = () => ({});
  const Async = new AsyncFunction(
    "isSameOriginRequest", "noStoreJson", "nativeImageDetails", "validClientUploadId", "SOURCE_MEDIA_MAX_IMAGE_BYTES",
    "isSha256", "requireCreatorContext", "cloudflareEnv", "SOURCE_MEDIA_SESSION_MINUTES", "multipartPartSize",
    "validSourceFilename", "privateOriginalKey", "crypto", "rejectClientActorRole", "humanAuditActor", "identityAuditStatement", "request",
    `${handlerJs}\nreturn POST(request);`,
  );
  return { invoke: (request) => Async(isSameOriginRequest, noStoreJson, nativeImageDetails, validClientUploadId, constants.SOURCE_MEDIA_MAX_IMAGE_BYTES,
    isSha256, requireCreatorContext, cloudflareEnv, constants.SOURCE_MEDIA_SESSION_MINUTES, multipartPartSize, validSourceFilename,
    privateOriginalKey, globalThis.crypto, rejectClientActorRole, humanAuditActor, identityAuditStatement, request), statements };
}

test("intent replay exposes finalization state and reuses the existing original session", async () => {
  const fixture = await loadHandler({
    id: "session-1", asset_id: "asset-1", status: "uploading", finalization_state: "completed_unreconciled",
    expected_bytes: 42, expected_mime_type: "image/jpeg", expected_sha256: "a".repeat(64), chunk_bytes: 1024,
  });
  const request = new Request("https://creator.example.test/api/source-media/native/intents", {
    method: "POST", body: JSON.stringify({ filename: "photo.jpg", bytes: 42, sha256: "a".repeat(64), mimeType: "image/jpeg", clientUploadId: "client-upload-1" }),
  });
  const response = await fixture.invoke(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.replay, true);
  assert.equal(body.sessionId, "session-1");
  assert.equal(body.finalizationState, "completed_unreconciled");
  assert.equal(fixture.statements.length, 1);
  assert.match(fixture.statements[0], /SELECT id,asset_id,status,finalization_state/);
});
