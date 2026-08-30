import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("native image intake creates creator-scoped canonical R2 authority without Dropbox input", async () => {
  const [migration, intent, finalize, parts, library, uploader] = await Promise.all([
    source("../thot-os-app/migrations/0053_native_asset_authority.sql"),
    source("src/app/api/source-media/native/intents/route.ts"),
    source("src/app/api/source-media/intents/[sessionId]/finalize/route.ts"),
    source("src/app/api/source-media/intents/[sessionId]/parts/[partNumber]/route.ts"),
    source("src/lib/library.ts"),
    source("src/components/native-media-uploader.tsx"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_media_authorities/);
  assert.match(migration, /asset_media_authority_creator_mismatch/);
  assert.match(migration, /client_upload_id/);
  assert.match(intent, /requireCreatorContext\("mutate"\)/);
  assert.match(intent, /'canonical_original','library_media'/);
  assert.match(intent, /'r2_native','cloudflare_direct'/);
  assert.doesNotMatch(intent, /dropbox_revision|DROPBOX/i);
  assert.match(finalize, /ensureNativePreview/);
  assert.match(finalize, /state='canonical_verified'/);
  assert.match(parts, /session\.ingest_kind === "native_image"/);
  assert.match(library, /asset_media_authorities/);
  assert.match(library, /source === "native"/);
  assert.match(uploader, /\/api\/source-media\/native\/intents/);
  assert.match(uploader, /sessionStorage/);
  assert.doesNotMatch(uploader, /presign|signedUrl|objectKey/i);
});
