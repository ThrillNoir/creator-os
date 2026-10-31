# Video thumbnails: release plan

Status: local, unactivated candidate. This document grants no deployment, access, or media-run permission.

## What exists locally

- An FFmpeg/FFprobe extractor handles verified H.264 and H.265 originals on the Mind and deletes temporary source copies. Large synthetic H.265 extraction was tested. Manual **Choose thumbnail** stays available and takes precedence.
- A bounded, creator-specific runner supports a read-only `--plan`, an exact-plan `--apply`, and a disabled optional `--tick`. Normal defaults are two items and 3 GiB of source bytes per invocation, processed sequentially. The executable is `scripts/video-thumbnail-mind-runner.mjs`; no schedule is installed.
- The Mind D1 REST port allows only `SELECT`. The only proposed D1 write goes through `POST /api/internal/video-thumbnail/commit` on the existing `thot-os-staging` Web Worker, using its `DB` and private `PREVIEWS` bindings. There is no generic SQL proxy, D1 Edit API token, or schema migration.
- The endpoint requires the existing Cloudflare Access boundary **and** an internal service bearer. It accepts only one operation: set a missing `assets.preview_r2_key` for an exact creator and asset. The existing service auth helper checks an active principal, credential, creator grant, and the `library.thumbnail.commit` capability. The endpoint verifies the canonical source key/revision/version/ETag/byte count and codec, exact private poster key and object metadata, JPEG bytes, and content hash. Its D1 compare-and-swap preserves a manual choice or changed source; replay is idempotent. It records a service audit event. Request body is capped at 4 KiB with a five-second read deadline.
- The runner would read originals only from `thot-os-library-media-staging` and write JPEGs only to `thot-os-previews-staging` using separate bucket-scoped R2 keys. It never rewrites source media. The generated poster is content-addressed, not another full-video copy.

## Activation boundary

The endpoint and runner are **not deployed or configured**. The existing Mind D1 read token is sufficient for planning but not for an apply. These additional rights and deployment actions need a separate exact review:

1. Deploy the reviewed Web candidate to `thot-os-staging`, which also binds D1 `thot-os-staging` (database `174532e8-5ada-4e30-abba-1276b3540b3f`) and `PREVIEWS=thot-os-previews-staging`. Confirm the endpoint is still behind Cloudflare Access. This does not generate posters by itself.
2. Provision a dedicated internal principal `thot-os-thumbnail-runner` with an active credential and the single capability `library.thumbnail.commit` granted only to Adelaide for the first run, using the existing service tables. Configure a Cloudflare Access service credential admitted only for the staging Web app/route, if supported by the existing Access policy. Store both credentials privately on Mind; no token values belong in source, logs or chat. These are persistent access changes and are not authorized by local implementation approval.
3. Provision or verify two R2 S3 key pairs limited to Object Read on `thot-os-library-media-staging` and Object Read/Write on `thot-os-previews-staging`. Use the existing D1 read token only for reads. Do **not** create an account-scoped D1 Edit token.
4. Before any original read, prove against a non-sensitive object that S3 HEAD/GET expose the exact R2 version, ETag and size stored in D1. The runner fails closed if `x-amz-version-id` is absent or differs. If R2 S3 cannot provide the Workers R2 version, implement and review a binding-backed source-identity bridge before any real-media run; do not relax the comparison.
5. Refresh Adelaide's candidate list. The previously selected two verified, posterless videos total about 95.2 MB of original source; skip them if a manual or other poster has appeared. Run one exact plan limited to two Adelaide videos and at most 3 GiB, confirm at most two private JPEG writes and two conditional poster-reference updates, inspect receipts and Library cards. No draft publication or public More change is part of this run.

The D1 database is also consumed by the live More publication control. Only the private poster-reference update is proposed here; the shared-database effect must be named in the exact approval. A Web rollback does not undo D1/R2 poster changes. No timer, hosted FFmpeg service, full backlog, synthetic-data cleanup, or production resource change is included.

## Failure and cost limits

- Abort on missing/mismatched source version, ETag or byte count before downloading. After extraction, recheck source and poster state. A concurrent manual choice wins the conditional database update. A failed or uncertain commit is not blindly retried; inspect the asset and R2 object first.
- R2 and D1 are separate stores. A failed conditional update may leave an unreferenced private JPEG. A later bounded reference-checked cleanup needs its own plan; do not delete it immediately in a race.
- The run requires temporary disk space for the selected original, up to 5 GiB per file by implementation cap; the proposed first two use about 95.2 MB total. Output is capped at 12 MiB per poster. The run uses Mind CPU, R2 read/write operations, poster storage and D1 operations; it does not create durable full-video copies or enable a scheduled service. Review storage class and [R2](https://developers.cloudflare.com/r2/pricing/) and [D1](https://developers.cloudflare.com/d1/platform/pricing/) pricing before larger batches.
- For rollback of a generated poster, first verify the exact key from the receipt and no later manual replacement. Clear only that reference with a reviewed conditional operation; retain the private object until no other reference exists. Code rollback alone cannot remove a stored poster.

## Verification before approval

Locally, run focused endpoint/runner tests, the synthetic large H.265 extraction proof, root/app test suites, typecheck, lint, and build. Independently review the endpoint auth and race paths. After future activation, verify the deployed Web version and Access policy before a bounded apply, then have the creator view the two Library cards. Browser acceptance is separate from programmatic storage verification.
