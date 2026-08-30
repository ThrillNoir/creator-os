import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { IncrementalSha256 } from "../src/lib/incremental-sha256.ts";
import { IsoBmffValidator } from "../src/lib/iso-bmff-validator.ts";
import { canonicalR2MultipartPartEtag } from "../src/lib/r2-multipart-etag.ts";
import { completedR2MultipartEtag, validateR2VideoMetadata } from "../src/lib/r2-video-metadata.ts";
import { detectedMime, parseSingleRange } from "../src/lib/source-media-algorithms.ts";
import { canStartVideoPlaybackPoll, hasPendingVideoPlayback, nextVideoPlaybackDelayIndex, videoPlaybackDelay } from "../src/lib/video-playback-polling.ts";

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

test("completed multipart video verification reads metadata instead of the media payload", async () => {
  const bytes = join(
    box("ftyp", encoder.encode("isom\u0000\u0000\u0000\u0000avc1mp41")),
    box("moov", encoder.encode("avc1")),
    box("mdat", new Uint8Array(1024 * 1024)),
  );
  const midpoint = Math.floor(bytes.length / 2);
  const partEtags = [bytes.slice(0, midpoint), bytes.slice(midpoint)].map((part) => createHash("md5").update(part).digest("hex"));
  const multipartEtag = completedR2MultipartEtag(partEtags);
  assert.ok(multipartEtag);
  const sha256 = "a".repeat(64);
  const metadata = {
    size: bytes.length,
    etag: multipartEtag,
    version: "version-1",
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: { expected_sha256: sha256, creator_id: "creator-1", asset_id: "asset-1", source_session: "session-1" },
  };
  const ranges = [];
  const bucket = {
    head: async () => metadata,
    get: async (_key, options) => {
      assert.equal(options.onlyIf.etagMatches, multipartEtag);
      ranges.push(options.range);
      const value = bytes.slice(options.range.offset, options.range.offset + options.range.length);
      return { ...metadata, body: new Blob([value]).stream(), arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) };
    },
  };
  const verified = await validateR2VideoMetadata(bucket, "private-key", { assetId: "asset-1", bytes: bytes.length, creatorId: "creator-1", mimeType: "video/mp4", multipartEtag, sessionId: "session-1", sha256 });
  assert.equal(verified.codec, "h264");
  assert.ok(ranges.reduce((total, range) => total + range.length, 0) < bytes.length / 10);
  await assert.rejects(() => validateR2VideoMetadata({ ...bucket, head: async () => ({ ...metadata, size: bytes.length - 1 }) }, "private-key", { assetId: "asset-1", bytes: bytes.length, creatorId: "creator-1", mimeType: "video/mp4", multipartEtag, sessionId: "session-1", sha256 }), /source_media_byte_mismatch/);
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

test("video playback polling is single-flight eligible only for accepted processing work", () => {
  const pending = { total: 2, ready: 0, queued: 1, processing: 1, failed: 0 };
  assert.equal(hasPendingVideoPlayback(pending), true);
  assert.equal(canStartVideoPlaybackPoll({ progress: pending, visible: true, online: true, inFlight: false }), true);
  assert.equal(canStartVideoPlaybackPoll({ progress: pending, visible: false, online: true, inFlight: false }), false);
  assert.equal(canStartVideoPlaybackPoll({ progress: { ...pending, processing: 0 }, visible: true, online: true, inFlight: false }), false);
  assert.equal(videoPlaybackDelay(0), 5_000);
  assert.equal(videoPlaybackDelay(3), 60_000);
  assert.equal(nextVideoPlaybackDelayIndex(2, true), 0);
});

test("native video routes are creator-scoped, direct-to-R2, private, and do not provision playback", async () => {
  const [migration, media, validator, intent, part, authorize, confirm, failure, lifecycle, signer, finalize, download, uploader, assetCard, playbackStart, playbackStatus, playbackToken, streamPlayback, lazyUploader, libraryPage, library, health, wrangler] = await Promise.all([
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
    source("src/app/api/source-media/videos/[assetId]/playback/route.ts"),
    source("src/app/api/library/video-playback-status/route.ts"),
    source("src/app/api/source-media/videos/[assetId]/playback-token/route.ts"),
    source("src/lib/stream-playback.ts"),
    source("src/components/lazy-native-video-uploader.tsx"),
    source("src/app/library/page.tsx"),
    source("src/lib/library.ts"),
    source("src/app/health/route.ts"),
    source("wrangler.jsonc"),
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
  assert.match(finalize, /validateR2VideoMetadata/);
  assert.match(finalize, /completedR2MultipartEtag/);
  assert.doesNotMatch(finalize, /hashAndValidateR2Object/);
  assert.match(finalize, /source_media_byte_mismatch/);
  assert.doesNotMatch(finalize, /fansly|vault/i);
  assert.match(finalize, /playback_provider='none'/);
  assert.match(download, /requireCreatorContext\("view"\)/);
  assert.match(download, /parseSingleRange/);
  assert.match(download, /immutableR2IdentityMatches/);
  assert.match(uploader, /sha256File/);
  assert.match(uploader, /sessionStorage/);
  assert.match(uploader, /\/api\/source-media\/videos\/intents/);
  assert.match(uploader, /credentials: "omit"/);
  assert.match(uploader, /completion_requires_reconciliation/);
  assert.match(uploader, /finalized\.error \?\? "session_finalizing"/);
  assert.match(uploader, /\["finalized", "finalizing"\]/);
  assert.doesNotMatch(uploader, /"session_failed", "completion_requires_reconciliation"/);
  assert.match(intent, /existing\.status === "finalized" \? "finalized" : existing\.finalization_state === "incomplete" \? existing\.status : "finalizing"/);
  assert.doesNotMatch(wrangler, /"cpu_ms"/);
  assert.match(uploader, /canonicalR2MultipartPartEtag/);
  assert.match(assetCard, /Video upload finalization failed/);
  assert.match(assetCard, /browser playback can be prepared/);
  assert.match(assetCard, /PrivateStreamPlayer/);
  const player = await source("src/components/private-stream-player.tsx");
  assert.match(player, /body\.error !== "playback_already_submitted"/);
  assert.match(playbackStart, /isSameOriginRequest/);
  assert.match(playbackStart, /requireCreatorContext\("mutate"\)/);
  assert.match(playbackStart, /STREAM!\.upload/);
  assert.doesNotMatch(playbackStart, /LIBRARY_MEDIA\.get|arrayBuffer|\.body/);
  assert.match(playbackStart, /stream_submission_uncertain/);
  assert.match(playbackStart, /creator_id=\?/);
  assert.match(playbackStart, /creatoros\.video_playback_submission/);
  assert.match(playbackStatus, /MAX_PROVIDER_STATUS_READS = 4/);
  assert.match(playbackStatus, /requireCreatorContext\("mutate"\)/);
  assert.match(playbackStatus, /state='processing'/);
  assert.match(playbackStatus, /creatoros\.video_playback_status/);
  assert.match(playbackToken, /requireCreatorContext\("view"\)/);
  assert.match(playbackToken, /generateToken/);
  assert.match(playbackToken, /creator_id=\?/);
  assert.match(playbackToken, /creatoros\.video_playback_token/);
  assert.doesNotMatch(playbackToken, /INSERT\s+INTO/);
  assert.doesNotMatch(playbackToken, /JSON\.stringify\(\{[^\n]*\b(token|iframeUrl)\s*:/);
  assert.match(streamPlayback, /requireSignedURLs: true/);
  assert.match(streamPlayback, /presignCanonicalVideoRead/);
  assert.match(streamPlayback, /endsWith\("\.cloudflarestream\.com"\)/);
  assert.match(streamPlayback, /stream_submission_uncertain/);
  assert.doesNotMatch(streamPlayback, /console\.log/);
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
