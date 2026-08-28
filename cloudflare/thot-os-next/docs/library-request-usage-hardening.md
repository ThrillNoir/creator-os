# Library request-usage hardening

## Scope

This staging-only change reduces automatic Library requests. It does not alter
Dropbox, D1, R2 objects, upload sessions, or the H.264/H.265 canonical-original
contract.

## Measured request behaviour

The previous Library client requested preview status immediately and then every
three seconds while preview work remained. That permits 21 status requests in
the first 60 seconds (at seconds 0 through 60 inclusive) for one open tab.

The replacement schedules one request after five seconds and, when the status
does not change, backs off to 15, 30, then 60 seconds. That permits three
requests in the first 60 seconds (at approximately seconds 5, 20, and 50): an
86% reduction for an unchanged pending state. Once it reaches the steady state,
it permits at most one request per minute rather than 20: a 95% reduction.

It sends no request when no image previews are pending. Video extensions are
excluded from the image-preview query, so a video-only native Library has zero
preview-status polling requests. The poller also pauses hidden or offline tabs,
allows only one request in flight, and cancels its timeout and request on
unmount.

These are behaviour bounds from the code, not estimates of real traffic.

## Upload request review

Native video uploads retain their private R2 multipart protocol in this pass.
The configured part size is 8 MiB for files up to the 5 GiB video limit. A
maximum-size video therefore uses 640 part requests, plus one authenticated
intent request and one finalization request: 642 Web Worker requests before any
retry. Each part is then streamed by the authenticated Web Worker to the
private R2 binding.

### Recommended next stage: direct private R2 multipart uploads

Implement a separately reviewed direct-to-R2 multipart design only after this
Library polling deployment is stable. The Web Worker should continue to create
the creator-scoped intent and verify/finalize the immutable object identity,
but should issue short-lived, single-operation, path-scoped upload authority to
the browser. This would remove the part-body proxying from the Web Worker while
retaining private canonical originals and the existing finalization checks.

It requires a dedicated security review for scoped R2 credentials or presigned
upload URLs, bucket CORS, short expiries, replay handling, and multipart part
authority. It is deliberately not implemented here.

Evidence: Cloudflare documents R2 presigned URLs as temporary bearer authority
for one object operation, including browser PUT uploads.

- Source: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Observed: 2026-08-28
- Confidence: high
- Recheck before implementation: required, because R2 multipart and temporary
  credential capabilities may change.
