# Staging download schema reconciliation — 6 October 2026

The owner explicitly approved backup/recovery and migrations 0064–0065 only in Money Penny; ATLAS verified the human reply. No Worker deployment, production, authentication or credential change was authorized or performed.

## Observed result

- Source at apply: `6ba4a0a67117603a08c003a7c448289bbafbfa61`, clean `codex/onboarding-download-ux`.
- Account: `3e7cfa6efb7a97825f1dc24515410c63`; D1: `thot-os-staging` / `174532e8-5ada-4e30-abba-1276b3540b3f`.
- Approved and freshly rechecked plan: `232df5739fdb36528f923637a44eba503e605850b7ab2d5efbdb0c608d70d5ba`. Scope, source, file hashes and remote history matched exactly.
- Fresh owner-only backup passed checksum, plan/target/history binding, isolated replay, database integrity and foreign-key checks. Its checksum/receipt are bound in the migration receipt; private SQL remains outside Git.
- Guarded application result: `APPLIED`, remote mutation `CONFIRMED`, no unknown outcome or failed migration.
- Actual remote ID 66: `0064_content_download_message.sql`, applied 2026-10-06 09:48:48 UTC (17:48:48 Perth).
- Actual remote ID 67: `0065_content_download_sales.sql`, applied 2026-10-06 09:48:52 UTC (17:48:52 Perth).
- Post-apply read-only verification at `2026-10-06T09:49:28.738Z`: exact 67-entry history, all eight new columns, revision default 0, links/audit tables, audit index and three triggers present. `quick_check=ok`; zero foreign-key violations.

Durable receipt: [migration receipt](../release-receipts/2026-10-06-download-followup-migrations.json). Full schema observation is in the owner-only external `download-followup-2026-10-06/post-migration-verification.json` release package. These are dated observations, not permission for future execution.

## Local reconciliation and remaining gate

Moved only the two verified entries to applied in `config/staging-d1-migration-ledger.json`, preserving the previous 65 entries. Recorded actual IDs 66/67; no pending entries remain. Updated the bounded-ledger regression expectations. Migration SQL is unchanged.

This evidence commit changes the source identity. Rebuild web/downloads artifacts and generate fresh guarded staging deployment plans from the clean reconciliation commit; request approval of those exact plans before either Worker is changed. Candidate behavior was tested at 6ba4a0a (487 tests plus lint/build/Cloudflare/preflight); this reconciliation does not claim live acceptance of new code. The dirty canonical checkout remains untouched.

Recovery retains additive schema/data. Do not drop the columns/audit table or rewrite applied history. Worker restoration requires a reviewed operation; wrappers have no rollback subcommand.

Validation: `node --test tests/bounded-d1-migrations.test.mjs tests/download-staging-config.test.mjs` passed 22/22; all 11 staging static preflights and `git diff --check` passed. No implementation changed, so the full behavior suite was not repeated for this ledger/evidence-only commit.
