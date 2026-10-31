import assert from "node:assert/strict";
import test from "node:test";
import { readThumbnailCredential, runThumbnailKeyringCommand } from "../scripts/video-thumbnail-keyring.mjs";

const planArgs = ["--creator", "creator-one", "--plan"];
const applyArgs = ["--creator", "creator-one", "--apply", "thumbnail:0123456789abcdef"];

test("plan reads no write credentials and apply passes only named keyring values in process", async () => {
  const read = []; let received;
  const common = { readCredential: (service) => { read.push(service); return `synthetic-${service}`; },
    runCommand: async (input) => { received = input; return { ok: true }; } };
  await runThumbnailKeyringCommand({ ...common, argv: planArgs, baseEnv: {} });
  assert.deepEqual(read, []);
  await runThumbnailKeyringCommand({ ...common, argv: applyArgs, baseEnv: { THOT_THUMBNAIL_ALLOW_APPLY: "1" } });
  assert.equal(read.length, 5);
  assert.equal(received.env.THOT_THUMBNAIL_ALLOW_APPLY, "1");
  assert.equal(received.env.THOT_THUMBNAIL_SOURCE_R2_KEY_ID, "synthetic-thot-os-thumbnail-source-r2-key-id");
  assert.ok(!("THOT_THUMBNAIL_PREVIEW_R2_SECRET" in received.env));
});

test("invalid/timer arguments never read credentials; unsupported or missing secure store fails closed", async () => {
  let reads = 0;
  const readCredential = () => { reads++; return "synthetic"; };
  await assert.rejects(runThumbnailKeyringCommand({ argv: applyArgs, baseEnv: {}, readCredential }), /thumbnail_apply_not_enabled/);
  await assert.rejects(runThumbnailKeyringCommand({ argv: ["--creator", "../bad", "--apply", "thumbnail:0123456789abcdef"], readCredential }), /thumbnail_argument_invalid/);
  await assert.rejects(runThumbnailKeyringCommand({ argv: ["--creator", "creator-one", "--tick"], readCredential }), /thumbnail_timer_not_enabled/);
  assert.equal(reads, 0);
  assert.throws(() => readThumbnailCredential("arbitrary"), /thumbnail_keyring_item_invalid/);
  assert.throws(() => readThumbnailCredential("thot-os-thumbnail-source-r2-key-id", { platform: "unsupported" }), /thumbnail_keyring_credential_unavailable/);
  assert.throws(() => readThumbnailCredential("thot-os-thumbnail-source-r2-key-id", {
    platform: "linux", execFileSyncImpl() { throw new Error("secret value must not leak"); },
  }), /thumbnail_keyring_credential_unavailable/);
});
