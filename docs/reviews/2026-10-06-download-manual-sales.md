# Private download sale records — local milestone, 2026-10-06

This work follows the locally tested fixes, styling and custom-message commits (`c3bfd2b`, `6568203`, `579715e`) and the proposal at `ad86fe2`. It does not authorize remote migration, deployment, payments or public exposure changes.

## Human decision and scope

The owner chose to retain recipient names/labels until manually cleared, then clarified that an identifier is sufficient and a full name is unnecessary. ATLAS verified the actual user messages in the `Money Penny` conversation (`01a10fe5-a6ca-76c6-874a-b6211e74b0e7`, October 6), rather than treating another task's summary as fresh authority.

Use a creator-entered private identifier, such as a platform handle or reference, retained until explicitly cleared. No automatic purge, full-name requirement, inferred identity, shared client entity or cross-platform merging. Identical references do not establish verified identity. This is private per-video sales history, not a CRM or verified lifetime-spend model.

Implemented acceptance: optional identifier and amount/currency at generation; private history with correction, recipient clear and sale void; separate currency totals with paid/complimentary counts; public projections omit all private fields; existing access, source-media, expiry and revocation rules preserved. Clearing a recipient must keep monetary values and remove the identifier from ordinary application data without writing it into correction audit. Voiding a manual sale must not revoke a link, imply a refund or silently restore on a later correction.

The recipient control does not promise immediate erasure from pre-existing backups. No retention claim about backup copies is made here.

## Local release dependency

Migration 0064 remains pending. Sales migration 0065 also remains pending and must follow 0064 before any future web release querying its columns. Old migrations and recorded applied staging history remain unchanged. Future remote apply requires the existing approved-range, fresh backup, ledger, recovery and release-evidence process. Rolling back application code should retain additive columns/data; do not rewrite or drop applied schema.

Expired-page exposure remains undecided and unchanged. Neither identifier nor amount/currency is ever part of the recipient-facing download page. Existing public custom-message behavior follows title eligibility, not private sales data.

## Changed files and validation

- `cloudflare/thot-os-app/migrations/0065_content_download_sales.sql`: additive private recipient/money/revision columns, amount/currency constraints and correction audit without raw recipient references.
- `cloudflare/thot-os-next/src/lib/content-download-sales.ts`: decimal validation, bounded history, separate currency totals and membership-scoped compare-and-swap corrections, clearing and voiding.
- `cloudflare/thot-os-next/src/lib/content-download-links.ts`: optional validated private sale fields at link creation; explicit public projections remain unchanged.
- `cloudflare/thot-os-next/src/app/content-link-actions.ts`: verified actor/host-gated history and update actions.
- `cloudflare/thot-os-next/src/components/content-link-form.tsx` and `content-download-sales.tsx`: optional private fields, manual-record explanation, paginated correction controls and safe refresh feedback.
- App tests `content-download-sales.test.mjs`, `content-download-links.test.mjs`, `content-link-actions.test.mjs`: parser, authorization, stale-write, money, privacy and action contracts.
- `cloudflare/thot-os-downloads/tests/local-integration.test.mjs`: replay all 67 migrations and prove real local Worker HTML omits private recipient and money fixtures.
- `config/staging-d1-migration-ledger.json` and `tests/bounded-d1-migrations.test.mjs`: register 0065 as pending only, preserve applied history and test bounded-plan exclusions.

Independent review found no remaining actionable issue after fixing membership-check races and complimentary labels. Every sales read and mutation checks active membership in its own SQL statement. Command outcomes:

Limitations: sale counts represent manually recorded link sales, not processor-confirmed transactions. Replacement links must not duplicate an earlier sale amount. No cross-video/client lifetime totals, client identity merge, payment integration or automatic payout exists in this milestone. No live browser or remote release verification is claimed.

- `npm test`: passed, 119 root + 354 app + 8 downloads = 481 tests (`/tmp/thot-oct6-sales-tests.log`). The subsequent test-only expansion was verified with the focused command below.
- From the app directory, `node --experimental-strip-types --test tests/content-download-links.test.mjs tests/content-download-sales.test.mjs tests/content-link-actions.test.mjs`: final focused suite passed 25/25 (`/tmp/thot-oct6-sales-focused.log`).
- `npm run lint`: passed (`/tmp/thot-oct6-sales-lint.log`).
- `npm run build`: passed (`/tmp/thot-oct6-sales-build.log`).
- `npm run verify:cloudflare`: passed (`/tmp/thot-oct6-sales-cloudflare.log`).
- `npm run deployment:preflight -- --environment staging --all`: all 11 static component checks passed (`/tmp/thot-oct6-sales-preflight.log`). This is configuration validation, not deployment evidence.
- `git diff --check`: passed.

All logs are local temporary evidence. No remote migrations, deployments, provider sends or source-media mutations occurred. Migrations 0064 and 0065 remain pending.
