import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createHash } from "node:crypto";
import { detectedMime, expectedPartBytes, multipartPartSize, SOURCE_MEDIA_MAX_IMAGE_BYTES, SOURCE_MEDIA_MAX_IMAGE_DIMENSION, SOURCE_MEDIA_MAX_IMAGE_PIXELS, SOURCE_MEDIA_MAX_VIDEO_BYTES, sourceMediaMimeByExtension } from "../src/lib/source-media-algorithms.ts";
import { IsoBmffValidator } from "../src/lib/iso-bmff-validator.ts";
import { completedR2MultipartEtag, validateR2VideoMetadata } from "../src/lib/r2-video-metadata.ts";
import { buildLibraryAssetsQuery } from "../src/lib/library-pagination.ts";
import { createHashValidator, createImageMock, createLocalD1, createMemoryR2, imageBytesHash, loadRouteHandler, noStoreJson, ownPng, syntheticMp4 } from "./helpers/local-media-journey-fixture.mjs";

const root = new URL("..", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const imageMime = "image/png";
const clientUploadId = "10000000-0000-4000-8000-000000000001";
const videoClientUploadId = "20000000-0000-4000-8000-000000000002";

function validFilename(value) { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\\/\u0000\r\n]/.test(value); }
function nativeImageDetails(filename, mimeType) {
  if (!validFilename(filename)) return null;
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return sourceMediaMimeByExtension[extension] === mimeType ? { filename, extension, mimeType } : null;
}
function nativeVideoDetails(filename, mimeType) {
  if (!validFilename(filename)) return null;
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return ["mp4", "mov"].includes(extension) && sourceMediaMimeByExtension[extension] === mimeType ? { filename, extension, mimeType } : null;
}
function makeRequest(path, { method = "POST", body, contentType = "application/json", contentLength } = {}) {
  const headers = new Headers({ origin: "https://app.example.test" });
  if (contentType) headers.set("content-type", contentType);
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new Request(`https://app.example.test${path}`, { method, headers, body });
}

