# Phase 2A EXPAND Staging Release — Aborted Before Mutation

## Release identity

| Field | Value |
| --- | --- |
| Release ID | `phase2a-expand-0031-20260816T050930Z-79f78e2` |
| Result | **ABORTED at Gate 7** |
| Environment | `staging` only |
| Branch / HEAD | `audit/pre-cleanup-snapshot-2026-08-15` / `79f78e236639a0a380f319626507e671a5fdfe4d` |
| Phase 2A architecture commit | `79f78e2` |
| Production touched | **NO** |
| Remote migration / mutation | **NO** |
| Compatibility migration applied | **NO** |
| Service-auth activation performed | **NO** |
| Secret / Worker deployment | **NO** |

## Gate evidence

### Gates 1–3 — local repository and verification

The worktree was clean; `79f78e2` is present. Migrations `0028`–`0032` are
contiguous. `0028`–`0031` contain no DDL for
`identity_audit_service_scope`; `0032_service_auth_compatibility.sql` is the
first migration that drops/recreates it. `npm run verify`, the clean migration
replay, service-auth gating tests, trigger fingerprint invariant tests, Worker
typechecks, and OpenNext/Cloudflare build passed.

The local EXPAND invariant proves the normalized trigger SQL and SHA-256
fingerprint are byte-identical from `0027` through `0031`; canonical
principals, credential hashes, and grants remain absent at that stop.

### Gates 4–5 — fresh read-only staging pre-state

| Field | Value |
| --- | --- |
| Account | `3e7cfa6efb7a97825f1dc24515410c63` |
| D1 | `thot-os-staging` / `174532e8-5ada-4e30-abba-1276b3540b3f` |
| Remote state | `0001`–`0027`; `0028`–`0032` pending |
| Creators / assets / messages | 3 / 403 / 328 |
| Legacy credentials / grants | 0 / 0 |
| Canonical principal, credential, grant, activation tables | Absent |
| Legacy audit trigger | Present |
| Canonical Web secrets | Absent; only legacy secret names were observed |

The 100% deployment versions were recorded read-only: web
`17e9658f-ff69-44e1-bb1f-1f2a78a34227`; Instagram
`98c89f76-6955-4aea-80dc-b2edeba77c2b`; Reddit
`c2b6e04c-60a0-4d28-824f-951d5489b74f`; Telegram
`6e5c1235-5150-447f-88a0-7ab6c78db1ee`; Vault
`e84c9da5-307c-449f-83e9-113582fa26de`.

Production isolation was checked read-only: only staging D1 exists and the
expected production Worker names returned not-found. No production target was
selected.

### Gate 7 — **FAIL CLOSED**

Wrangler `4.123.0` exposes `d1 migrations apply <database>` but no approved
`--through`/`--until` migration option. Every canonical Wrangler configuration
uses the full committed migrations directory, which contains pending `0028`
through `0032`. The normal apply command would therefore apply `0032`, crossing
the hard EXPAND stop boundary.

No existing repository release tool limits a remote apply to `0028`–`0031`.
A temporary filtered configuration could technically do so, but the release
brief expressly prohibits an improvised mechanism. The release stopped before
backup, migration application, or any other remote mutation.

## Post-state and rollback

- Pre-migration level: `0027`.
- Post-migration level: `0027`.
- Migrations applied: none.
- `0032_service_auth_compatibility.sql`: **NOT APPLIED**.
- Trigger pre/post identity comparison: not run remotely because no migration
  occurred; local invariant passed.
- Structural legacy-auth proof: pre-release local proof **PASS**; remote
  post-release proof not applicable.
- Live credential-authenticated probe: **NOT PERFORMED** (no existing legacy
  credential or grant).
- Activation plan after release: not run because staging did not reach EXPAND;
  no mutation occurred.

No rollback is required. Staging and production retain their pre-release
state.

## Recommendation

**NOT READY to run the Phase 2A EXPAND staging release.** First create and
review a dedicated, deterministic, repository-owned partial D1 migration
executor that validates the exact staging identity and applies only the declared
inclusive range `0028`–`0031`, rejects `0032`, records a fresh backup, and
produces a receipt. Then begin a new release from a fresh pre-state; do not
reuse this release ID.
