# One-time video links — local implementation plan

User-approved scope, 2026-10-05: start secure download links with bounded agents, reuse existing Git work, and implement a separate download Worker locally. No deployment, remote migration, live payment or credentials are authorized by this record.

## Existing foundations

Canonical checkout: `codex/thot-os-canonical`, HEAD `d8d6a85`, with substantial existing uncommitted work preserved. Available local Git history already contains verified native video intake, private downloads with byte ranges, and signed Stream playback. Neither local branch implements one-time sharing or payment collection. Existing invitations and internal media fetch tickets provide token-hash/expiry patterns, but their purposes must remain separate.

Reuse the verified video identity and range handling from `cloudflare/thot-os-next/src/app/api/source-media/videos/[assetId]/download/route.ts`. Do not make that private route public. Keep original R2 files unchanged and private.

## First delivery: free one-time links

- Creator opens a verified video, enters a recipient-safe title, confirms direct sharing rights, and selects **Generate one-time link**.
- Permit active authorized members only; server derives the actor and creator scope. Start with classified self-only assets, rejecting multi-person assets until a direct-sharing consent contract is approved.
- Persist only hashes of random link/session tokens in D1, bound to the exact creator, asset and immutable storage identity. Redemption deadline: 24 hours.
- Public GET displays the approved title, size and expiry without consuming the link. It must not reveal the original filename, notes, storage key or other library data.
- Explicit same-origin POST atomically redeems once and creates a one-hour browser download session. A scoped HttpOnly cookie permits range/resume requests during that window. A second browser cannot redeem the original link again.
- Every transfer request checks the link/session and current source eligibility. Revocation blocks future requests; it cannot retract bytes already transferred or reliably stop an already-running response.
- No public caching, referrer leakage, third-party analytics or bearer-token logging. Source objects are never moved, rewritten or deleted.

The initial web integration is explicitly opt-in and loopback-only (`CONTENT_DOWNLOAD_LINKS_LOCAL=1`). The public Worker is new and has no production deployment configuration. This is not a staged or released feature until the release gates below are met.

## Second delivery: payment test flow, then provider integration

Shared purchase page -> hosted checkout -> verified server-side payment event -> one buyer entitlement -> one-time download session. The return URL alone is never evidence of payment. Duplicate payment events must not produce extra entitlements. Begin with one video and one private sale; concurrency and late payments must not produce multiple charges for one available sale without a recovery path.

Payments go to the THOT OS merchant account. Agreed split: 50% creator / 50% THOT OS, sharing actual transaction fees equally. Store integer minor units, actual gross/fee/net and both shares; specify odd-cent allocation before implementing the ledger. Refund/chargeback handling and taxes remain open decisions. Keep existing platform CSV finance imports and commission records semantically separate.

No payment provider approval is inferred from other merchants using it. Tyro's actual content and multi-creator collection model still need confirmation before live use. Payment simulation must be confined to tests/local development and cannot unlock a live download.

## Acceptance and release gates

Behavioral tests must execute production helpers/handlers: missing/wrong scope, inactive membership, missing sharing approval, multi-person/unclassified/unverified media, altered object identity, expiry, competing claims, replay, wrong cookie, range/resume and revocation. Opening the page must remain non-consuming. Use synthetic metadata and bytes only.

Run root lint, tests, build and diff checks; run Worker checks/tests and affected Cloudflare integration checks. Verify desktop/mobile UI and a local browser download journey. Report any unmet checks as incomplete.

Before staging: choose a hostname and exact restricted bindings, add guarded deployment registry/tool coverage, review a clean release artifact, approve the additive migration range with backup/ledger/recovery evidence, and approve the deployment plan. A shared local D1 fixture is required for the web app and download Worker. No credentials or real customer content belong in fixtures. Deployment is not authorized by local completion.

Staging rollback: disable issuance and public delivery, retaining audit records and original files. Expire/revoke issued links; do not drop tables or rewrite migration history. Production remains excluded.

## Limits to communicate

One-time means one redemption into a resumable session, not proof of saving a file. Anyone holding an unused link can claim first; downloaded copies can be redistributed. Losing the session cookie requires a creator-issued replacement. One hour is the initial resume window, subject to large-file testing. Public preview title is creator-approved; no automatic source-media preview is exposed.

## Local implementation evidence — 2026-10-05

Implemented by two bounded Terra agents with Luna Git exploration/review and ATLAS integration. Read-only `git ls-remote --heads origin` advertised nine branches; their tip objects were available locally. No reusable one-time sale/download implementation was found in the inspected committed source. No fetch, push, reset or cleanup was performed.

Added files:

- `cloudflare/thot-os-app/migrations/0063_content_download_links.sql`
- `cloudflare/thot-os-next/src/lib/content-download-links.ts`
- `cloudflare/thot-os-next/src/app/content-link-actions.ts`
- `cloudflare/thot-os-next/src/components/content-link-form.tsx`
- `cloudflare/thot-os-next/tests/content-download-links.test.mjs`
- `cloudflare/thot-os-next/tests/content-link-actions.test.mjs`
- `cloudflare/thot-os-downloads/{package.json,tsconfig.json,wrangler.local.example.jsonc,src/index.ts,tests/surface.test.mjs}`
- This plan/evidence record.

Changes to existing files are limited to the local-only panel in `cloudflare/thot-os-next/src/app/library/[objectId]/page.tsx`, new dependency mocks in `tests/native-preview-reload-recovery.test.mjs` under that app, root package test/typecheck wiring, and the pending migration entry plus its root `tests/bounded-d1-migrations.test.mjs` expectations. Pre-existing changes in these files were preserved. The applied staging ledger was not advanced.

Checks passed:

- `npm run lint`
- `npm test` (root, application, and new Worker suites)
- `npm run build`
- `npm run verify:cloudflare`
- `npm run deployment:preflight -- --environment staging --all` (existing registered targets only; the new Worker deliberately has no staging target)
- `npm --prefix cloudflare/thot-os-downloads run check`
- From the download Worker directory: `../thot-os-next/node_modules/.bin/wrangler deploy --dry-run --config wrangler.local.example.jsonc --outdir /tmp/thot-download-worker-build` (bundle only, no deployment)
- `git diff --check`

Integration failures found and fixed during verification: pending-migration inventory registration and two existing page-test dependency mocks. The final full test rerun passed. A first dry-run command used an incorrect npm prefix and failed before execution; the corrected direct Wrangler invocation above passed.

Not yet verified: real browser creator-to-recipient journey, shared local web/Worker fixture setup, representative large-video recovery, or remote behavior. No staging release, remote migration, live payment, checkout simulation, or ledger/payment integration was performed. The first local slice is implemented; these remaining checks and the separate payment phase are not claimed complete.