test("synthetic PNG recovery and MP4 presigned-part journey stays local, creator-scoped, and source-preserving", async () => {
  const { db, DB } = await createLocalD1();
  const libraryMedia = createMemoryR2();
  const previews = createMemoryR2();
  const images = createImageMock();
  let activeCreator = "creator-a";
  let previewAttempts = 0;
  let queueCalls = 0;
  const env = { DB, LIBRARY_MEDIA: libraryMedia, PREVIEWS: previews, IMAGES: images, PREVIEW_QUEUE: { send: async () => { queueCalls++; } } };
  const context = () => ({ creator: { creator_id: activeCreator, role: "creator" }, email: `${activeCreator}@example.test` });
  const dependencies = {
    isSameOriginRequest: (request) => request.headers.get("origin") === "https://app.example.test",
    noStoreJson,
    requireCreatorContext: async () => context(),
    cloudflareEnv: () => env,
    humanAuditActor: () => ({ actor: "fixture", role: "creator" }),
    identityAuditStatement: (database, _actor, eventType) => database.prepare("INSERT INTO fixture_audit(event) VALUES(?)").bind(eventType),
    rejectClientActorRole: () => {},
    nativeImageDetails,
    nativeVideoDetails,
    validClientUploadId: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value)),
    validNativeVideoBytes: (value) => Number.isSafeInteger(value) && value > 0 && value <= SOURCE_MEDIA_MAX_VIDEO_BYTES,
    isSha256: (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value),
    canonicalR2MultipartPartEtag: (value) => typeof value === "string" ? value.trim().replace(/^\"|\"$/g, "").toLowerCase() : null,
    multipartPartSize,
    expectedPartBytes,
    validSourceFilename: validFilename,
    privateOriginalKey: () => `originals/v1/${crypto.randomUUID()}`,
    safeFailureCode: (error, fallback = "source_media_failed") => (error instanceof Error ? error.message : fallback).replace(/[^a-z0-9_]+/gi, "_").slice(0, 120),
    SOURCE_MEDIA_MAX_IMAGE_BYTES,
    SOURCE_MEDIA_SESSION_MINUTES: 30,
    SOURCE_MEDIA_VIDEO_SESSION_MINUTES: 480,
    SOURCE_MEDIA_MAX_ACTIVE_VIDEO_UPLOADS: 2,
    directVideoUploadsAvailable: () => true,
    expireVideoIngest: async () => ({ expired: true }),
    presignVideoPartUpload: async (_configuration, input) => ({ uploadUrl: `https://r2.local/${input.partNumber}?fixture=presigned`, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    buildNativeImageTerminalStatements: () => [],
    createNativeImagePreview: async (input) => {
      previewAttempts++;
      const canonical = await input.libraryMedia.get(input.objectKey, { onlyIf: { etagMatches: input.expectedEtag } });
      assert.ok(canonical, "preview uses the canonical original with its stored ETag");
      const original = new Uint8Array(await canonical.arrayBuffer());
      assert.deepEqual(original, ownPng, "preview generation reads the synthetic original without altering it");
      const generated = images.input(canonical.body).transform({ width: 720, height: 720 }).output({ format: "image/jpeg" }).image();
      const info = await images.info(new Blob([generated]).stream());
      assert.equal(info.format, "image/jpeg");
      if (previewAttempts === 1) throw new Error("fixture_preview_transform_unavailable");
      const objectKey = `creators/${input.creatorId}/assets/${"a".repeat(64)}/previews/${input.sourceSha256}.jpg`;
      await input.previews.put(objectKey, generated, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { creator_id: input.creatorId, asset_id: input.assetId } });
      return { objectKey, width: info.width, height: info.height };
    },
  };

  const sourceMediaSource = await source("src/lib/source-media.ts");
  const hashAndValidateR2Object = await createHashValidator(sourceMediaSource, { detectedMime, IsoBmffValidator, constants: { SOURCE_MEDIA_MAX_IMAGE_BYTES, SOURCE_MEDIA_MAX_IMAGE_DIMENSION, SOURCE_MEDIA_MAX_IMAGE_PIXELS, SOURCE_MEDIA_MAX_VIDEO_BYTES } });
  const imageIntent = await loadRouteHandler("src/app/api/source-media/native/intents/route.ts", "POST", dependencies);
  const imagePart = await loadRouteHandler("src/app/api/source-media/intents/[sessionId]/parts/[partNumber]/route.ts", "PUT", dependencies);
  const imageFinalize = await loadRouteHandler("src/app/api/source-media/intents/[sessionId]/finalize/route.ts", "POST", { ...dependencies, hashAndValidateR2Object });

  const imageHash = imageBytesHash(ownPng);
  const intentResponse = await imageIntent(makeRequest("/api/source-media/native/intents", { body: JSON.stringify({ filename: "synthetic.png", bytes: ownPng.length, sha256: imageHash, mimeType: imageMime, clientUploadId }) }));
  const intent = await intentResponse.json();
  assert.equal(intentResponse.status, 201);
  assert.ok(intent.sessionId && intent.assetId);
  const session = await DB.prepare("SELECT object_key,multipart_upload_id,chunk_bytes FROM asset_ingest_sessions WHERE id=? AND creator_id=?").bind(intent.sessionId, "creator-a").first();
  assert.ok(session.object_key.startsWith("originals/v1/"));
  assert.equal(session.chunk_bytes, multipartPartSize(ownPng.length));

  const partResponse = await imagePart(makeRequest(`/api/source-media/intents/${intent.sessionId}/parts/1`, { method: "PUT", body: ownPng, contentType: imageMime, contentLength: ownPng.length }), { params: Promise.resolve({ sessionId: intent.sessionId, partNumber: "1" }) });
  assert.equal(partResponse.status, 200);
  assert.equal((await partResponse.json()).ok, true);
  DB.failNextCompletionWrite();
  const interrupted = await imageFinalize(makeRequest(`/api/source-media/intents/${intent.sessionId}/finalize`), { params: Promise.resolve({ sessionId: intent.sessionId }) });
  assert.equal(interrupted.status, 503);
  assert.equal((await interrupted.json()).error, "completion_requires_reconciliation");
  assert.equal((await DB.prepare("SELECT finalization_state FROM asset_ingest_sessions WHERE id=?").bind(intent.sessionId).first()).finalization_state, "completing");
  const retained = await libraryMedia.get(session.object_key);
  assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), ownPng, "R2 completion survives lost D1 completion persistence");

  const recovered = await imageFinalize(makeRequest(`/api/source-media/intents/${intent.sessionId}/finalize`), { params: Promise.resolve({ sessionId: intent.sessionId }) });
  assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
  assert.deepEqual(await recovered.json(), { ok: true, sessionId: intent.sessionId, status: "finalized", reconciled: true, preview: "failed" });
  const verifiedOriginal = await DB.prepare(`SELECT s.status,s.finalization_state,s.multipart_upload_id,o.ingest_status,o.r2_version,o.r2_etag,a.media_r2_key,ma.state
    FROM asset_ingest_sessions s JOIN asset_storage_objects o ON o.id=s.storage_object_id JOIN assets a ON a.id=s.asset_id
    JOIN asset_media_authorities ma ON ma.asset_id=a.id WHERE s.id=?`).bind(intent.sessionId).first();
  assert.equal(verifiedOriginal.status, "finalized");
  assert.equal(verifiedOriginal.finalization_state, "verified");
  assert.equal(verifiedOriginal.multipart_upload_id, null);
  assert.equal(verifiedOriginal.ingest_status, "verified");
  assert.ok(verifiedOriginal.r2_version && verifiedOriginal.r2_etag);
  assert.equal(verifiedOriginal.media_r2_key, session.object_key);
  assert.equal(verifiedOriginal.state, "preview_failed");
  assert.equal(queueCalls, 1, "failed preview is scheduled for recovery");

  const replayed = await imageFinalize(makeRequest(`/api/source-media/intents/${intent.sessionId}/finalize`), { params: Promise.resolve({ sessionId: intent.sessionId }) });
  assert.equal(replayed.status, 200);
  assert.deepEqual(await replayed.json(), { ok: true, sessionId: intent.sessionId, status: "finalized", replay: true, preview: "ready" });
  const originalAfterPreview = await libraryMedia.get(session.object_key);
  assert.deepEqual(new Uint8Array(await originalAfterPreview.arrayBuffer()), ownPng, "preview retry leaves canonical original bytes untouched");
  assert.equal((await libraryMedia.head(session.object_key)).version, verifiedOriginal.r2_version);
  assert.equal((await DB.prepare("SELECT state FROM asset_media_authorities WHERE asset_id=?").bind(intent.assetId).first()).state, "preview_ready");
  assert.equal(previews.objects.size, 1);

  activeCreator = "creator-b";
  const foreignImageFinalize = await imageFinalize(makeRequest(`/api/source-media/intents/${intent.sessionId}/finalize`), { params: Promise.resolve({ sessionId: intent.sessionId }) });
  assert.equal(foreignImageFinalize.status, 404);
  activeCreator = "creator-a";

  const videoIntent = await loadRouteHandler("src/app/api/source-media/videos/intents/route.ts", "POST", dependencies);
  const videoHash = "b".repeat(64);
  const videoIntentResponse = await videoIntent(makeRequest("/api/source-media/videos/intents", { body: JSON.stringify({ filename: "synthetic.mp4", bytes: syntheticMp4.length, sha256: videoHash, mimeType: "video/mp4", clientUploadId: videoClientUploadId }) }));
  const videoSession = await videoIntentResponse.json();
  assert.equal(videoIntentResponse.status, 201);
  const videoAuth = await loadRouteHandler("src/app/api/source-media/videos/intents/[sessionId]/parts/[partNumber]/authorize/route.ts", "POST", dependencies);
  const videoConfirm = await loadRouteHandler("src/app/api/source-media/videos/intents/[sessionId]/parts/[partNumber]/confirm/route.ts", "POST", dependencies);
  const authorizedResponse = await videoAuth(makeRequest(`/api/source-media/videos/intents/${videoSession.sessionId}/parts/1`), { params: Promise.resolve({ sessionId: videoSession.sessionId, partNumber: "1" }) });
  assert.equal(authorizedResponse.status, 200);
  const authorization = await authorizedResponse.json();
  assert.match(authorization.uploadUrl, /^https:\/\/r2\.local\//, "presigned upload fixture is synthetic and never fetched");
  assert.equal(authorization.byteCount, syntheticMp4.length);
  const videoUploadSession = await DB.prepare("SELECT object_key,multipart_upload_id FROM asset_video_ingest_sessions WHERE id=? AND creator_id=?").bind(videoSession.sessionId, "creator-a").first();
  const uploadedVideoPart = await libraryMedia.resumeMultipartUpload(videoUploadSession.object_key, videoUploadSession.multipart_upload_id).uploadPart(1, syntheticMp4);
  const confirmation = await videoConfirm(makeRequest(`/api/source-media/videos/intents/${videoSession.sessionId}/parts/1`, { body: JSON.stringify({ etag: `\"${uploadedVideoPart.etag}\"` }) }), { params: Promise.resolve({ sessionId: videoSession.sessionId, partNumber: "1" }) });
  assert.equal(confirmation.status, 200);
  assert.equal((await confirmation.json()).byteCount, syntheticMp4.length);
  const videoFinalize = await loadRouteHandler("src/app/api/source-media/videos/intents/[sessionId]/finalize/route.ts", "POST", {
    ...dependencies,
    completedR2MultipartEtag,
    validateR2VideoMetadata,
    expectedPartBytes,
    archiveTerminalVideoIngest: async () => {},
    expireVideoIngest: async () => ({ expired: true }),
    failVideoIngestAfterAbort: async () => ({ failed: true }),
  });
  DB.failNextVideoCompletionWrite();
  const interruptedVideo = await videoFinalize(makeRequest(`/api/source-media/videos/intents/${videoSession.sessionId}/finalize`), { params: Promise.resolve({ sessionId: videoSession.sessionId }) });
  assert.equal(interruptedVideo.status, 503);
  assert.equal((await interruptedVideo.json()).error, "completion_requires_reconciliation");
  const videoDbSession = await DB.prepare("SELECT object_key,multipart_upload_id,status,finalization_state FROM asset_video_ingest_sessions WHERE id=? AND creator_id=?").bind(videoSession.sessionId, "creator-a").first();
  assert.equal(videoDbSession.finalization_state, "completing");
  const retainedVideo = await libraryMedia.get(videoUploadSession.object_key);
  assert.deepEqual(new Uint8Array(await retainedVideo.arrayBuffer()), syntheticMp4, "completed video original remains available when its D1 completion write is interrupted");
  const recoveredVideo = await videoFinalize(makeRequest(`/api/source-media/videos/intents/${videoSession.sessionId}/finalize`), { params: Promise.resolve({ sessionId: videoSession.sessionId }) });
  assert.equal(recoveredVideo.status, 200, JSON.stringify(await recoveredVideo.clone().json()));
  const recoveredVideoBody = await recoveredVideo.json();
  assert.equal(recoveredVideoBody.reconciled, true);
  assert.equal(recoveredVideoBody.status, "finalized");
  assert.equal(recoveredVideoBody.sourceCodec, "h264");
  const verifiedVideo = await DB.prepare(`SELECT s.status,s.finalization_state,s.multipart_upload_id,o.ingest_status,o.r2_version,o.r2_etag,o.sha256,a.media_r2_key,ma.state,p.state AS playback_state,p.playback_provider,e.detail AS verified_detail
    FROM asset_video_ingest_sessions s JOIN asset_storage_objects o ON o.id=s.storage_object_id JOIN assets a ON a.id=s.asset_id
    JOIN asset_media_authorities ma ON ma.asset_id=a.id JOIN asset_video_playback_states p ON p.asset_id=a.id
    JOIN asset_video_ingest_events e ON e.session_id=s.id AND e.event_type='ingest_verified' WHERE s.id=?`).bind(videoSession.sessionId).first();
  assert.equal(verifiedVideo.status, "finalized");
  assert.equal(verifiedVideo.finalization_state, "verified");
  assert.equal(verifiedVideo.multipart_upload_id, null);
  assert.equal(verifiedVideo.ingest_status, "verified");
  assert.ok(verifiedVideo.r2_version && verifiedVideo.r2_etag);
  assert.equal(verifiedVideo.media_r2_key, videoDbSession.object_key);
  assert.equal(verifiedVideo.state, "canonical_verified");
  assert.equal(verifiedVideo.playback_state, "canonical_verified");
  assert.equal(verifiedVideo.playback_provider, "none");
  assert.equal(verifiedVideo.sha256, videoHash, "legacy SHA field stores the declared value without hashing the full video body");
  const ingestDetail = JSON.parse(verifiedVideo.verified_detail);
  assert.equal(ingestDetail.checksumProvenance, "client_declared");
  assert.equal(ingestDetail.clientSha256, videoHash);
  const finalizedOriginal = await libraryMedia.get(videoDbSession.object_key);
  assert.deepEqual(new Uint8Array(await finalizedOriginal.arrayBuffer()), syntheticMp4, "video verification retains the source bytes unchanged");
  const replayedVideo = await videoFinalize(makeRequest(`/api/source-media/videos/intents/${videoSession.sessionId}/finalize`), { params: Promise.resolve({ sessionId: videoSession.sessionId }) });
  assert.equal(replayedVideo.status, 200);
  assert.equal((await replayedVideo.json()).replay, true);
  activeCreator = "creator-b";
  const foreignVideoFinalize = await videoFinalize(makeRequest(`/api/source-media/videos/intents/${videoSession.sessionId}/finalize`), { params: Promise.resolve({ sessionId: videoSession.sessionId }) });
  assert.equal(foreignVideoFinalize.status, 404);
  const foreignVideoAuth = await videoAuth(makeRequest(`/api/source-media/videos/intents/${videoSession.sessionId}/parts/1`), { params: Promise.resolve({ sessionId: videoSession.sessionId, partNumber: "1" }) });
  assert.equal(foreignVideoAuth.status, 404);
  activeCreator = "creator-a";

  const photoQuery = buildLibraryAssetsQuery({ type: "photos" }, [], true);
  const photos = (await DB.prepare(photoQuery.sql).bind("creator-a", ...photoQuery.values, photoQuery.limit, photoQuery.offset).all()).results;
  assert.deepEqual(photos.map((row) => row.id), [intent.assetId]);
  const videoQuery = buildLibraryAssetsQuery({ type: "videos" }, [], true);
  const videos = (await DB.prepare(videoQuery.sql).bind("creator-a", ...videoQuery.values, videoQuery.limit, videoQuery.offset).all()).results;
  assert.deepEqual(videos.map((row) => row.id), [videoSession.assetId]);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM asset_video_playback_states WHERE asset_id=? AND state='canonical_verified' AND playback_provider='none'").bind(videoSession.assetId).first()).count, 1);

  db.prepare("INSERT INTO assets(id,creator_id,relative_path,basename,extension,bytes,modified_at,filename_class,indexed_at) VALUES('foreign-image','creator-b','foreign.png','foreign.png','png',20,CURRENT_TIMESTAMP,'native_direct',CURRENT_TIMESTAMP)").run();
  db.prepare("INSERT INTO asset_storage_objects(id,creator_id,asset_id,provider,storage_role,bucket_role,object_key,original_filename,byte_count,verified_mime_type,sha256,source_provider,ingest_status) VALUES('foreign-object','creator-b','foreign-image','r2','canonical_original','library_media','foreign/key','foreign.png',20,'image/png',?,'m1_direct','pending')").run("c".repeat(64));
  db.prepare("INSERT INTO asset_media_authorities(asset_id,creator_id,authority_kind,ingest_channel,canonical_storage_object_id,state) VALUES('foreign-image','creator-b','r2_native','cloudflare_direct','foreign-object','ingesting')").run();
  const creatorAList = (await DB.prepare(photoQuery.sql).bind("creator-a", ...photoQuery.values, photoQuery.limit, photoQuery.offset).all()).results;
  const creatorBList = (await DB.prepare(photoQuery.sql).bind("creator-b", ...photoQuery.values, photoQuery.limit, photoQuery.offset).all()).results;
  assert.equal(creatorAList.some((row) => row.id === "foreign-image"), false);
  assert.equal(creatorBList.some((row) => row.id === intent.assetId), false);
  db.close();
});
