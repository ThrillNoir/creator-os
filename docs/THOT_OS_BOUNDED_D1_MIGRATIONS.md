# Bounded D1 migrations

`wrangler d1 migrations apply` always applies every pending migration in its
configured directory. It cannot safely perform the Phase 2A EXPAND release
because `0032_service_auth_compatibility.sql` is intentionally pending after
the safe EXPAND boundary.

The repository-owned executor applies a reviewed inclusive range while
preserving Cloudflare's canonical `d1_migrations` table. The database—not
Wrangler terminal output—is the source of truth for target identity, migration
history, and post-mutation reconciliation.

## Safety contract

- Only the registry allow-listed staging D1 can be addressed. Production is
  hard-disabled.
- Planning and reconciliation use the Cloudflare D1 REST API with the existing
  `CLOUDFLARE_API_TOKEN` environment contract. The client first verifies the
  account/database UUID and name, then issues a parameterized, single-statement
  read-only `SELECT` against `d1_migrations`. It rejects a response unless the
  API declares `changed_db: false`, `rows_written: 0`, and `changes: 0`.
- The token is required at runtime but is never written to a plan, receipt,
  log, diagnostic, or fixture. The required token scope is limited to the
  reviewed staging D1 read paths; mutation authority remains the separately
  reviewed Wrangler path.
- The repository-pinned Wrangler binary is used only for the selected mutation
  command. The account, database name, UUID, and canonical Web DB binding must
  agree before it can be reached. The reviewed local version is Wrangler
  `4.120.0`; release tooling must not substitute an unpinned `npx wrangler`.
- The migration directory must be contiguous, unique, and valid. A reviewed
  plan records selected SHA-256 digests, exact prior history, Git SHA/branch,
  and deliberately excluded pending files.
- Apply requires a clean tree at the reviewed Git identity, unchanged plan
  digest and explicit `bounded:<digest-prefix>` confirmation, matching current
  structured D1 history/source files, and a fresh checksum-validated read-only
  export receipt from `npm run migration:export-target`.
- Repository migration files are never moved, hidden, copied into the
  configured directory, or altered. The temporary mutation file is deleted
  after its command returns.

## Mutation accounting and recovery boundary

Before calling Wrangler for a selected migration, the mutation adapter marks
the submission point of no return. A local exit, parse, stdout/stderr, timeout,
or transport error after that marker is **not** proof that the database is
unchanged. The executor immediately re-reads canonical `d1_migrations` through
the structured client and never advances until it is reconciled.

The receipt's `remoteMutation` field is one of:

- `NONE`: no command reached the submission point.
- `POSSIBLE`: a command was submitted but canonical history or a reviewed
  no-effects proof was unavailable or divergent. The run hard-stops; it must
  not retry the migration.
- `CONFIRMED`: canonical history contains the exact next migration name.
- `CONFIRMED_NO_CHANGE`: canonical history stayed at the pre-state and an
  explicit, reviewed migration-specific schema verifier independently proved
  that no effects occurred. The run still stops for human recovery.

Receipts separate `attempted`, `locallyConfirmed`, `remotelyConfirmed`,
`confirmedNoChange`, and `outcomeUnknown`. They also preserve a categorical
local diagnostic without raw command output. A command that returned locally
but did not mark submission is treated as an adapter fault, never as a success.

There is intentionally no generic schema inference or automatic retry. A
future reviewed no-effects verifier may inspect only explicitly named schema
objects through parameterized structured D1 reads and invoke the allow-listed
read-only `PRAGMA quick_check` and `PRAGMA foreign_key_check` helper. An absent
migration record or a clean integrity result alone is insufficient to claim
rollback or no change.

## Local file and Wrangler boundaries

Plans, approved plans, policy files, and export receipts are trusted local
evidence inputs. Each must be exactly one JSON document; malformed,
concatenated, or trailing-text files are rejected. The executor writes a real
final newline, never a literal `\\n` trailer.

Wrangler output is not used for target identity or migration-history reads.
For the mutation command only, its stdout/stderr boundary remains deliberately
strict: separate capture, zero exit, empty stderr, one JSON document on stdout,
and one successful D1 result envelope. This is local confirmation only; a
subsequent structured D1 reconciliation determines the remote outcome.

Backup integrity uses distinct digests for distinct evidence: deterministic
canonical JSON for plans/structured receipts, UTF-8 text for migration SQL,
and raw bytes for exports and file artefacts. Backup validation requires a
nonempty export, matching raw-byte checksum, current timestamp, staging target
identity, and exact pre-migration history.

## Current Phase 2A baseline and next reviewed range

The historical 2026-08-16 release submitted `0028_migration_ledger.sql` and
Wrangler reported a local failure, but the canonical post-stop D1 history
contains `0028`. That migration is applied and must **never** be replayed or
manually edited in `d1_migrations`.

For a separately authorized release, only after a fresh matching backup and
review, the next plan begins at `0029_service_principal_capabilities.sql` and
ends at `0031_service_auth_activation_support.sql`:

```sh
npm run d1:migrations:plan -- \
  --environment staging \
  --release-id phase2a-expand-resume-<approved-id> \
  --from 0029 \
  --through 0031 \
  --output /absolute/safe-location/phase2a-expand-resume.plan.json
```

The plan must show `0029`–`0031` selected, `0028` in its exact pre-state, and
`0032_service_auth_compatibility.sql` in `excludedPending`. It is intentionally
not executed by local development or this implementation task.

`0032` remains a separately reviewed compatibility release. The staging-gateway
drift is recorded as deferred work: it is not changed or deployed by this
bounded D1 tooling.
