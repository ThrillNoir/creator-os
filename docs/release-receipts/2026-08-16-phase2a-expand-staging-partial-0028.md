# Phase 2A EXPAND staging release — stopped after partial `0028` application

- Release ID: `phase2a-expand-staging-20260816t062526z`
- Started: `2026-08-16T06:26:52.654Z`
- Stopped: `2026-08-16T06:26:57.005Z`
- Branch / HEAD at release start: `audit/pre-cleanup-snapshot-2026-08-15` / `6f2cfde2e7f25ff60524e1d5b0cbdc8a759199fe`
- Environment: staging only
- D1: `thot-os-staging` (`174532e8-5ada-4e30-abba-1276b3540b3f`)
- External evidence directory: `/Users/thotos/THOT-OS-PHASE2A-RELEASES/2026-08-16T062526Z`

## Release intent and pre-state

The approved bounded plan selected only `0028_migration_ledger.sql` through
`0031_service_auth_activation_support.sql`; it explicitly excluded
`0032_service_auth_compatibility.sql`. The plan SHA-256 was
`3e4085a77d55f556587062e2c30842667d1915c198ccb26d642b0f621089a8b4`.

Immediately before apply, staging had the exact ordered migration history
`0001` through `0027`, 3 creators, 403 assets, and 328 messages. The legacy
`identity_audit_service_scope` trigger fingerprint was
`bb7f2736d1cf437c3585729739dca32b8bf4db30cf3dcef9ecdf09c28e3fa34a`.
The fresh, read-only pre-release SQL export SHA-256 was
`49ebe4160cfa0d6db744c74d71c608f41d1f4bc0c1dc40d37f6a3ac8b372e3de`.

## Stop condition

The bounded executor reported failure while processing `0028` and stopped
before attempting any later selected migration:

```text
Selected migration command failed; no later migration was attempted.
```

Its generated apply receipt reports `applied: []` and `result: FAILED`, but
its independently re-read `postMigrationState` includes
`0028_migration_ledger.sql`. The receipt's `remoteMutation: false` therefore
does not describe the authoritative remote state and must not be used as a
recovery decision source.

## Authoritative post-stop state

Read-only D1 verification after the executor stopped found:

- `d1_migrations` has `0028_migration_ledger.sql` recorded as migration 28.
- `0029`, `0030`, `0031`, and `0032` have no migration records and were not
  attempted by this release after the reported failure.
- The three `migration_ledger_*` tables, their expected indexes, and
  append-only / creator-scope triggers exist. All three ledger tables contain
  zero rows.
- `service_principals`, `creator_exceptions`, and
  `service_auth_activation_runs` do not exist, confirming `0029`–`0031` were
  not applied.
- `PRAGMA quick_check` returned `ok`.
- Core counts remain creators `3`, assets `403`, and messages `328`.
- The legacy `identity_audit_service_scope` trigger remains byte-identical to
  the pre-release fingerprint above.

## Release result

- Actual remote migration state: partial — `0028` only
- `0032` compatibility migration: not applied
- Service-principal activation, secrets, grants, credentials: not performed
- Worker deployment or traffic change: none
- Production touched: no
- Retry, resume, rollback, or tool modification in this release: none
- Push: no

## Required follow-up

Do not delete the newly added ledger schema or manually alter
`d1_migrations`. Treat this as a separate recovery/replanning task. It must
first investigate why the bounded executor classified an acknowledged remote
`0028` application as a command failure and emitted an inconsistent receipt.
Only after a fresh staging backup, a reviewed recovery plan starting from the
actual `0028` state, and separate approval may a later release consider the
remaining EXPAND migrations. `0032` remains outside that future range unless
separately approved.
