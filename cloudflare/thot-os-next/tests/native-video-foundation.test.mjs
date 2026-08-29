import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { IncrementalSha256 } from "../src/lib/incremental-sha256.ts";
import { IsoBmffValidator } from "../src/lib/iso-bmff-validator.ts";
import { canonicalR2MultipartPartEtag } from "../src/lib/r2-multipart-etag.ts";
import { detectedMime, parseSingleRange } from "../src/lib/source-media-algorithms.ts";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const encoder = new TextEncoder();

function u32(value) { return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]); }
function join(...parts) { const length = parts.reduce((sum, part) => sum + part.length, 0); const result = new Uint8Array(length); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function box(type, payload = new Uint8Array()) { return join(u32(payload.length + 8), encoder.encode(type), payload); }
function videoFixture(codec, quicktime = false) {
  const major = quicktime ? "qt  " : "isom";
  const ftyp = box("ftyp", encoder.encode(`${major}\u0000\u0000\u0000\u0000${codec}mp41`));
  return join(ftyp, box("moov", encoder.encode(codec)), box("mdat", new Uint8Array([0])));
}

test("H.264 and H.265 container fixtures are accepted only as private canonical video inputs", async () => {
  const h264Bytes = videoFixture("avc1"); const h265Bytes = videoFixture("hvc1", true);
  assert.equal(detectedMime(h264Bytes), "video/mp4");
  assert.equal(detectedMime(h265Bytes), "video/quicktime");
  assert.equal(detectedMime(new Uint8Array([1, 2, 3])), "");
  const h264 = new IsoBmffValidator("video/mp4"); h264.push(h264Bytes.slice(0, 13)); h264.push(h264Bytes.slice(13));
  const h265 = new IsoBmffValidator("video/quicktime"); h265.push(h265Bytes);
  assert.equal(h264.finish(), "h264");
  assert.equal(h265.finish(), "h265");
  const truncated = new IsoBmffValidator("video/mp4"); truncated.push(box("ftyp", encoder.encode("isom\u0000\u0000\u0000\u0000avc1mp41")));
  assert.throws(() => truncated.finish(), /source_media_container_invalid/);
  const spoofedPayload = new IsoBmffValidator("video/mp4");
  spoofedPayload.push(join(box("ftyp", encoder.encode("isom\u0000\u0000\u0000\u0000avc1mp41")), box("moov", encoder.encode("xxxx")), box("mdat", encoder.encode("hvc1"))));
  assert.throws(() => spoofedPayload.finish(), /source_media_video_codec_unsupported/);
});

test("browser hashing is incremental and range parsing stays bounded", () => {
  const hash = new IncrementalSha256();
  for (const value of ["a", "b", "c"]) hash.update(encoder.encode(value));
  assert.equal(hash.digestHex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.deepEqual(parseSingleRange("bytes=4-9", 10), { offset: 4, length: 6 });
  assert.deepEqual(parseSingleRange("bytes=-3", 10), { offset: 7, length: 3 });
  assert.equal(parseSingleRange("bytes=10-11", 10), "invalid");
});

test("direct S3-style part ETags are normalized before Worker multipart completion", () => {
  const raw = "c6d9d5e54ee4a7f9fd5fd8f7ba6db2f9";
  assert.equal(canonicalR2MultipartPartEtag(`\"${raw}\"`), raw);
  assert.equal(canonicalR2MultipartPartEtag(raw.toUpperCase()), raw);
  assert.equal(canonicalR2MultipartPartEtag("not-an-etag"), null);
  assert.equal(canonicalR2MultipartPartEtag(`\"${raw}`), null);
});

test("native video routes are creator-scoped, direct-to-R2, private, and do not provision playback", async () => {
  const [migration, media, validator, intent, part, authorize, confirm, failure, lifecycle, signer, finalize, download, uploader, assetCard, lazyUploader, libraryPage, library, health] = await Promise.all([
    source("../thot-os-app/migrations/0054_native_video_intake.sql"),
    source("src/lib/source-media.ts"),
    source("src/lib/iso-bmff-validator.ts"),
    source("src/app/api/source-media/videos/intents/route.ts"),
    source("src/app/api/source-media/videos/intents/[sessionId]/parts/[partNumber]/route.ts"),
    source("src/app/api/source-media/videos/intents/[sessionId]/parts/[partNumber]/authorize/route.ts"),
    source("src/app/api/source-media/videos/intents/[sessionId]/parts/[partNumber]/confirm/route.ts"),
    source("src/app/api/source-media/videos/intents/[sessionId]/parts/[partNumber]/failure/route.ts"),
    source("src/lib/native-video-lifecycle.ts"),
    source("src/lib/r2-direct-video-upload.ts"),
    source("src/app/api/source-media/videos/intents/[sessionId]/finalize/route.ts"),
    source("src/app/api/source-media/videos/[assetId]/download/route.ts"),
    source("src/components/native-video-uploader.tsx"),
    source("src/components/asset-card.tsx"),
    source("src/components/lazy-native-video-uploader.tsx"),
    source("src/app/library/page.tsx"),
    source("src/lib/library.ts"),
    source("src/app/health/route.ts"),
  ]);
  for (const table of ["asset_video_ingest_sessions", "asset_video_ingest_parts", "asset_video_playback_states", "asset_video_ingest_events"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /asset_video_ingest_session_creator_mismatch/);
  assert.match(migration, /asset_video_playback_creator_mismatch/);
  assert.match(intent, /requireCreatorContext\("mutate"\)/);
  assert.match(intent, /SOURCE_MEDIA_MAX_ACTIVE_VIDEO_UPLOADS/);
  assert.match(intent, /expireAbandonedSessions/);
  assert.match(intent, /createMultipartUpload/);
  assert.doesNotMatch(intent, /STREAM_API|objectKey:\s*objectKey/i);
  assert.match(intent, /directVideoUploadsAvailable/);
  assert.match(part, /status: 405/);
  assert.doesNotMatch(part, /arrayBuffer|uploadPart/);
  assert.match(authorize, /expectedPartBytes/);
  assert.match(authorize, /presignVideoPartUpload/);
  assert.match(authorize, /part_in_progress/);
  assert.match(confirm, /canonicalR2MultipartPartEtag/);
  assert.match(failure, /direct_part_upload_failed/);
  assert.match(signer, /AwsClient/);
  assert.match(signer, /signQuery/);
  assert.match(signer, /R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY/);
  assert.match(lifecycle, /r2AbortBeforeD1|multipart identity/);
  assert.match(lifecycle, /source_available=0/);
  assert.match(media, /IsoBmffValidator/);
  assert.match(validator, /source_media_video_codec_unsupported/);
  assert.match(validator, /hvc1.*hev1/);
  assert.match(media, /private, no-store/);
  assert.match(finalize, /hashAndValidateR2Object/);
  assert.match(finalize, /source_media_verification_failed/);
  assert.match(finalize, /playback_provider='none'/);
  assert.match(download, /requireCreatorContext\("view"\)/);
  assert.match(download, /parseSingleRange/);
  assert.match(download, /immutableR2IdentityMatches/);
  assert.match(uploader, /sha256File/);
  assert.match(uploader, /sessionStorage/);
  assert.match(uploader, /\/api\/source-media\/videos\/intents/);
  assert.match(uploader, /credentials: "omit"/);
  assert.match(uploader, /completion_requires_reconciliation/);
  assert.match(uploader, /canonicalR2MultipartPartEtag/);
  assert.match(assetCard, /Video upload finalization failed/);
  assert.match(uploader, /\/authorize/);
  assert.match(uploader, /\/confirm/);
  assert.doesNotMatch(uploader, /\/parts\/\$\{partNumber\}\`, \{ method: "PUT", credentials: "same-origin"/);
  assert.match(health, /playback_provider_not_configured/);
  assert.doesNotMatch(uploader, /dropbox/i);
  assert.match(lazyUploader, /ssr:\s*false/);
  assert.match(libraryPage, /LazyNativeVideoUploader/);
  assert.match(libraryPage, /creatoros\.library_render/);
  assert.match(libraryPage, /durationMs/);
  assert.match(library, /DB\.batch/);
  assert.match(library, /getLibraryPageData/);
});
