import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
async function source(relative) { return readFile(new URL(relative, root), "utf8"); }

test("private source-media ingestion is creator-scoped, no-store, and multipart verified", async () => {
  const [migration, helpers, intent, part, finalize, cutover, delivery] = await Promise.all([
    source("../thot-os-app/migrations/0050_r2_native_source_media.sql"),
    source("src/lib/source-media.ts"),
    source("src/app/api/source-media/intents/route.ts"),
    source("src/app/api/source-media/intents/[sessionId]/parts/[partNumber]/route.ts"),
    source("src/app/api/source-media/intents/[sessionId]/finalize/route.ts"),
    source("src/app/api/source-media/cutover/route.ts"),
    source("src/app/api/source-media/[assetId]/route.ts"),
  ]);
  for (const table of ["creator_media_source_states", "asset_ingest_parts", "creator_media_source_events"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /asset_ingest_part_creator_mismatch/);
  assert.match(migration, /creator_media_source_event_creator_mismatch/);
  assert.match(helpers, /createHash\("sha256"\)/);
  assert.match(helpers, /private, no-store/);
  assert.match(intent, /isSameOriginRequest/);
  assert.match(intent, /requireCreatorContext\("mutate"\)/);
  assert.match(intent, /asset\.basename !== filename/);
  assert.match(intent, /createMultipartUpload/);
  assert.doesNotMatch(intent, /presign|signedUrl|objectKey:\s*objectKey/i);
  assert.ok(part.indexOf("INSERT OR IGNORE INTO asset_ingest_parts") < part.indexOf("uploadPart"));
  assert.match(part, /part_replayed/);
  assert.match(finalize, /hashAndDetectR2Object/);
  assert.match(finalize, /source_media_verification_failed/);
  assert.match(finalize, /multipart_upload_id=NULL/);
  assert.match(cutover, /verified_inventory_required/);
  assert.match(cutover, /active_backend='r2'/);
  assert.match(cutover, /active_backend='dropbox'/);
  assert.match(delivery, /active_backend !== "r2"/);
  assert.match(delivery, /source_object_integrity_failed/);
});

test("paired device delivery follows an explicit R2 cutover and never redirects an original", async () => {
  const bridge = await source("../vault-bridge/src/index.ts");
  const flow = bridge.slice(bridge.indexOf("async function resolveCreatorMedia"), bridge.indexOf("async function recordReceipt"));
  assert.match(flow, /creator_media_source_states/);
  assert.match(flow, /active_backend === "r2"/);
  assert.match(flow, /r2_source_media_integrity_failed/);
  assert.match(flow, /resolvedMediaResponse/);
  assert.doesNotMatch(flow, /status:\s*302|location:\s*temporary\.link/);
  assert.match(flow, /cache-control.*private, no-store/);
});
