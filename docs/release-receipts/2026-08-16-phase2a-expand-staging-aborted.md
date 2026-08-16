# Phase 2A Expand-Migration Staging Release — Aborted Before Mutation

## Release identity

| Field | Value |
| --- | --- |
| Release ID | `phase2a-expand-staging-20260816T043922Z-fa6fbe7` |
| Result | **ABORTED at Gate 3** |
| Environment | `staging` only |
| Branch | `audit/pre-cleanup-snapshot-2026-08-15` |
| HEAD | `fa6fbe7c09fe0df5e658422c2073a1a9ec95bd95` |
| Production touched | **NO** |
| Remote mutation | **NO** |
| Service-auth activation performed | **NO** |
| Worker deployment / secret change | **NO** |

## Gate evidence

### Gate 1 — repository

The worktree was clean. Both reviewed Phase 2A.2 commits (`5b315bc` and
`fa6fbe7`) are ancestors of `HEAD`. The migration sequence is contiguous:
`0027_reddit_post_flairs.sql`, then only `0028`–`0031`.

| Migration | SHA-256 | Classification |
| --- | --- | --- |
| `0028_migration_ledger.sql` | `efdc454682d7afac6e78b0e9dc75cb057aab7c4295a515b71211366d9e655fe9` | Additive reconciliation ledger |
| `0029_service_principal_capabilities.sql` | `bc78ed7fe45da8f2f9365314c4f49c12ce94bc98242e75e6b1dc6ca68ea508e8` | Additive canonical service-principal foundation |
| `0030_canonical_control_plane.sql` | `5af26213782ae8b41d748f8cb8adbe0697cbd03f4256ef98fd810814bbd70fc8` | Additive control-plane metadata / idempotent exception seed |
| `0031_service_auth_activation_support.sql` | `33a5f47e7629c3d42b7dd50febf3d97a27e03266908d64baf75285d42395cbe5` | **Compatibility-trigger replacement; not strictly additive** |

### Gate 2 — local verification

`npm run verify` was re-run. Root lint completed with two pre-existing-style
unused-destructuring warnings in the activation digest helper but no lint
errors. Root tests (63), local integrity/isolation checks, root build, Worker
typechecks, Telegram tests, Cloud Next tests, and local D1 replay through
`0031` completed successfully. The OpenNext local build warning about absent
canonical internal-token secrets is expected: this release must not provision
them.

### Gate 3 — migration safety: **FAIL**

The release instruction requires that `0028`–`0031` do **not** replace the
currently required legacy audit path. `0031` lines 58–84 executes:

```sql
DROP TRIGGER IF EXISTS identity_audit_service_scope;
CREATE TRIGGER identity_audit_service_scope ...
```

The new predicate preserves the legacy credential/grant branch and adds a
canonical branch. It is designed as behaviourally compatible, but it still
replaces the live trigger. Applying it would violate the literal hard gate for
this release. The release was therefore stopped before Gate 4 backup work or
any mutation.

## Read-only staging pre-state

| Field | Observed value |
| --- | --- |
| Cloudflare account | `3e7cfa6efb7a97825f1dc24515410c63` |
| D1 | `thot-os-staging` / `174532e8-5ada-4e30-abba-1276b3540b3f` |
| Region / size | OC/MEL / 8.52 MB |
| Migration state | Exactly `0001`–`0027`; `0028`–`0031` pending |
| Creators / assets / messages | 3 / 403 / 328 |
| Canonical service tables | Absent |
| Canonical principals / credentials / grants / activations | 0 / 0 / 0 / 0 |
| Legacy `service_credentials` / grants | 0 / 0 |
| Legacy audit trigger | Present; legacy credentials and creator grants only |

Observed active Worker versions were preserved: web `17e9658f-ff69-44e1-bb1f-1f2a78a34227`, Instagram `98c89f76-6955-4aea-80dc-b2edeba77c2b`, Reddit `c2b6e04c-60a0-4d28-824f-951d5489b74f`, Telegram `6e5c1235-5150-447f-88a0-7ab6c78db1ee`, and Vault `e84c9da5-307c-449f-83e9-113582fa26de`.

## Why Gate 7 cannot be proven safely

The relevant staging legacy service-credential and grant tables contain zero
rows. No known credentialed legacy service probe exists, so the requested
claim that existing legacy service authentication still works cannot be made
without provisioning or manufacturing a credential, both outside this
release's scope.

## Migrations applied / activation plan

- Migrations applied: **none**.
- Pre-migration level: `0027`.
- Post-migration level: `0027`.
- Backup: not taken; Gate 3 required abort before the mutation sequence.
- `services:activate --apply`: **not run**.
- Secrets generated or installed: **NO**.
- Canonical principals, credential hashes, or grants activated: **NO**.
- Service traffic switched: **NO**.

## Rollback and recommendation

No rollback is required because staging and production were not mutated.

**Recommendation: NOT READY.** Obtain a revised explicit release decision for
the existing reviewed `0031` compatibility-trigger replacement, or split that
trigger change into a separately approved compatibility release. Also define a
safe, non-provisioning proof of live legacy service authentication before
claiming Gate 7. After those two issues are resolved, begin a new release from
a fresh pre-state and backup; do not reuse this release ID.
