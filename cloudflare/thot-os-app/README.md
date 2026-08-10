# THOT OS Cloudflare app

This directory contains the staged Cloudflare-first application foundation. It is separate from the live `creator-os-staging-gateway` so the existing automation gateway can continue operating during migration.

## Adelaide-first milestone

1. The `thot-os-staging` D1 database has been created and configured.
2. The Adelaide schema and verified data slice have been applied remotely.
3. Enable R2 once in the Cloudflare dashboard.
4. Create private `thot-os-media-staging` and `thot-os-previews-staging` R2 buckets.
5. Generate future Adelaide imports with `npm run cloudflare:export:adelaide`.
6. Compare remote D1 counts with `output/cloudflare/adelaide-manifest.json` after every import.

Do not enable public R2 access. Media delivery will use authenticated THOT OS routes and short-lived signed URLs.

The local SQLite database remains authoritative until the D1 import, creator isolation and media-preview checks have all passed.
