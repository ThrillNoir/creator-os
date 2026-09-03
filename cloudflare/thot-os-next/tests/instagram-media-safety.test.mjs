import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import Database from "better-sqlite3";
import test from "node:test";

const workerSource = await readFile(new URL("../../instagram-scheduler/src/index.ts", import.meta.url), "utf8");
const constantsStart = workerSource.indexOf("const R2_PRESIGN_TTL_SECONDS");
const constantsEnd = workerSource.indexOf("\n\nfunction record", constantsStart);
const constants = constantsStart >= 0 && constantsEnd > constantsStart ? workerSource.slice(constantsStart, constantsEnd) : null;
const helperStart = workerSource.indexOf("function r2ObjectPath");
const helperEnd = workerSource.indexOf("async function currentInstagramConnection");
assert.ok(constants && helperStart >= 0 && helperEnd > helperStart);
const helperSource = stripTypeScriptTypes(`${constants}\n${workerSource.slice(helperStart, helperEnd)}`);

class SigningStub {
  static calls = 0;
  constructor() {}
  async sign() {
    SigningStub.calls += 1;
    return new Request("https://signed.example/creator-media", { method: "GET" });
  }
}

function d1(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => db.prepare(sql).get(...params),
            run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
          };
        },
      };
    },
  };
}

