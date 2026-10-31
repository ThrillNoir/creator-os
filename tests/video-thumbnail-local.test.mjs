import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateVideoThumbnail, prepareVideoThumbnail } from "../scripts/video-thumbnail-local.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function makeVideo(path, encoder) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=320x180:rate=12", "-t", "2", "-threads", "2", "-c:v", encoder,
    "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-y", path], { timeout: 60_000, stdio: "ignore" });
}

function fixture(path, bytes, creatorId, assetId, codec) {
  const source = { creatorId, assetId, sourceKey: `private/${assetId}`, sourceRevision: "native_video:synthetic-1",
    etag: `etag-${assetId}`, version: "r2-version-1", bytes, codec, state: "canonical_verified", posterKey: null };
  let opens = 0;
  let writes = 0;
  const adapter = { creatorId, assetId,
    loadSource: async (requestedCreator, requestedAsset) => {
      assert.equal(requestedCreator, creatorId);
      assert.equal(requestedAsset, assetId);
      return { ...source };
    },
    openSource: async (expected) => {
      opens++;
      assert.equal(expected.creatorId, creatorId);
      return { sourceKey: source.sourceKey, etag: source.etag, version: source.version, bytes, stream: createReadStream(path) };
    },
    commitPosterIfUnchanged: async (expected, poster) => {
      writes++;
      assert.equal(expected.creatorId, creatorId);
      assert.equal(expected.assetId, assetId);
      assert.equal(source.posterKey, null);
      assert.match(poster.key, new RegExp(`^creators/${creatorId}/assets/[0-9a-f]{64}/previews/[0-9a-f]{64}\\.jpg$`));
      assert.equal(poster.bytes[0], 0xff);
      source.posterKey = poster.key;
      return true;
    },
  };
  return { adapter, source, get opens() { return opens; }, get writes() { return writes; } };
}

test("extracts H.264 and H.265, isolates creators, and never replaces an existing/manual poster", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-test-"));
  try {
    for (const [creatorId, assetId, encoder, codec] of [["creator-one", A, "libx264", "h264"], ["creator-two", B, "libx265", "h265"]]) {
      const path = join(directory, `${codec}.mp4`);
      makeVideo(path, encoder);
      const { size } = await stat(path);
      const f = fixture(path, size, creatorId, assetId, codec);
      const first = await generateVideoThumbnail(f.adapter);
      assert.equal(first.status, "committed");
      assert.equal(f.opens, 1);
      assert.equal(f.writes, 1);
      assert.equal((await generateVideoThumbnail(f.adapter)).status, "existing_poster");
      assert.equal(f.opens, 1);
      assert.equal(f.writes, 1);
      f.source.posterKey = "creators/creator-one/assets/manual.jpg";
      assert.equal((await generateVideoThumbnail(f.adapter)).status, "existing_poster");
      assert.equal(f.opens, 1);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects mismatched identity, codec and changed source without committing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-test-"));
  try {
    const path = join(directory, "sample.mp4");
    makeVideo(path, "libx264");
    const { size } = await stat(path);
    const f = fixture(path, size, "creator-one", A, "h264");
    await assert.rejects(prepareVideoThumbnail({ ...f.adapter, creatorId: "creator-two", loadSource: async () => ({ ...f.source }) }), /source_identity_invalid/);
    f.source.codec = "h265";
    await assert.rejects(prepareVideoThumbnail(f.adapter), /source_codec_mismatch/);
    f.source.codec = "h264";
    f.adapter.openSource = async () => ({ sourceKey: "another-key", etag: f.source.etag,
      version: f.source.version, bytes: size, stream: createReadStream(path) });
    await assert.rejects(prepareVideoThumbnail(f.adapter), /source_changed/);
    assert.equal(f.writes, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("fails closed on truncated input, and skips if source or manual poster changes during extraction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-test-"));
  try {
    const path = join(directory, "sample.mp4");
    makeVideo(path, "libx265");
    const { size } = await stat(path);
    const f = fixture(path, size, "creator-one", A, "h265");
    f.source.bytes = size + 1;
    f.adapter.openSource = async () => ({ sourceKey: f.source.sourceKey, etag: f.source.etag,
      version: f.source.version, bytes: f.source.bytes, stream: createReadStream(path) });
    await assert.rejects(generateVideoThumbnail(f.adapter), /source_size_mismatch/);
    f.source.bytes = size;
    f.adapter.openSource = async () => {
      f.source.posterKey = "creators/creator-one/assets/manual.jpg";
      return { sourceKey: f.source.sourceKey, etag: f.source.etag, version: f.source.version,
        bytes: size, stream: createReadStream(path) };
    };
    assert.equal((await generateVideoThumbnail(f.adapter)).status, "existing_poster");
    assert.equal(f.writes, 0);
    f.source.posterKey = null;
    f.adapter.openSource = async () => {
      const opened = { sourceKey: f.source.sourceKey, etag: f.source.etag,
        version: f.source.version, bytes: size, stream: createReadStream(path) };
      f.source.sourceRevision = "native_video:synthetic-2";
      return opened;
    };
    assert.equal((await generateVideoThumbnail(f.adapter)).status, "source_changed");
    assert.equal(f.writes, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("conditional writer rejection does not claim a committed poster", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thot-poster-test-"));
  try {
    const path = join(directory, "sample.mp4");
    makeVideo(path, "libx264");
    const { size } = await stat(path);
    const f = fixture(path, size, "creator-one", A, "h264");
    f.adapter.commitPosterIfUnchanged = async () => false;
    assert.equal((await generateVideoThumbnail(f.adapter)).status, "changed_before_commit");
    assert.equal(f.source.posterKey, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
