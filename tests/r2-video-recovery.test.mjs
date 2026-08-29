import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertApprovedVideoCleanupPlan, createVideoCleanupPlan, createVideoR2ConfigurationPlan } from "../scripts/r2-video-recovery-lib.mjs";

const authority = { accountId: "account", databaseId: "database", databaseName: "staging", bucket: "bucket", remoteMigrationSha256: "migration" };
const git = { sha: "a".repeat(40), branch: "codex/r2-direct-video-upload", clean: true };
const worker = { latestVersionId: "version", deployment: { versions: [{ versionId: "version", percentage: 100 }] }, secretNames: ["EXISTING"] };
const session = (id, upload) => ({ id, creator_id: "creator", asset_id: `asset-${id}`, storage_object_id: `object-${id}`, object_key: `originals/v1/${id}`, multipart_upload_id: upload, expected_bytes: 8_388_608, uploaded_bytes: 0, expires_at: "2026-08-28T00:00:00.000Z", status: "uploading", finalization_state: "incomplete" });

test("expired-video cleanup is exact, opaque, and rejects target or environment drift", () => {
  const current = { authority, git, worker, sessions: [session("one", "upload-one"), session("two", "upload-two")] };
  const plan = createVideoCleanupPlan(current);
  assert.equal(plan.targetCount, 2);
  assert.equal(plan.confirmation.startsWith("cleanup:"), true);
  assert.equal(JSON.stringify(plan).includes("upload-one"), false);
  assert.equal(JSON.stringify(plan).includes("originals/v1/one"), false);
  assert.doesNotThrow(() => assertApprovedVideoCleanupPlan(plan, plan.confirmation, current));
  assert.throws(() => assertApprovedVideoCleanupPlan(plan, plan.confirmation, { ...current, sessions: [session("one", "upload-one"), session("two", "changed")] }), /drift/);
  assert.throws(() => createVideoCleanupPlan({ ...current, sessions: [session("one", "upload-one")] }), /requested_count/);
  const three = createVideoCleanupPlan({ ...current, targetCount: 3, sessions: [...current.sessions, session("three", "upload-three")] });
  assert.equal(three.targetCount, 3);
});

test("direct-to-R2 configuration remains narrow and lifecycle code never proxies video bytes", async () => {
  const config = createVideoR2ConfigurationPlan({ authority, git, worker, origin: "https://thot-os-staging.thot-os.workers.dev", currentCors: [] });
  assert.deepEqual(config.desiredCors, [{ AllowedOrigins: ["https://thot-os-staging.thot-os.workers.dev"], AllowedMethods: ["PUT"], AllowedHeaders: ["content-type"], ExposeHeaders: ["etag"], MaxAgeSeconds: 300 }]);
  assert.deepEqual(config.requiredSecretNames, ["R2_VIDEO_UPLOAD_ACCESS_KEY_ID", "R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY"]);
  const root = new URL("..", import.meta.url);
  const [recovery, lifecycle, confirm] = await Promise.all([
    readFile(new URL("scripts/r2-video-recovery.mjs", root), "utf8"),
    readFile(new URL("cloudflare/thot-os-next/src/lib/native-video-lifecycle.ts", root), "utf8"),
    readFile(new URL("cloudflare/thot-os-next/src/app/api/source-media/videos/intents/[sessionId]/parts/[partNumber]/confirm/route.ts", root), "utf8"),
  ]);
  assert.match(recovery, /await abortMultipart\(session\);[\s\S]*cleanupSql/);
  assert.match(recovery, /staging_r2_cleanup_credentials_unavailable_from_keychain/);
  assert.match(lifecycle, /expiry_abort_uncertain/);
  assert.match(lifecycle, /asset_video_playback_states SET state='archived'/);
  assert.match(confirm, /creator_id=\?/);
});