function fixture() {
  const db = new Database(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,bytes INTEGER,source_available INTEGER,media_r2_key TEXT);
    CREATE TABLE asset_storage_objects(id TEXT PRIMARY KEY,asset_id TEXT,creator_id TEXT,object_key TEXT,byte_count INTEGER,verified_mime_type TEXT,sha256 TEXT,r2_version TEXT,r2_etag TEXT,provider TEXT,storage_role TEXT,bucket_role TEXT,ingest_status TEXT,verified_at TEXT);
    CREATE TABLE asset_media_authorities(asset_id TEXT,creator_id TEXT,authority_kind TEXT,state TEXT,canonical_storage_object_id TEXT);
    CREATE TABLE asset_classifications(asset_id TEXT,creator_id TEXT,safety TEXT,is_multi INTEGER);
    CREATE TABLE asset_destinations(asset_id TEXT,creator_id TEXT,destination TEXT);
    CREATE TABLE asset_people(asset_id TEXT,creator_id TEXT,person_id TEXT);
    CREATE TABLE people(id TEXT,creator_id TEXT,consent_status TEXT);`);
  const insertAsset = db.prepare("INSERT INTO assets VALUES (?,?,?,?,?)");
  const insertObject = db.prepare("INSERT INTO asset_storage_objects VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertAuthority = db.prepare("INSERT INTO asset_media_authorities VALUES (?,?,?,?,?)");
  for (const [creatorId, assetId] of [["creator-a", "asset-a"], ["creator-b", "asset-b"]]) {
    insertAsset.run(assetId, creatorId, 100, 1, `media/${creatorId}/${assetId}`);
    insertObject.run(`object-${assetId}`, assetId, creatorId, `media/${creatorId}/${assetId}`, 100, "image/jpeg", `sha-${assetId}`, "version-1", `etag-${assetId}`, "r2", "canonical_original", "library_media", "verified", "2026-09-03");
    insertAuthority.run(assetId, creatorId, "r2_native", "canonical_verified", `object-${assetId}`);
    db.prepare("INSERT INTO asset_classifications VALUES (?,?,?,?)").run(assetId, creatorId, "sfw", 0);
    db.prepare("INSERT INTO asset_destinations VALUES (?,?,?)").run(assetId, creatorId, "instagram");
  }
  let headCalls = 0;
  let headOverride = undefined;
  const library = {
    async head(key) {
      headCalls += 1;
      if (headOverride !== undefined) return headOverride;
      const row = db.prepare("SELECT byte_count,r2_version,r2_etag FROM asset_storage_objects WHERE object_key=?").get(key);
      return row ? { size: row.byte_count, version: row.r2_version, etag: row.r2_etag } : null;
    },
  };
  const DB = d1(db);
  const approved = new Function("immutableR2IdentityMatches", "AwsClient", `${helperSource}\nreturn approvedInstagramReplyMedia;`)(
    (record, object) => Boolean(record.r2_version && record.r2_etag && object && object.size === record.byte_count && object.version === record.r2_version && object.etag === record.r2_etag),
    SigningStub,
  );
  const env = { DB, LIBRARY_MEDIA: library, R2_VIDEO_UPLOAD_ACCESS_KEY_ID: "access", R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY: "secret" };
  const draft = (creatorId = "creator-a", assetId = "asset-a") => ({
    id: "draft-1", creator_id: creatorId, body: "", asset_id: assetId,
    asset_sha256: `sha-${assetId}`, asset_bytes: 100, asset_mime_type: "image/jpeg",
    asset_r2_version: "version-1", asset_r2_etag: `etag-${assetId}`,
  });
  return { db, env, approved, draft, headCalls: () => headCalls, setHead: (value) => { headOverride = value; } };
}

test("approved media resolves only the exact creator-owned immutable source and signs it", async () => {
  const f = fixture();
  try {
    const result = await f.approved(f.env, f.draft());
    assert.deepEqual(result, { url: "https://signed.example/creator-media", type: "image", mimeType: "image/jpeg" });
    assert.equal(f.headCalls(), 1);
    assert.equal(SigningStub.calls > 0, true);
  } finally { f.db.close(); }
});

test("approved MP4 media resolves as video", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE asset_storage_objects SET verified_mime_type='video/mp4' WHERE asset_id='asset-a'").run();
    const result = await f.approved(f.env, { ...f.draft(), asset_mime_type: "video/mp4" });
    assert.deepEqual(result, { url: "https://signed.example/creator-media", type: "video", mimeType: "video/mp4" });
  } finally { f.db.close(); }
});

test("cross-creator media lookup, changed source, revoked authority, consent, and deletion fail closed", async () => {
  const cases = [
    ["cross-creator asset", /instagram_reply_media_changed/, (f) => f.draft("creator-b", "asset-a")],
    ["changed source snapshot", /instagram_reply_media_changed/, (f) => { f.db.prepare("UPDATE asset_storage_objects SET sha256='changed' WHERE asset_id='asset-a'").run(); return f.draft(); }],
    ["changed immutable object", /instagram_reply_media_integrity_failed/, (f) => { f.setHead({ size: 100, version: "version-1", etag: "different-etag" }); return f.draft(); }],
    ["revoked source authority", /instagram_reply_media_changed/, (f) => { f.db.prepare("UPDATE asset_media_authorities SET state='archived' WHERE asset_id='asset-a'").run(); return f.draft(); }],
    ["revoked people consent", /instagram_reply_media_changed/, (f) => { f.db.prepare("INSERT INTO asset_people VALUES ('asset-a','creator-a','person-a')").run(); f.db.prepare("INSERT INTO people VALUES ('person-a','creator-a','revoked')").run(); return f.draft(); }],
    ["deleted source media", /instagram_reply_media_changed/, (f) => { f.db.prepare("UPDATE assets SET source_available=0 WHERE id='asset-a'").run(); return f.draft(); }],
  ];
  for (const [label, expected, mutate] of cases) {
    const f = fixture();
    try { await assert.rejects(f.approved(f.env, mutate(f)), expected, label); }
    finally { f.db.close(); }
  }
});

test("approved media rejects limits, unsupported source types, and incomplete authority", async () => {
  const cases = [
    ["oversize image", /instagram_reply_media_too_large/, (f) => {
      f.db.prepare("UPDATE assets SET bytes=? WHERE id='asset-a'").run(8 * 1024 * 1024 + 1);
      f.db.prepare("UPDATE asset_storage_objects SET byte_count=? WHERE asset_id='asset-a'").run(8 * 1024 * 1024 + 1);
      return { ...f.draft(), asset_bytes: 8 * 1024 * 1024 + 1 };
    }],
    ["oversize video", /instagram_reply_media_too_large/, (f) => {
      f.db.prepare("UPDATE assets SET bytes=? WHERE id='asset-a'").run(25 * 1024 * 1024 + 1);
      f.db.prepare("UPDATE asset_storage_objects SET byte_count=?,verified_mime_type='video/mp4' WHERE asset_id='asset-a'").run(25 * 1024 * 1024 + 1);
      return { ...f.draft(), asset_bytes: 25 * 1024 * 1024 + 1, asset_mime_type: "video/mp4" };
    }],
    ["unsupported MIME", /instagram_reply_media_type_unsupported/, (f) => {
      f.db.prepare("UPDATE asset_storage_objects SET verified_mime_type='image/gif' WHERE asset_id='asset-a'").run();
      return { ...f.draft(), asset_mime_type: "image/gif" };
    }],
    ["revoked Instagram destination", /instagram_reply_media_changed/, (f) => {
      f.db.prepare("DELETE FROM asset_destinations WHERE asset_id='asset-a'").run();
      return f.draft();
    }],
    ["unsafe classification", /instagram_reply_media_changed/, (f) => {
      f.db.prepare("UPDATE asset_classifications SET safety='nsfw' WHERE asset_id='asset-a'").run();
      return f.draft();
    }],
    ["wrong canonical pointer", /instagram_reply_media_changed/, (f) => {
      f.db.prepare("UPDATE asset_media_authorities SET canonical_storage_object_id='object-asset-b' WHERE asset_id='asset-a'").run();
      return f.draft();
    }],
    ["multi-person asset without recorded people", /instagram_reply_media_changed/, (f) => {
      f.db.prepare("UPDATE asset_classifications SET is_multi=1 WHERE asset_id='asset-a'").run();
      return f.draft();
    }],
  ];
  for (const [label, expected, mutate] of cases) {
    const f = fixture();
    try { await assert.rejects(f.approved(f.env, mutate(f)), expected, label); }
    finally { f.db.close(); }
  }
});

test("text-only drafts remain compatible and mixed text/media stays rejected", async () => {
  const f = fixture();
  try {
    assert.equal(await f.approved(f.env, { ...f.draft(), body: "hello", asset_id: null, asset_sha256: null, asset_bytes: null, asset_mime_type: null, asset_r2_version: null, asset_r2_etag: null }), null);
    await assert.rejects(f.approved(f.env, { ...f.draft(), body: "hello" }), /instagram_reply_media_and_text_not_supported/);
    await assert.rejects(f.approved(f.env, { ...f.draft(), asset_id: null, body: "" }), /instagram_reply_media_missing/);
  } finally { f.db.close(); }
});
