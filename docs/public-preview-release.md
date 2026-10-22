# Public creator link previews — release 1

Scope: `https://www.thathuboverthere.com/<handle>` only. The apex remains blank/404. The protected More site, age gate, booking, and link redirects are unchanged.

## Safe release order

1. Deploy the public-media Worker with the `/preview/*` route and bundled fallback. Check that `/preview/site.png` returns a 1200 × 630 PNG without a Referer.
2. Deploy the public-links Worker. It reads both old and new snapshots. Verify an existing creator page returns 200 and its OG image URL serves the fallback PNG. Verify an absent creator is an HTML 404.
3. Deploy the public-links-control Worker, then the THOT OS Web Worker. New approved public publications now write an `og` block. The dashboard accepts an optional 1200 × 630 PNG on a private draft; it is copied to public R2 only by the profile publication workflow.
4. Run `node --experimental-strip-types scripts/backfill-public-preview.mjs` for a read-only count. After confirming the Worker versions, run it with `--apply --backup-dir <owner-only-directory>`. The script backs up each exact prior KV value and metadata before writing and refuses to overwrite a value changed during the run. Do not backfill before step 2: the old Worker rejects unknown snapshot fields.
5. Run `node scripts/verify-public-preview.mjs https://www.thathuboverthere.com` to check all KV-listed published handles. The live host allowlist may intentionally exclude a published but dormant KV record; investigate such a mismatch without broadening the allowlist automatically. Check the real social preview in a crawler tool separately because provider caching and Cloudflare zone controls are outside this release.

The branded fallback contains no creator media. A creator's custom public PNG uses one `preview/<slug>.png` R2 key and is served only while the matching published snapshot/version is present. The private upload uses a version-scoped key. A new profile draft needs its own custom preview upload; otherwise its next publication uses the branded fallback.

Rollback: stop new profile publishes. Restore the backed-up KV values **before** reverting the public-links Worker, because the old Worker rejects the new `og` field. Then restore the prior Web, publication-control, public-links, and public-media Worker versions through the repository release runner. The backfill backup files contain published profile data and must remain owner-only.
