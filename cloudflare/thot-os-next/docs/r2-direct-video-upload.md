# Staging direct video multipart upload

This staging-only path preserves MP4 and MOV H.264/H.265 originals in private
R2. The Worker creates the ingestion intent, authorizes one expected part at a
time, confirms a browser-observed ETag, completes the multipart upload, and
then hashes and validates the completed canonical object. It never receives a
video-part body.

The browser receives only a short-lived, single-part `PUT` authorization. It
does not receive a listing, delete, multipart-complete, or general bucket
authority. A failed browser `PUT` releases the part reservation without saving
the URL or browser error text. The final Worker verification remains the source
of truth for byte count, MIME type, SHA-256, container, and H.264/H.265 codec.

The deployment requires the feature flag
`R2_VIDEO_DIRECT_UPLOADS_ENABLED=1`. Before a Web approval can be generated,
a separately approved staging R2 configuration must set the exact CORS policy
and install narrowly scoped R2 S3 signing credentials as the two Worker secret
names `R2_VIDEO_UPLOAD_ACCESS_KEY_ID` and
`R2_VIDEO_UPLOAD_SECRET_ACCESS_KEY`. The credentials must be restricted to the
staging library-media bucket and multipart PUT/abort operations needed by this
staging workflow; they must not grant public read, bucket listing, or arbitrary
delete authority. No credential is created by this repository.

## Evidence

Observed 2026-08-29, confidence high:

- Cloudflare’s [R2 presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
  supports time-limited `PUT` authority and advises treating each URL as a
  bearer capability.
- Cloudflare’s [multipart upload documentation](https://developers.cloudflare.com/r2/objects/multipart-uploads/)
  defines `UploadPart`, `CompleteMultipartUpload`, and `AbortMultipartUpload`;
  every part except the final one must be at least 5 MiB.
- Cloudflare’s [R2 CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/)
  requires an explicit browser CORS policy and notes that the response header
  must be exposed for browser JavaScript to read it. This implementation uses
  only the staging origin, `PUT`, `content-type`, and `ETag`.

These sources should be rechecked when changing endpoint, signature lifetime,
browser origins, or R2 capability scope.
