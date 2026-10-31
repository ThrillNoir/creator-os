import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// A local extraction primitive. It has no Cloudflare credentials or side effects on import.
// The storage adapter supplies creator-scoped reads and a conditional D1 poster update.
const exec = promisify(execFile);
export const MAX_VIDEO_BYTES = 5 * 1024 ** 3;
export const MAX_POSTER_BYTES = 12 * 1024 ** 2;
export const MAX_VIDEO_PIXELS = 40_000_000;
const SOURCE_IDLE_MS = 30_000;
const SOURCE_TOTAL_MS = 30 * 60_000;
const CREATOR = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ASSET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODECS = new Set(["h264", "h265"]);

function fail(code) { throw new Error(code); }
function digest(input) { return createHash("sha256").update(input).digest("hex"); }
function discard(stream) {
  if (typeof stream?.destroy === "function") stream.destroy();
  else if (typeof stream?.cancel === "function") void stream.cancel().catch(() => {});
}
async function bounded(promise, ms, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
function sameSource(a, b) {
  return a.creatorId === b.creatorId && a.assetId === b.assetId && a.sourceKey === b.sourceKey
    && a.sourceRevision === b.sourceRevision && a.etag === b.etag && a.version === b.version
    && a.bytes === b.bytes && a.codec === b.codec && a.state === b.state;
}
function validateSource(source, creatorId, assetId) {
  if (!source || source.creatorId !== creatorId || source.assetId !== assetId
    || !CREATOR.test(creatorId) || !ASSET.test(assetId)) fail("source_identity_invalid");
  if (source.state !== "canonical_verified" || !CODECS.has(source.codec)
    || typeof source.sourceKey !== "string" || !source.sourceKey || source.sourceKey.includes("..")
    || typeof source.sourceRevision !== "string" || !source.sourceRevision
    || typeof source.etag !== "string" || !source.etag
    || typeof source.version !== "string" || !source.version
    || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > MAX_VIDEO_BYTES) fail("source_not_verified");
  if (source.posterKey != null && (typeof source.posterKey !== "string" || !source.posterKey)) fail("poster_state_invalid");
}
async function probe(path) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,duration", "-of", "json", path],
  { timeout: 30_000, maxBuffer: 64 * 1024 });
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream || !Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height)
    || stream.width < 1 || stream.height < 1 || stream.width * stream.height > MAX_VIDEO_PIXELS) fail("video_probe_failed");
  return stream;
}

export async function prepareVideoThumbnail({ creatorId, assetId, loadSource, openSource, ffmpeg = "ffmpeg" }) {
  const source = await bounded(loadSource(creatorId, assetId), SOURCE_IDLE_MS, "source_lookup_timeout");
  validateSource(source, creatorId, assetId);
  if (source.posterKey) return { status: "existing_poster" };
  const directory = await mkdtemp(join(tmpdir(), `thot-poster-${process.pid}-`));
  const inputPath = join(directory, "source.mp4");
  const outputPath = join(directory, "poster.jpg");
  try {
    // The read adapter must use conditional R2 reads against this exact verified object.
    const controller = new AbortController();
    const opened = await bounded(openSource(source, { signal: controller.signal }), SOURCE_IDLE_MS, "source_open_timeout")
      .catch((error) => { controller.abort(); throw error; });
    if (!opened || opened.sourceKey !== source.sourceKey || opened.etag !== source.etag
      || opened.version !== source.version || opened.bytes !== source.bytes || !opened.stream) {
      controller.abort();
      discard(opened?.stream);
      fail("source_changed");
    }
    if (typeof opened.stream[Symbol.asyncIterator] !== "function") {
      controller.abort();
      discard(opened.stream);
      fail("source_stream_invalid");
    }
    const handle = await open(inputPath, "wx", 0o600).catch((error) => {
      controller.abort();
      discard(opened.stream);
      throw error;
    });
    let length = 0;
    const started = Date.now();
    try {
      const iterator = opened.stream[Symbol.asyncIterator]();
      for (;;) {
        const next = await bounded(iterator.next(), Math.min(SOURCE_IDLE_MS,
          Math.max(1, SOURCE_TOTAL_MS - (Date.now() - started))), "source_read_timeout");
        if (next.done) break;
        const chunk = next.value;
        if (!(chunk instanceof Uint8Array) || !chunk.byteLength) fail("source_stream_invalid");
        length += chunk.byteLength;
        if (length > source.bytes || length > MAX_VIDEO_BYTES) fail("source_size_mismatch");
        await handle.writeFile(chunk);
      }
    } catch (error) {
      controller.abort();
      discard(opened.stream);
      throw error;
    } finally { await handle.close(); }
    if (length !== source.bytes) fail("source_size_mismatch");
    const video = await probe(inputPath);
    if ((video.codec_name === "hevc" ? "h265" : video.codec_name) !== source.codec) fail("source_codec_mismatch");
    const extract = (seek) => exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", seek,
      "-i", inputPath, "-threads", "2", "-filter_threads", "2", "-frames:v", "1", "-vf", "scale=960:960:force_original_aspect_ratio=decrease",
      "-q:v", "3", "-y", outputPath], { timeout: 120_000, maxBuffer: 64 * 1024 });
    const seek = Number(video.duration) > 0 && Number(video.duration) < 1 ? "0" : "1";
    await extract(seek);
    if (seek === "1" && (await stat(outputPath).catch(() => null))?.size == null) await extract("0");
    const info = await stat(outputPath);
    if (!info.size || info.size > MAX_POSTER_BYTES) fail("poster_size_invalid");
    const image = await probe(outputPath);
    if (image.codec_name !== "mjpeg" || image.width > 960 || image.height > 960) fail("poster_format_invalid");
    const bytes = await readFile(outputPath);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail("poster_format_invalid");
    const objectId = digest(`${creatorId}:${assetId}`);
    return { status: "prepared", source, poster: { bytes, width: image.width, height: image.height,
      key: `creators/${creatorId}/assets/${objectId}/previews/${digest(bytes)}.jpg`, objectId } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function generateVideoThumbnail(input) {
  if (typeof input.commitPosterIfUnchanged !== "function") fail("conditional_writer_required");
  const result = await prepareVideoThumbnail(input);
  if (result.status !== "prepared") return result;
  const current = await bounded(input.loadSource(input.creatorId, input.assetId), SOURCE_IDLE_MS, "source_lookup_timeout");
  validateSource(current, input.creatorId, input.assetId);
  if (current.posterKey) return { status: "existing_poster" };
  if (!sameSource(result.source, current)) return { status: "source_changed" };
  // The adapter must recheck source identity, write one private JPEG, and use a D1
  // compare-and-swap for preview_r2_key IS NULL. R2 and D1 are not one transaction.
  const committed = await input.commitPosterIfUnchanged(result.source, result.poster);
  if (committed !== true) return { status: "changed_before_commit" };
  return { status: "committed", key: result.poster.key };
}
