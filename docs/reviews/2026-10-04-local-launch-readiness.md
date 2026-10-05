# Local launch readiness review — 2026-10-04

Status: reviewed local engineering changes only. Final verification passed 111 root tests, 283 canonical app tests, 59 public/Telegram Worker tests, lint, Next and OpenNext builds, all ten staging static preflights, production baseline check and diff whitespace checks. The first final app run found one obsolete receipt source-text assertion; after updating it for the covered uncertain late-receipt behavior, the full app rerun passed 283/283. No deployment, remote migration, push, merge, private upload, new grant or credential change was performed. Original user work was preserved before work in an isolated checkout. The tested incremental bundle is backed up and hash-checked during reconciliation into the original checkout.

## Architecture and launch boundary

The current canonical app is `cloudflare/thot-os-next` on Cloudflare Workers/OpenNext. D1 owns identity, metadata and workflows; private R2 owns native source media. Legacy source identifiers remain accessible through creator-scoped catalogue lookup. Aspect is not a launch dependency and no storage replacement decision was made.

Email OTP remains the selected login mechanism. The documented outer Access policy has a manual email allowlist; invitations alone do not establish that a newly invited email can reach the app. Approve and validate the intended Access policy separately before recruiting broadly. No policy was changed here.

## Reviewed changes

Catalogue pagination, stable ordering, escaped literal search, HEIC recognition and creator isolation; metadata detail links for originals without previews; explicit rejection of classification batches above 50; suspended/inactive invitation acceptance prevention and recipient-specific invite pages; honest skipped readiness; unset finance rules distinguished from a saved zero commission; stale/missing/future growth evidence excluded from confidence; declared video checksums labelled as client declarations; retryable image finalization without reupload; bounded image/video reconciliation counters; fenced preview queue leases and actual schema status/error names; native preview producer SQL compatibility and canonical object revision consistency; expired Fansly upload claims held for reconciliation, scoped late receipts and server-confirmed extension success; frozen production baseline checks; public Worker CI checks; local development awaits local bindings and uses the working webpack compiler.

## Release checks

Run from the repository root:

```sh
npm run lint
npm test
npm run build
npm run verify:cloudflare
npm run d1:production-baseline:check
node scripts/deployment-preflight.mjs --environment staging --all
git diff --check
```

Migration tests use disposable local D1. Restricted environments may need permission for Wrangler loopback and log output. Build downloads public Google fonts. These commands do not deploy.

Before any production action: review exact artifact and environment configuration; approve production resources and Access policy; take verified backups; compare the intended migration plan with the live ledger; validate rollback and an isolated creator invitation/login/upload/catalogue flow. Production baseline generation deliberately stops at the reviewed invitation boundary, rather than silently including later staging migrations.

## Remaining limitations and decisions

Browser synthetic upload QA reached local intent creation and part upload, but final browser completion was not established; executable route/component/SQLite tests cover recovery and isolation. The file chooser stalled and will not be repeated.

The current checked-in bridge is Fansly-only. Earlier OnlyFans code was removed during the D1/R2 cutover; a separate installed/deployed OF bridge may exist and has not been validated. Do not restore historical session capture or make provider-readiness claims from device reachability alone. Confirm the actual existing OF artifact before proposing any replacement.

Finance is manual normalized CSV and provisional allocation, not reconciled receivables or payment transfer. Creators receive platform earnings and owe THOT OS commission under agreed terms; the current app supports only a provisional percentage calculation on imported net earnings, while the rate, base, costs and cadence require agreement. Instagram evidence does not prove exclusive subscriber/revenue attribution.

Video SHA values in the legacy column are uploader declarations; storage identity, bounded container checks and byte length are verified separately. A full-body hashing worker remains a separate architecture decision. Existing R2/D1/Images/Queues dependencies need adapters for a plain Linux daemon; no Linux installation or migration was undertaken.

Subsequent local checkpoint: [synthetic journey, preview recovery, separate OF artifact and scoped commission proposals](2026-10-04-local-journey-and-commission.md). That checkpoint supersedes the earlier browser-completion limitation and provisional imported-net commission description; deployment and external-policy dependencies remain gated.
