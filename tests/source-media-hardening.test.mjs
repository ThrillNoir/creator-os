import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertApprovedSourceRoot, assertSameAuthority, hashStableSource, mapBounded, retryableError, secureSourcePath, validateMediaFile, withRetry } from "../scripts/source-media-migration-lib.mjs";
import { immutableR2IdentityMatches } from "../cloudflare/shared/source-media-integrity.ts";
import { R2_MAX_MULTIPART_PARTS, SOURCE_MEDIA_MAX_BYTES, expectedPartBytes, multipartPartSize } from "../cloudflare/thot-os-next/src/lib/source-media-algorithms.ts";

test("source containment rejects direct and nested symlink escapes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "creatoros-source-boundary-"));
  try {
    const root = path.join(temporary, "root"); const outside = path.join(temporary, "outside");
    await mkdir(path.join(root, "nested"), { recursive: true }); await mkdir(outside);
    await writeFile(path.join(outside, "secret.png"), "outside");
    await symlink(path.join(outside, "secret.png"), path.join(root, "direct.png"));
    await symlink(outside, path.join(root, "nested", "escape"));
    assert.throws(() => secureSourcePath(root, "direct.png"), /source_symlink_rejected/);
    assert.throws(() => secureSourcePath(root, "nested/escape/secret.png"), /source_symlink_rejected/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("source-root policy accepts only the configured Dropbox root", () => {
  assert.equal(assertApprovedSourceRoot("/approved/root", "/approved/root"), "/approved/root");
  assert.throws(() => assertApprovedSourceRoot("/different/root", "/approved/root"), /not_authorized/);
});

test("source identity detects replacement between inventory and apply", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "creatoros-source-replace-"));
  try {
    await mkdir(path.join(temporary, "root")); const file = path.join(temporary, "root", "asset.bin");
    await writeFile(file, "first"); const inventory = await hashStableSource(path.join(temporary, "root"), "asset.bin");
    await writeFile(file, "later");
    await assert.rejects(hashStableSource(path.join(temporary, "root"), "asset.bin", inventory.identitySha256), /source_changed_since_inventory/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("hashed source bytes remain descriptor-pinned after the pathname is replaced", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "creatoros-source-pinned-"));
  try {
    await mkdir(path.join(temporary, "root")); const file = path.join(temporary, "root", "asset.bin");
    await writeFile(file, "authorised"); const inventory = await hashStableSource(path.join(temporary, "root"), "asset.bin");
    await writeFile(file, "replacement");
    assert.equal(inventory.bytes.toString("utf8"), "authorised");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("multipart sizing stays bounded and rejects the application overflow", () => {
  for (const bytes of [1, 5 * 1024 ** 2, 8 * 1024 ** 3, SOURCE_MEDIA_MAX_BYTES]) {
    const part = multipartPartSize(bytes); assert.ok(part >= 5 * 1024 ** 2); assert.ok(Math.ceil(bytes / part) <= R2_MAX_MULTIPART_PARTS);
    assert.equal(expectedPartBytes(bytes, Math.ceil(bytes / part), part), bytes - part * (Math.ceil(bytes / part) - 1));
  }
  assert.equal(multipartPartSize(SOURCE_MEDIA_MAX_BYTES + 1), 0);
});

test("bounded execution never exceeds its configured concurrency", async () => {
  let active = 0; let peak = 0;
  const results = await mapBounded([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return value * 2;
  });
  assert.equal(peak, 2); assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
});

test("retry uses exponential backoff only for retryable failures", async () => {
  const waits = []; let attempts = 0;
  const value = await withRetry(async () => { attempts += 1; if (attempts < 3) throw Object.assign(new Error("busy"), { status: 503 }); return "ok"; }, { random: () => 0.5, baseDelayMs: 100, wait: async (ms) => waits.push(ms) });
  assert.equal(value, "ok"); assert.deepEqual(waits, [100, 200]); assert.equal(retryableError({ status: 429 }), true); assert.equal(retryableError({ status: 409 }), false);
  await assert.rejects(withRetry(async () => { throw Object.assign(new Error("collision"), { status: 409 }); }, { wait: async () => assert.fail("must not wait") }), /collision/);
});

test("every staging authority field is immutable between plan and apply", () => {
  const authority = { accountId: "a", databaseId: "d", databaseName: "db", bucket: "b", registrySha256: "r", configSha256: "c", remoteMigrationSha256: "m", remoteMigrations: ["0051"], reviewedLedgerSha256: "l", toolVersion: "v" };
  assert.equal(assertSameAuthority(authority, structuredClone(authority)), true);
  for (const field of ["accountId", "databaseId", "databaseName", "bucket", "registrySha256", "configSha256", "remoteMigrationSha256", "reviewedLedgerSha256", "toolVersion"]) {
    const changed = structuredClone(authority); changed[field] = `${changed[field]}-changed`; assert.throws(() => assertSameAuthority(authority, changed), /authority_changed/);
  }
  const ledgerChanged = structuredClone(authority); ledgerChanged.remoteMigrations.push("0052"); assert.throws(() => assertSameAuthority(authority, ledgerChanged), /authority_changed/);
});

test("immutable delivery rejects same-size replacement, stale ETag, and missing identity", () => {
  const record = { byte_count: 10, r2_version: "v1", r2_etag: "e1" };
  assert.equal(immutableR2IdentityMatches(record, { size: 10, version: "v1", etag: "e1" }), true);
  assert.equal(immutableR2IdentityMatches(record, { size: 10, version: "v2", etag: "e1" }), false);
  assert.equal(immutableR2IdentityMatches(record, { size: 10, version: "v1", etag: "e2" }), false);
  assert.equal(immutableR2IdentityMatches(record, null), false);
});

test("image validation rejects MIME spoofing, malformed decode, and oversized dimensions", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "creatoros-image-validation-")); const fakeFile = path.join(temporary, "image.png");
  try {
    await writeFile(fakeFile, Buffer.from("89504e470d0a1a0a0000000049454e44ae426082", "hex"));
    const decoder = (metadata) => async () => (() => ({ metadata: async () => metadata }));
    assert.deepEqual(await validateMediaFile(fakeFile, "image/png", decoder({ format: "png", width: 800, height: 600, pages: 1 })), { mimeType: "image/png", width: 800, height: 600 });
    await assert.rejects(validateMediaFile(fakeFile, "image/jpeg", decoder({ format: "png", width: 800, height: 600, pages: 1 })), /image_invalid/);
    await assert.rejects(validateMediaFile(fakeFile, "image/png", decoder({ format: "png", width: 20_000, height: 20_000, pages: 1 })), /image_invalid/);
    await assert.rejects(validateMediaFile(fakeFile, "image/png", async () => (() => ({ metadata: async () => { throw new Error("malformed"); } }))), /image_invalid/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("offline migration rejects video without a real decoder", async () => {
  await assert.rejects(validateMediaFile(Buffer.from("not-a-decoded-video"), "video/mp4"), /decoder_required/);
});
