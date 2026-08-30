# Private native video intake and playback decision

## Decision

Native video originals are admitted to the existing private `LIBRARY_MEDIA` R2
bucket through creator-scoped multipart sessions. The original is the
immutable authority: its R2 version, ETag, byte count, detected container,
H.264/H.265 marker, and SHA-256 must all verify before the asset becomes
`canonical_verified`.

This phase does **not** provision Cloudflare Stream, a Stream token, a billing
change, a public delivery URL, or a transcoder. Consequently it does not claim
that any browser-playable derivative exists. A canonical H.265 original is an
accepted archival input, not a statement that Chrome, Firefox, Safari, or a
mobile browser can play that original.

The Library therefore provides authenticated download of the verified original
with a non-cacheable, creator-scoped response, and describes browser playback
as pending. Vault, Instagram, Reddit, and every other consumer stay blocked.

## Intake boundary

- Files: MP4 (`video/mp4`) and MOV (`video/quicktime`), up to 5 GiB each.
- Codecs: H.264 (`avc1`) and H.265/HEVC (`hvc1`/`hev1`) container markers are
  required after upload. A mismatched extension, declared MIME, magic bytes,
  container, checksum, byte count, creator, asset, or R2 identity fails closed.
- Transport: the browser hashes incrementally, creates an opaque intent, and
  uploads 8 MiB parts through authenticated Worker endpoints. No browser
  receives an R2 object key, multipart ID, presigned URL, account credential,
  or bucket-wide capability.
- Limits: no more than two active video sessions per creator. Sessions expire
  after eight hours. The next video-intent mutation clears abandoned expired
  sessions; incomplete R2 multipart uploads remain subject to the bucket's
  incomplete-multipart lifecycle cleanup.
- Finalization: D1 claims finalization once, completes the multipart upload,
  streams and verifies the stored object, and only then records immutable R2
  identity and `canonical_verified`. Replays report the recorded state instead
  of creating a second asset.

The temporary checksum stored on a pending `asset_storage_objects` row is only
a schema-required placeholder. `asset_video_ingest_sessions.expected_sha256`
is the expected source checksum; the storage row receives the real checksum
only at successful verification and cannot become `verified` without R2
version and ETag.

## Playback-provider gate

Cloudflare documents Stream as a managed H.264 adaptive-streaming platform
with HLS/DASH delivery, but its current upload documentation does not provide a
clear guarantee that the intended H.265/HEVC on-demand source inputs are
accepted. We therefore cannot safely select it just by inspection.

Before enabling a derivative, create a separate reviewed provider plan that:

1. obtains explicit approval for any Stream provisioning, billing, and the
   least-privileged secret/token installation;
2. runs disposable H.264 and H.265 upload probes against the proposed provider
   and records API acceptance, processing status, HLS/DASH availability, and
   authenticated Chrome/Safari/Firefox/mobile playback observations;
3. stores provider resource ID, immutable derivative identity, retry count,
   safe failure code, and readiness in `asset_video_playback_states` without
   replacing the R2 original;
4. adds an authenticated playback route with Range support where an R2-backed
   derivative is used, and retains no public canonical URL;
5. deploys the provider worker and each downstream consumer under separate
   approval tokens only after the compatibility evidence exists.

`processing_queued`, `processing`, `playback_ready`, and
`processing_failed` are reserved durable states for that approved provider
phase. This foundation creates no processing work and no automatic publishing.

## Evidence reviewed on 2026-08-28

| Observation | Confidence | Recheck |
| --- | --- | --- |
| Workers request-body limits vary by plan, so an entire large video must not be proxied in one request. | High | Before any account-plan or upload-limit change. |
| R2 multipart operations from a Worker support large objects when each part stays inside the Worker request limit; 8 MiB is chosen here. | High | Before changing part size or R2 binding. |
| Cloudflare Stream direct creator uploads use one-time URLs and use TUS for uploads over 200 MB. | High | Before provider provisioning. |
| Stream documents H.264 adaptive playback, but the reviewed documentation does not confirm this product accepts our HEVC source set. | Medium; absence-of-documentation inference | Mandatory disposable H.264 + HEVC probe before selection. |

Sources: [R2 multipart uploads from Workers](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/),
[R2 object upload limits](https://developers.cloudflare.com/r2/objects/upload-objects/),
[Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/),
[Stream direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/),
[Stream resumable uploads](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/),
and [Cloudflare Stream overview](https://developers.cloudflare.com/stream/).

## Disposable staging smoke checklist

After the staging migration and Web deployment have both been separately
approved, use non-creator disposable files only:

1. Select a small H.264 MP4 and confirm hash progress, multipart progress,
   final verification, Native listing, codec label, and authenticated download.
2. Repeat with an HEVC/H.265 MOV or MP4. Confirm it is preserved and labelled
   canonical, but not presented as browser-playable.
3. Refresh midway through a multipart upload, select the same disposable file,
   and confirm the saved upload ID resumes without a second asset.
4. Attempt an extension/MIME mismatch, a truncated file, and a cross-creator
   URL request; each must fail without exposing object identifiers or bytes.
5. Request a valid and invalid HTTP byte range from the authenticated download
   route; verify `206`/`416`, `private, no-store`, and no cacheable redirect.
6. Confirm `/health` reports canonical video readiness separately from playback
   and that all consumer readiness remains false.
