# Private R2 source media

## Boundary

`thot-os-library-media-staging` is the private canonical-originals bucket. It
is distinct from the existing preview, profile-image, adult-media and
deliberately public-media buckets. Original object keys use `originals/v1/` and
a server-generated UUID; they contain no filename, Dropbox path, handle or
presigned URL.

| Store | Purpose | Public access |
| --- | --- | --- |
| `thot-os-library-media-staging` | canonical source originals | never |
| `thot-os-previews-staging` | private Library previews | authenticated only |
| `thot-os-media-staging` | private profile-image originals and derivatives | authenticated only |
| `thot-os-adult-media-staging` | approved adult-profile derivatives | gateway-controlled |
| `thot-os-public-media-staging` | explicitly approved public exports | intentional only |

`asset_storage_objects` remains the canonical record for every source copy.
`creator_media_source_states` chooses a creator's active backend. It begins at
`dropbox`; the R2 path cannot be activated until every currently available asset
has a verified private object. If R2 is active and an object is missing or has
the wrong byte count, delivery fails closed rather than silently using Dropbox.
Rollback is a metadata-only switch back to Dropbox and never deletes an object.

## Ingestion

The authenticated source-media routes operate only on an existing,
creator-scoped asset. An intent creates an opaque R2 multipart upload and a
30-minute D1 session. The multipart ID is retained only in that expiring
session, is never returned to the client, and is cleared after finalization.
Each part is claimed in D1 before it reaches R2, preventing replay or a second
writer from changing a completed part.

Finalization requires all parts, streams the completed object through SHA-256,
checks byte count and magic-byte media type, and only then marks the catalogue
record `verified`. The routes return `private, no-store` and `nosniff` headers.
No source-original route issues or stores a presigned URL.

## Dropbox migration

`scripts/source-media-migration.mjs` takes an explicit creator/asset mapping.
It resolves each listed relative path below one read-only root, rejects symlinks
and traversal, produces a mode-0600 manifest, and binds the plan to the
mapping, manifest, bucket, clean Git identity and a digest-derived confirmation.

The staging-only `apply` path is intentionally opt-in. It hashes each source
again, uploads to the private bucket, downloads and hashes the object again,
then registers only verified objects in D1. It does not activate R2 for a
creator. `verify` performs the remote verification again without re-uploading.

Use a mapping shaped like:

```json
{
  "schemaVersion": 1,
  "creators": [{
    "creatorId": "example",
    "sourceFolder": "example-source-folder",
    "assets": [{ "assetId": "authoritative-asset-id", "relativePath": "subfolder/file.jpg", "sourceRevision": "optional-source-revision" }]
  }]
}
```

The mapping is a protected migration input, not a public catalogue. Do not put
absolute paths, tokens, signed URLs, platform credentials, or private notes in
it. Generate and review inventory and plan receipts before using `--execute`.

## Operational sequence

1. Apply the schema only through the bounded staging D1 migration workflow.
2. Create the private staging R2 bucket and deploy its binding only after the
   reviewed schema plan is approved.
3. Run `inventory`, `plan` and `export` against a read-only source root.
4. Review the count/byte/checksum plan and explicitly approve a staging apply.
5. Verify every object, inspect D1 audit records, then request an R2 cutover
   for one creator.
6. Run private Library, paired-device and upload acceptance checks.
7. Keep Dropbox as the explicit rollback source until the agreed retention and
   recovery period ends. Dropbox retirement is intentionally out of scope.
