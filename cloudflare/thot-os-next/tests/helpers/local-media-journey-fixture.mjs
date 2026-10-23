import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { deflateSync } from "node:zlib";

const root = new URL("../..", import.meta.url);
const appRoot = root;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const encoder = new TextEncoder();
const previewBytes = new Uint8Array([0xff,0xd8,0xff,0xd9]);

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = encoder.encode(type);
  const payload = new Uint8Array(typeBytes.length + data.length);
  payload.set(typeBytes); payload.set(data, typeBytes.length);
  const chunk = new Uint8Array(12 + data.length);
  new DataView(chunk.buffer).setUint32(0, data.length);
  chunk.set(payload, 4);
  new DataView(chunk.buffer).setUint32(chunk.length - 4, pngCrc32(payload));
  return chunk;
}

function makeSolidPng(width, height, color = [32, 128, 224, 255]) {
  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width); header.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, standard compression/filtering, no interlace.
  const row = new Uint8Array(1 + width * 4);
  for (let x = 0; x < width; x++) row.set(color, 1 + x * 4);
  const scanlines = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) scanlines.set(row, y * row.length);
  const pieces = [new Uint8Array([137,80,78,71,13,10,26,10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", new Uint8Array())];
  const result = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) { result.set(piece, offset); offset += piece.length; }
  return result;
}

export const ownPng = makeSolidPng(64, 64);
export const syntheticMp4 = new Uint8Array([
  0,0,0,20,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d,0,0,0,0,0x69,0x73,0x6f,0x6d,
  0,0,0,12,0x6d,0x6f,0x6f,0x76,0x61,0x76,0x63,0x31,
  0,0,0,9,0x6d,0x64,0x61,0x74,0x01,
]);

function migrationCreateTable(source, tableName) {
  const start = source.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName} (`);
  if (start < 0) throw new Error(`Missing schema fixture for ${tableName}`);
  const open = source.indexOf("(", start);
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor++) {
    if (source[cursor] === "(") depth++;
    else if (source[cursor] === ")" && --depth === 0) return `${source.slice(start, cursor + 1)};`;
  }
  throw new Error(`Unclosed schema fixture for ${tableName}`);
}

export async function createLocalD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  const initial = await readFile(new URL("../thot-os-app/migrations/0001_adelaide_library.sql", root), "utf8");
  const library = await readFile(new URL("../thot-os-app/migrations/0044_creator_r2_library.sql", root), "utf8");
  db.exec(migrationCreateTable(initial, "creators"));
  db.exec(migrationCreateTable(initial, "assets"));
  db.prepare("INSERT INTO creators(id,name,slug,initials) VALUES ('creator-a','Fixture','fixture','F'),('creator-b','Foreign','foreign','X')").run();
  db.exec(library);
  for (const name of ["0050_r2_native_source_media.sql", "0053_native_asset_authority.sql", "0054_native_video_intake.sql"]) {
    db.exec(await readFile(new URL(`../thot-os-app/migrations/${name}`, root), "utf8"));
  }
  db.exec(`ALTER TABLE assets ADD COLUMN display_stem TEXT;
    ALTER TABLE asset_storage_objects ADD COLUMN r2_version TEXT;
    ALTER TABLE asset_storage_objects ADD COLUMN r2_etag TEXT;
    ALTER TABLE asset_ingest_sessions ADD COLUMN finalization_state TEXT NOT NULL DEFAULT 'incomplete';
    ALTER TABLE asset_ingest_sessions ADD COLUMN completed_r2_version TEXT;
    ALTER TABLE asset_ingest_sessions ADD COLUMN completed_r2_etag TEXT;
    ALTER TABLE asset_ingest_sessions ADD COLUMN completion_observed_at TEXT;
    ALTER TABLE asset_ingest_sessions ADD COLUMN reconcile_attempts INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE asset_preview_jobs (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, asset_id TEXT NOT NULL, source_revision TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(creator_id,asset_id));
    CREATE TABLE asset_classifications (asset_id TEXT PRIMARY KEY,creator_id TEXT,safety TEXT,is_teaser INTEGER DEFAULT 0,is_multi INTEGER DEFAULT 0,notes TEXT DEFAULT '');
    CREATE TABLE asset_destinations (asset_id TEXT,creator_id TEXT,destination TEXT,PRIMARY KEY(asset_id,destination));
    CREATE TABLE fixture_audit (event TEXT NOT NULL);`);
  db.exec(`CREATE TRIGGER asset_storage_object_r2_identity_update BEFORE UPDATE OF provider,ingest_status,r2_version,r2_etag ON asset_storage_objects
    WHEN NEW.provider='r2' AND NEW.ingest_status='verified' AND (NEW.r2_version IS NULL OR length(NEW.r2_version)=0 OR NEW.r2_etag IS NULL OR length(NEW.r2_etag)=0)
    BEGIN SELECT RAISE(ABORT,'verified_r2_identity_required'); END;`);

  let failCompletionWrite = false;
  let failVideoCompletionWrite = false;
  const DB = {
    failNextCompletionWrite() { failCompletionWrite = true; },
    failNextVideoCompletionWrite() { failVideoCompletionWrite = true; },
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return db.prepare(sql).get(...values) ?? null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
        async run() {
          if (failCompletionWrite && sql.includes("UPDATE asset_ingest_sessions SET finalization_state='completed_unreconciled'")) {
            failCompletionWrite = false;
            throw new Error("fixture_d1_completion_write_lost");
          }
          if (failVideoCompletionWrite && sql.includes("UPDATE asset_video_ingest_sessions SET finalization_state='completed_unreconciled'")) {
            failVideoCompletionWrite = false;
            throw new Error("fixture_d1_video_completion_write_lost");
          }
          const result = db.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, DB };
}

export function createMemoryR2() {
  const objects = new Map();
  const uploads = new Map();
  let uploadCounter = 0;
  const bucket = {
    objects,
    async createMultipartUpload(key, options = {}) {
      const uploadId = `fixture-upload-${++uploadCounter}`;
      uploads.set(uploadId, { key, options, parts: new Map() });
      const abort = async () => { uploads.delete(uploadId); };
      return { uploadId, abort };
    },
    resumeMultipartUpload(key, uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error("fixture_upload_not_found");
      return {
        async uploadPart(partNumber, bytes) {
          const value = new Uint8Array(bytes);
          const etag = createHash("md5").update(value).digest("hex");
          upload.parts.set(partNumber, { bytes: value, etag });
          return { partNumber, etag };
        },
        async complete(parts) {
          for (const part of parts) if (upload.parts.get(part.partNumber)?.etag !== part.etag) throw new Error("fixture_part_etag_mismatch");
          const ordered = parts.map((part) => upload.parts.get(part.partNumber).bytes);
          const bytes = new Uint8Array(ordered.reduce((n, part) => n + part.length, 0));
          let offset = 0;
          for (const part of ordered) { bytes.set(part, offset); offset += part.length; }
          const multipartDigest = createHash("md5");
          for (const part of parts) multipartDigest.update(Buffer.from(part.etag, "hex"));
          const etag = `${multipartDigest.digest("hex")}-${parts.length}`;
          const object = { key, bytes, version: `version-${uploadId}`, etag, httpMetadata: upload.options.httpMetadata ?? {}, customMetadata: upload.options.customMetadata ?? {} };
          objects.set(key, object);
          uploads.delete(uploadId);
          return { version: object.version, etag };
        },
        async abort() { uploads.delete(uploadId); },
      };
    },
    async head(key) {
      const object = objects.get(key);
      return object ? { key, size: object.bytes.length, etag: object.etag, version: object.version, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata } : null;
    },
    async get(key, options = {}) {
      const object = objects.get(key);
      if (!object || (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object.etag)) return null;
      const allBytes = object.bytes;
      const bodyBytes = options.range ? allBytes.slice(options.range.offset, options.range.offset + options.range.length) : allBytes;
      return { key, size: allBytes.length, etag: object.etag, version: object.version, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata,
        body: new Blob([bodyBytes]).stream(), arrayBuffer: async () => bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength) };
    },
    async put(key, bytes, options = {}) {
      const value = new Uint8Array(bytes);
      objects.set(key, { key, bytes: value, etag: createHash("md5").update(value).digest("hex"), version: `derivative-${objects.size + 1}`, httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {} });
    },
    async delete(key) { objects.delete(key); },
  };
  return bucket;
}

export function createImageMock() {
  return {
    input: () => ({ transform() { return this; }, output() { return this; }, image() { return previewBytes; } }),
    async info(stream) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const isPng = bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR";
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { format: bytes[0] === 0xff ? "image/jpeg" : isPng ? "image/png" : "unknown", width: isPng ? view.getUint32(16) : 1, height: isPng ? view.getUint32(20) : 1 };
    },
  };
}

export async function loadRouteHandler(relativePath, exportName, dependencyValues) {
  const source = await readFile(new URL(relativePath, appRoot), "utf8");
  const start = source.indexOf(`export async function ${exportName}(`);
  if (start < 0) throw new Error(`Missing route export ${exportName} in ${relativePath}`);
  const preamble = source.slice(0, start).split("\n").filter((line) => !line.trimStart().startsWith("import ")).join("\n");
  const functionTs = `${preamble}\n${source.slice(start).replace("export async function", "async function")}`;
  const compiled = ts.transpileModule(functionTs, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
  const names = Object.keys(dependencyValues);
  const values = Object.values(dependencyValues);
  const loader = new AsyncFunction(...names, `${compiled}\nreturn ${exportName};`);
  return await loader(...values);
}

export function createHashValidator(sourceMediaSource, { detectedMime, IsoBmffValidator, constants }) {
  const assertStart = sourceMediaSource.indexOf("function assertImageEnvelope(");
  const assertEnd = sourceMediaSource.indexOf("\nexport async function hashAndValidateR2Object(", assertStart);
  const start = sourceMediaSource.indexOf("export async function hashAndValidateR2Object(");
  const end = sourceMediaSource.indexOf("\nexport function sourceMediaObjectHeaders", start);
  if (assertStart < 0 || assertEnd < 0 || start < 0 || end < 0) throw new Error("Missing production hash validator boundaries");
  const functionTs = `${sourceMediaSource.slice(assertStart, assertEnd)}\n${sourceMediaSource.slice(start, end).replace("export async function", "async function")}`;
  const compiled = ts.transpileModule(functionTs, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
  const createHashFn = createHash;
  const names = ["createHash", "IsoBmffValidator", "SOURCE_MEDIA_MAX_IMAGE_BYTES", "SOURCE_MEDIA_MAX_IMAGE_DIMENSION", "SOURCE_MEDIA_MAX_IMAGE_PIXELS", "SOURCE_MEDIA_MAX_VIDEO_BYTES", "detectedMime"];
  const values = [createHashFn, IsoBmffValidator, constants.SOURCE_MEDIA_MAX_IMAGE_BYTES, constants.SOURCE_MEDIA_MAX_IMAGE_DIMENSION, constants.SOURCE_MEDIA_MAX_IMAGE_PIXELS, constants.SOURCE_MEDIA_MAX_VIDEO_BYTES, detectedMime];
  return new AsyncFunction(...names, `${compiled}\nreturn hashAndValidateR2Object;`)(...values);
}

export function noStoreJson(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

export function imageBytesHash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
export function uuid() { return crypto.randomUUID(); }
