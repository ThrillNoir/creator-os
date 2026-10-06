import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { createContentDownloadLink, revokeContentDownloadLink } from "../../thot-os-next/src/lib/content-download-links.ts";
import worker from "../src/index.ts";
import { replayDownloadSchema } from "../../../tests/fixtures/download-local/replay.mjs";

const { Miniflare, convertV4MiniflareOptions } = createRequire(new URL("../../thot-os-next/package.json", import.meta.url))("miniflare");

const owner = { creatorId: "fixture-creator", email: "owner@example.test" };
const outsider = { creatorId: "other-creator", email: "other@example.test" };
const bytes = new TextEncoder().encode("synthetic-local-video");
const token = "a".repeat(64);
const now = "2026-10-05T00:00:00.000Z";
const RealDate = Date;

function freezeTime() {
  globalThis.Date = class extends RealDate {
    constructor(value) { super(arguments.length ? value : now); }
    static now() { return new RealDate(now).getTime(); }
  };
}

async function seed(db, identity) {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  db.prepare("INSERT INTO creators(id,name,slug,initials,status) VALUES (?,?,?,?,?)").run(owner.creatorId, "Fixture Creator", "fixture-creator", "FC", "active");
  db.prepare("INSERT INTO creators(id,name,slug,initials,status) VALUES (?,?,?,?,?)").run(outsider.creatorId, "Other Creator", "other-creator", "OC", "active");
  db.prepare("INSERT INTO users(email,display_name,status) VALUES (?,?,?)").run(owner.email, "Owner", "active");
  db.prepare("INSERT INTO users(email,display_name,status) VALUES (?,?,?)").run(outsider.email, "Outsider", "active");
  db.prepare("INSERT INTO creator_memberships(creator_id,user_email,role,status) VALUES (?,?,?,?)").run(owner.creatorId, owner.email, "creator", "active");
  db.prepare("INSERT INTO creator_memberships(creator_id,user_email,role,status) VALUES (?,?,?,?)").run(outsider.creatorId, outsider.email, "creator", "active");
  db.prepare("INSERT INTO assets(id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at,source_available) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("fixture-video", owner.creatorId, "synthetic/fixture.mp4", "fixture.mp4", "mp4", bytes.length, now, "native_direct", now, 1);
  db.prepare("INSERT INTO asset_storage_objects(id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status,r2_version,r2_etag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("fixture-object", owner.creatorId, "fixture-video", "r2", "canonical_original", "library_media", "originals/fixture.mp4", "fixture.mp4", bytes.length, "video/mp4", checksum, "m1_direct", "verified", identity.version, identity.etag);
  db.prepare("INSERT INTO asset_media_authorities(asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state) VALUES (?,?,?,?,?,?)")
    .run("fixture-video", owner.creatorId, "r2_native", "cloudflare_direct", "fixture-object", "canonical_verified");
  db.prepare("INSERT INTO asset_video_playback_states(asset_id,creator_id,canonical_storage_object_id,state) VALUES (?,?,?,?)")
    .run("fixture-video", owner.creatorId, "fixture-object", "playback_ready");
  db.prepare("INSERT INTO asset_classifications(asset_id,creator_id,safety,is_multi) VALUES (?,?,?,?)")
    .run("fixture-video", owner.creatorId, "sfw", 0);
}

test("local migrated schema creates, redeems, ranges, and revokes a synthetic download", { timeout: 30000 }, async () => {
  const local = await replayDownloadSchema();
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: "2026-08-08", script: "export default { fetch() { return new Response('fixture'); } }", r2Buckets: ["LIBRARY_MEDIA"],
  }));
  try {
    assert.equal(local.db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 65);
    assert.equal(local.db.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").get().name, "0063_content_download_links.sql");
    const media = await mf.getR2Bucket("LIBRARY_MEDIA");
    const identity = await media.put("originals/fixture.mp4", bytes, { httpMetadata: { contentType: "video/mp4" } });
    await seed(local.db, identity);
    freezeTime();

    const created = await createContentDownloadLink(local.DB, { actor: owner, assetId: "fixture-video", title: "Fixture video", sharingConfirmed: true, token, id: "fixture-link", now });
    assert.equal(created.token, token);
    await assert.rejects(createContentDownloadLink(local.DB, { actor: outsider, assetId: "fixture-video", title: "Foreign", sharingConfirmed: true, token: "b".repeat(64), now }), { name: "ContentDownloadLinkError", code: "not_eligible" });
    assert.equal(await revokeContentDownloadLink(local.DB, { actor: outsider, linkId: created.id, now }), false);

    const url = `http://localhost/d/${token}`;
    const env = { ENABLED: "true", DB: local.DB, LIBRARY_MEDIA: media };
    const metadata = await worker.fetch(new Request(url), env);
    assert.equal(metadata.status, 200);
    const redeemed = await worker.fetch(new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" }, body: "intent=download" }), env);
    assert.equal(redeemed.status, 303);
    const cookie = redeemed.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const ranged = await worker.fetch(new Request(`${url}/download`, { headers: { cookie, range: "bytes=0-8" } }), env);
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "synthetic");

    assert.equal(await revokeContentDownloadLink(local.DB, { actor: owner, linkId: created.id, now }), true);
    assert.equal((await worker.fetch(new Request(`${url}/download`, { headers: { cookie } }), env)).status, 404);
  } finally {
    globalThis.Date = RealDate;
    await mf.dispose();
    await local.dispose();
  }
});
