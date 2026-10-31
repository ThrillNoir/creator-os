import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prepareVideoThumbnail } from "./video-thumbnail-local.mjs";

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "thot-large-hevc-"));
try {
  const clip = join(directory, "clip.mp4");
  const video = join(directory, "large-hevc.mp4");
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=640x360:rate=30", "-vf", "noise=alls=70:allf=t", "-t", "2", "-threads", "2",
    "-c:v", "libx265", "-preset", "ultrafast",
    "-x265-params", "lossless=1:log-level=error:pools=2:frame-threads=2", "-y", clip],
  { timeout: 60_000, maxBuffer: 64 * 1024 });
  const { size: clipSize } = await stat(clip);
  const repeats = Math.ceil((101 * 1024 ** 2) / clipSize);
  const list = join(directory, "list.txt");
  await writeFile(list, Array.from({ length: repeats }, () => "file 'clip.mp4'").join("\n") + "\n");
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", list, "-c", "copy", "-y", video], { timeout: 60_000, maxBuffer: 64 * 1024 });
  const { size } = await stat(video);
  assert.ok(size > 100 * 1024 ** 2, `synthetic HEVC input is only ${size} bytes`);
  const creatorId = "synthetic-creator";
  const assetId = "12345678-1234-4123-8123-123456789abc";
  const source = { creatorId, assetId, sourceKey: "synthetic/large-hevc.mp4",
    sourceRevision: "synthetic:large-hevc-1", etag: "synthetic-etag", version: "synthetic-version",
    bytes: size, codec: "h265", state: "canonical_verified", posterKey: null };
  const start = Date.now();
  const result = await prepareVideoThumbnail({ creatorId, assetId,
    loadSource: async () => source,
    openSource: async () => ({ sourceKey: source.sourceKey, etag: source.etag, version: source.version,
      bytes: size, stream: createReadStream(video) }) });
  assert.equal(result.status, "prepared");
  assert.ok(result.poster.bytes.length > 0 && result.poster.bytes.length <= 12 * 1024 ** 2);
  process.stdout.write(`large synthetic HEVC: ${size} bytes, ${repeats} encoded segments, ${result.poster.width}x${result.poster.height} JPEG, ${Date.now() - start} ms; no storage write\n`);
} finally { await rm(directory, { recursive: true, force: true }); }
