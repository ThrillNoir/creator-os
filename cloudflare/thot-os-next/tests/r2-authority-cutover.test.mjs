import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("private delivery accepts only creator-scoped verified R2 authority", async () => {
  const [delivery, preview, reddit, vault] = await Promise.all([
    source("src/app/api/source-media/[assetId]/route.ts"),
    source("src/app/api/preview/[objectId]/route.ts"),
    source("../reddit-scheduler/src/index.ts"),
    source("../vault-bridge/src/index.ts"),
  ]);
  for (const runtime of [delivery, reddit, vault]) {
    assert.match(runtime, /authority_kind='r2_native'/);
    assert.match(runtime, /o\.object_key=a\.media_r2_key/);
    assert.doesNotMatch(runtime, /dropbox/i);
  }
  assert.match(delivery, /o\.creator_id=\? AND o\.asset_id=\?/);
  assert.match(delivery, /source_object_not_verified/);
  assert.match(preview, /ma\.authority_kind='r2_native'/);
  assert.match(preview, /not_found/);
});

test("image and video finalization persist the authoritative R2 key", async () => {
  const [image, video, uploader] = await Promise.all([
    source("src/app/api/source-media/intents/[sessionId]/finalize/route.ts"),
    source("src/app/api/source-media/videos/intents/[sessionId]/finalize/route.ts"),
    source("src/components/native-video-uploader.tsx"),
  ]);
  for (const finalize of [image, video]) assert.match(finalize, /UPDATE assets SET media_r2_key=\?/);
  assert.match(image, /queue\?\.send/);
  assert.match(uploader, /source_media_byte_mismatch/);
  assert.match(uploader, /session_finalizing/);
});
