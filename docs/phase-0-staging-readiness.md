# Phase 0 staging readiness

Baseline: release commit `072346e` (2026-08-31, Australia/Perth). This is a
readiness/runbook record, not approval to deploy or send provider content.

## Readiness matrix

| Area | Automated evidence in this release | Readiness | Remaining action |
|---|---|---|---|
| Reddit accounts | `tests/d1-migration-0055-provider-connection-account-scope.test.mjs`, `tests/foundation.test.mjs`; scheduler selects `post.account_id`, verifies the selected Reddit identity, and rejects mismatches | **Code ready; live unproven** | Client must reconnect/select each intended account and verify identity before proof posts |
| Instagram accounts | `tests/instagram-provider-scope.test.mjs`, `tests/foundation.test.mjs`; scheduler resolves `post.account_id` and uses that connection for publish, sync, replies and seen | **Code ready; live unproven** | Client must connect each intended account and verify the displayed native identity |
| X accounts | Generic operational-account storage/onboarding accepts multiple X accounts; no X publisher is present | **No publisher in scope** | Keep X account records distinct; add X authority/publisher only with a separate implementation and tests |
| Telegram messages | `tests/foundation.test.mjs`, `tests/identity-isolation.test.mjs`; shared polling cursor routes updates by configured chat, creator-scoped threads, validated bot identity, pause/write gates, idempotent send log and failure/uncertain receipts | **Code ready; live unproven** | Client validates bot identity and performs a read-only refresh, then separately authorizes any send |
| Instagram messages | `tests/foundation.test.mjs`; creator/thread joins, subscription refresh, recipient validation, 24-hour reply window, provider-confirmed seen, human approval, pause/write gates and failed/uncertain states are implemented | **Code ready; live unproven** | Client refreshes a real inbox, validates one recipient, and approves any live reply only after review |
| Fansly messages | `tests/foundation.test.mjs`; signed creator/account bridge, ingest dedupe, per-thread sync state, approved-only outbox, browser claim and device receipt/failure are implemented | **Code ready; device proof required** | Client pairs the assigned browser profile, refreshes/ingests, and verifies a no-content or explicitly approved device action |
| Thread isolation | `tests/identity-isolation.test.mjs`; unified message queries join creator and connection, and bridge queries bind creator/account/thread together | **Automated** | Include a second creator/account in read-only staging inspection; no cross-workspace data should appear |
| Unread/read transition | Instagram uses provider-confirmed `seen` before setting `unread_count=0`; collected Telegram/Fansly read state is local/ingest-driven | **Mixed** | Verify Instagram provider read receipt; verify local read transition for collected streams without treating it as provider confirmation |
| Emergency pause | Unified Messages pause is creator-scoped and each outbound worker checks `emergency_paused` | **Automated; live unproven** | Client toggles pause in staging and confirms outbound controls lock while refresh remains available |

## Automated checks

Run from the release worktree:

```sh
npm test -- --test-name-pattern='provider|Instagram|Unified Messages|creator scoped|Reddit'
npm --prefix cloudflare/thot-os-next test
npm run lint
npm run build
```

The first command is a focused smoke selection; the second is the complete
Cloud Next test surface. For a full release check also run `npm run verify`.
No automated test should call a provider or mutate staging D1.

## Read-only staging evidence

An operator may collect, without migration, reconnect, send, publish, or D1
mutation:

1. Confirm the protected web Worker is the intended release and that the
   staging QA page is enabled. The page explicitly states that its probes do
   not publish, message, upload, or retrieve media.
2. In the authenticated workspace, record the selected creator, visible
   operational accounts, account labels/handles, connection status, and
   provider identity-confirmed timestamps. Do not copy credentials or private
   notes.
3. Open Unified Messages for Telegram, Instagram and Fansly. Record connection
   status, thread counts, unread counts, last-sync timestamps, and existing
   receipts. Do not press Refresh, Pair, Validate, Send, or Read unless the
   client-assisted actions below have been authorized.
4. Confirm the account and creator IDs on any read-only response match the
   selected workspace. A mismatch is a stop condition.

Capture observation time (Australia/Perth), release SHA, Worker/version
identity, creator/account labels, and result. Treat this as evidence of the
observed staging state, not proof of provider success.

## Reddit live proof prerequisites

Before one creator-profile post and one subreddit post (the profile target is
implemented by another task), the client must complete both checks:

1. Select the exact intended Reddit operational account in Operations. Reopen
   or reconnect it if needed; confirm the returned native identity exactly
   matches the configured handle. A different identity blocks the proof.
2. For the subreddit post, select the same explicit account and an active
   subreddit whose rules/flair requirements have just been refreshed and
   acknowledged. Confirm the post is approved, has verified private R2 media,
   and has no missing required flair.

For each proof, record the account label, native identity, target, approval,
provider URL/ID returned by the provider, and the human approval timestamp.
Do not infer account identity from a handle alone.

## Client-assisted live actions (explicit approval required)

These are the only actions that can move the matrix beyond “live unproven”:

- **Reddit:** reconnect/select account and perform the two small approved
  proof posts after the prerequisites pass; stop on any identity or receipt
  mismatch.
- **Telegram:** validate bot identity; refresh inbound messages; only then,
  if separately approved, send one human-reviewed message and verify its
  provider receipt. A failed or uncertain receipt requires inspection before
  retry.
- **Instagram:** refresh inbound messages; validate the exact recipient;
  verify the active reply window; only then, if separately approved, send one
  human-reviewed reply and verify the provider receipt/seen transition.
- **Fansly:** pair the assigned browser profile; ingest one selected thread;
  queue only a human-approved reply; verify the native device receipt. A
  failed device receipt remains failed and must not be blindly retried.
- **Emergency pause:** enable it first and confirm all three outbound paths
  and workers are locked while refresh remains available. Deliberately resume
  messaging, then run separately approved sends only afterward.

No step in this document authorizes deployment, migration, credential changes,
provider reconnects, emails, messages, or social posts. Those require the
client/operator to act and approve them in the live environment.

## Baseline risk and safe integration order

The clean release branch is `072346e`. The primary checkout is dirty on
`codex/creator-onboarding-access`: it has broad staged/unstaged changes,
including migration-file deletions/replacements, provider worker changes,
new migration tooling, and untracked `.wingman/`, `.ontoly/`, and D1 trees.
It is not a safe merge source as-is.

Integrate in this order:

1. Preserve the primary checkout exactly as-is (snapshot/backup first); do not
   merge, rebase, cherry-pick, or clean it in place.
2. Review and land the clean release baseline `072346e` as the comparison
   point.
3. Integrate narrowly scoped feature branches one at a time, starting with
   the Phase 0 web/Reddit changes, then creator/access work, then storage or
   migration work. Resolve each branch against the release baseline and run
   the full verification suite after each integration.
4. Treat primary-branch migration deletions, D1 ledger changes, Worker config
   changes, and untracked tooling as separate reviewed units; never combine
   them with provider live proofs.
5. Only after code, migration, and deployment reviews pass should an operator
   perform client-authorized staging actions. No provider state is part of Git
   integration.
