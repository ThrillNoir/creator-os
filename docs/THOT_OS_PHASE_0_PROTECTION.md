# THOT OS — Phase 0 Protection Record

**Completed:** 2026-08-15 (Australia/Perth)
**Scope:** snapshot → backup → verify → document only. No source cleanup, deployment, migration, database reconciliation, credential change, infrastructure mutation, or Git push was performed.

This record protects the pre-cleanup state identified in [the audit](./THOT_OS_AUDIT.md). It is intentionally a recovery record, not a decision to adopt any of the current architectures.

## Completion gate

| Gate | Result | Evidence |
|---|---|---|
| Source protected | **YES** | Local WIP is committed on a dedicated audit branch; no push was made. |
| Local SQLite protected | **YES** | Raw operational-state copy and a verified, consistent SQLite backup exist outside the repository. |
| Staging D1 protected | **YES** | A fresh export, local parse database, checksums, migration state, and row-count record exist outside the repository. |
| Cloudflare baseline captured | **YES** | Read-only Worker, D1, R2, queue, config, deployment, binding, and trigger evidence was saved outside the repository. |
| Unreachable Git work inspected | **YES** | No unreachable commits existed; 68 source/infrastructure trees were conservatively preserved with local Git refs. |
| Recovery instructions written | **YES** | See [Recovery instructions](#recovery-instructions). |
| Safe to proceed to architecture decisions | **YES** | The current state is recoverable. This does **not** authorize Phase 1 changes. |

## 1. Git snapshot

| Item | Record |
|---|---|
| Branch | `audit/pre-cleanup-snapshot-2026-08-15` |
| Base commit before the snapshot | `d2043994c5e8f904f12403a676d6574199d07fc9` |
| WIP snapshot commit | `2a0677cec4bb707fc4cf063d4a6648508ee1a53c` |
| Commit message | `chore: preserve pre-cleanup WIP snapshot` |
| Snapshot content | 54 changed paths, 3,252 insertions, 305 deletions; includes the current Cloudflare, finance, Reddit, preview, Vault Bridge, extension, migration `0021`–`0027`, test, and documentation work. |
| Remote action | **No push.** The configured remote was not treated as verified private for this purpose. |

### Worktree before snapshot

- 30 modified tracked files and 22 untracked files were present when Phase 0 began.
- The tracked WIP diff was approximately 1,349 additions and 305 deletions before audit documentation was included in the snapshot.
- `.creator-os/` was ignored and was not staged. No ignored database, backup, or operational-state file was put in Git.
- `git diff --check` passed after correcting two Markdown trailing spaces in the audit report.
- A staged secret-pattern check found no private-key, common API-key, or Cloudflare-token literal match. This is a guard against obvious accidental inclusion, not proof that all history is secret-free.

### Verification before snapshot

`npm run verify` completed with exit status `0` after the snapshot was created and before this manifest was written. It passed:

- root linting;
- 32 root tests;
- local SQLite integrity and creator-isolation checks;
- root production build;
- type checks for Vault Bridge, Instagram, Reddit, and Telegram Workers;
- 4 Telegram tests;
- 67 Cloud/Next tests, Cloud Next build, and OpenNext bundle build.

The Cloud Next build emitted a non-failing local warning that `CATALOGUE_SYNC_TOKEN` is absent. Its value was neither read into this document nor changed.

### Worktree after snapshot

Immediately after commit `2a0677c`, `git status --short --branch` showed only the audit branch header: the worktree was clean. The only subsequent repository change is this Phase 0 record, which is committed separately after its review.

## 2. Local operational-state backup

### Backup location and protection

- Source (unchanged): `/Users/thotos/thotos/creatoros/.creator-os/`
- External backup root: `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/`
- Raw operational-state copy: `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/local-operational-state/.creator-os/`
- Consistent online SQLite backup: `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/local-operational-state/sqlite-consistent-backup.sqlite`
- File/directory permissions on the backup root are restricted to the local account (`700` directories, `600` files).

The backup includes the ignored SQLite database and its journal files, the two existing local SQLite backups, Cloudflare/staging SQL and identifier backups, library catalogue, deployment receipts, and other non-generated operational files. It deliberately excludes application build output.

### SQLite manifest

| Item | Source record | Protected copy / verification |
|---|---|---|
| Primary SQLite database | `.creator-os/creator-os.sqlite`, 1,867,776 bytes, modified `2026-08-10T13:10:38Z` | Raw copy retained; a separate consistent online backup was created. |
| SQLite WAL | `.creator-os/creator-os.sqlite-wal`, 1,495,592 bytes, modified `2026-08-10T13:44:41Z` | Retained with the raw operational-state copy. |
| SQLite SHM | `.creator-os/creator-os.sqlite-shm`, 32,768 bytes, modified `2026-08-10T13:43:09Z` | Retained with the raw operational-state copy. |
| Operational state | 39 files under `.creator-os/`, 49,426,266 bytes | Retained as a raw copy; detailed file inventory: `local-operational-state-inventory.txt`. |
| Consistent backup | N/A — created from the live database without modifying it | 1,875,968-byte SQLite file; SHA-256 `2f4049754867ae6b9f3f24c67282bd16097bcd5da7e349298a4921dfb2f17c4c`; `quick_check=ok`, `integrity_check=ok`, 55 tables. |

The primary source database was open by an existing local Next process. It was not stopped or modified. The separate consistent SQLite backup is the preferred restoration source; the raw copy, including WAL/SHM, is retained as forensic and operational evidence.

### Checksums

- Sealed checksum manifest: `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/SHA256SUMS-SEALED`
- Manifest SHA-256: `490f96d019dc56e51eb5534b5cc1eb9eedeb216e269e8dfe015dc0b9407739fa`
- Entries: 120 external-backup artifacts.
- Verification of every sealed entry and of the sealed manifest passed.

## 3. Staging D1 protection

| Item | Record |
|---|---|
| Database | `thot-os-staging` |
| D1 database ID | `174532e8-5ada-4e30-abba-1276b3540b3f` |
| Remote database size at capture | 7,843,840 bytes |
| Export path | `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/d1/thot-os-staging-2026-08-15T160500Z.sql` |
| Export timestamp | `2026-08-15T16:16:57Z` |
| Export size | 9,545,857 bytes |
| Export SHA-256 | `f5224849d51a06cafa4af3c31a76434a70cc6f9de07ba38d38bc405cfdf0e4f4` |
| Local parse database | `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/d1/verification/thot-os-staging-parse.sqlite` |
| Parse verification | `quick_check=ok`; 51 user tables; 27 `d1_migrations` rows. |
| Migration state | Remote migration check reported no migrations to apply: `0001` through `0027` are applied. |

The export operation was read-only with respect to schema and data: no migration or SQL mutation was run against staging. The export was parsed into a local-only SQLite file to confirm it is readable, without touching the remote database.

### Relevant staging counts at capture

| Table/domain | Count |
|---|---:|
| `creators` | 3 |
| `assets` | 403 |
| `operational_accounts` | 6 |
| `social_posts` | 22 |
| `messages` | 328 |
| `message_threads` | 46 |
| `users` | 4 |
| `creator_memberships` | 6 |
| `asset_preview_jobs` | 358 |
| `vault_upload_jobs` | 13 |
| `d1_migrations` | 27 |

These counts are a capture-time baseline, not a source-of-truth decision. Staging D1 remained active during the audit; do not infer that the local SQLite and D1 datasets are replicas.

## 4. Cloudflare baseline

Read-only baseline evidence is stored at `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/cloudflare-baseline/`, including copied Wrangler configurations, deployment lists, current-version binding metadata, D1/R2/queue command output, and non-sensitive capture summaries. No secret value is recorded in this document.

### Workers and current deployed versions

| Worker | Active version ID | Last deployment (UTC) | Reachability / target |
|---|---|---|---|
| `thot-os-staging` | `17e9658f-ff69-44e1-bb1f-1f2a78a34227` | `2026-08-15T07:16:03Z` | `https://thot-os-staging.thot-os.workers.dev` (Cloudflare Access-protected) |
| `thot-os-vault-bridge-staging` | `e84c9da5-307c-449f-83e9-113582fa26de` | `2026-08-15T06:45:56Z` | `https://thot-os-vault-bridge-staging.thot-os.workers.dev` |
| `thot-os-reddit-scheduler-staging` | `c2b6e04c-60a0-4d28-824f-951d5489b74f` | `2026-08-15T07:15:23Z` | Internal service / scheduled Worker; no public `workers.dev` target configured |
| `thot-os-instagram-scheduler-staging` | `98c89f76-6955-4aea-80dc-b2edeba77c2b` | `2026-08-10T23:33:32Z` | Internal service / scheduled Worker; no public `workers.dev` target configured |
| `thot-os-telegram-bridge-staging` | `6e5c1235-5150-447f-88a0-7ab6c78db1ee` | `2026-08-10T23:29:45Z` | Internal service / scheduled Worker; no public `workers.dev` target configured |
| `creator-os-staging-gateway` | `7b804757-c7be-4ff2-b3cb-f1030afbfe5c` | `2026-08-07T00:08:32Z` | `https://creator-os-staging-gateway.thot-os.workers.dev` |

Current-version metadata was captured for every Worker. It records binding *types* without disclosing secret values:

| Worker | Binding types seen in current version |
|---|---|
| `thot-os-staging` | 6 plain-text variables, assets, 2 secret-text bindings, D1, 5 service bindings, 2 R2 bindings |
| Vault Bridge | 3 secret-text bindings, D1, queue, R2 |
| Reddit scheduler | 3 secret-text bindings, D1 |
| Instagram scheduler | 3 secret-text bindings, D1, R2 |
| Telegram bridge | 3 secret-text bindings, D1 |
| Staging gateway | 2 queues, 2 R2 buckets, 1 secret-text binding |

The copied staging app configuration declares five service bindings: self-reference plus the Reddit, Instagram, Telegram, and Vault Bridge Workers. The copied scheduler configurations each declare a `* * * * *` cron trigger. The Phase 0 capture verifies the deployed Worker versions and static trigger configuration; it does not claim to have observed a cron invocation.

### D1 and R2

- D1: the `thot-os-staging` database listed above.
- R2 buckets present and captured: `thot-os-media-staging`, `thot-os-previews-staging`, `thot-os-creator-intake-staging`, and `thot-os-creator-packages-staging`.

### Queue baseline

| Queue | Producer attachment | Consumer attachment | Baseline conclusion |
|---|---|---|---|
| `thot-os-intake-staging` | `creator-os-staging-gateway` | 0 | Broken: configured intake consumer is not attached. |
| `thot-os-ai-jobs-staging` | `creator-os-staging-gateway` | 0 | Broken: configured AI consumer is not attached. |
| `thot-os-preview-staging` | Vault Bridge | Vault Bridge (1) | Attachment exists. |
| `thot-os-preview-dlq-staging` | 0 | Vault Bridge (1) | Attachment exists. |
| `thot-os-failures-staging` | N/A | N/A | Absent remotely although referenced as the gateway failure DLQ. |

### Deployment collision (preserved, not changed)

Both [`cloudflare/thot-os-app/wrangler.jsonc`](../cloudflare/thot-os-app/wrang.jsonc) and [`cloudflare/thot-os-next/wrangler.jsonc`](../cloudflare/thot-os-next/wrangler.jsonc) declare the same Worker name:

```text
thot-os-staging
```

Their deployment history is therefore the same remote Worker history. The current version has the OpenNext assets/service-binding shape, but deploying the legacy directory would still target and overwrite that same Worker. No rename, deploy, or configuration modification was made in Phase 0.

## 5. Git recovery information

`git fsck --no-reflogs --unreachable --full` was run read-only before any Git cleanup.

| Result | Record |
|---|---|
| Unreachable commits | 0 |
| Unreachable trees | 211 |
| Unreachable blobs | 118 |
| Candidate source/infrastructure trees | 68 (59 package/project roots and 9 Worker/source candidates) |
| Preservation action | Added 68 local refs under `refs/audit/recovery/phase0-20260815-tree-<short-id>`. |
| Post-preservation verification | A second `git fsck --no-reflogs --unreachable --full` returned no unreachable object or error. |

The candidate trees were inspected by object type and top-level structure only; no content was merged, deleted, or assumed obsolete. They are conservatively retained because no unreachable commit gives their work a trustworthy history. Evidence and the exact ref mapping are in `/Users/thotos/THOT-OS-PHASE0-BACKUPS/2026-08-15T160500Z/git-recovery/`.

Do not delete the `refs/audit/recovery/` refs, run `git gc`, prune, or force-rewrite history until a later recovery review explicitly classifies these objects.

## Recovery instructions

Do **not** run these restoration operations as a routine way to continue development. First preserve any newer work and obtain explicit approval for the target and desired point in time.

### 1. Restore source work

1. Confirm the current branch and worktree have been separately backed up.
2. Switch to `audit/pre-cleanup-snapshot-2026-08-15`.
3. Inspect commit `2a0677cec4bb707fc4cf063d4a6648508ee1a53c`; restore or branch from it only after deciding how it relates to subsequent work.
4. If a missing historical tree is needed, inspect the corresponding local `refs/audit/recovery/phase0-20260815-tree-*` ref and create a normal review branch from an intentional reconstruction. Never run Git garbage collection first.

### 2. Restore local SQLite and operational state

1. Stop the local THOT OS process so it cannot write while files are being restored.
2. Make a new dated copy of the current `.creator-os/` directory before replacing anything.
3. Restore the full raw operational-state directory from `local-operational-state/.creator-os/` when the complete historical state (including receipts, catalogue, existing backups, WAL, and SHM) is required.
4. Prefer `sqlite-consistent-backup.sqlite` when the database alone is required. Restore it as `.creator-os/creator-os.sqlite` only after moving the current database aside; use its companion journal files from the same backup point if applicable.
5. Validate the restored database with `npm run db:check` and `npm run db:isolation` before starting the application.

### 3. Restore staging D1

1. Treat a D1 import as destructive. Do **not** overwrite the active `thot-os-staging` database from this export.
2. First take a new current D1 export/snapshot and obtain approval for an explicit restore plan.
3. Prefer importing the Phase 0 SQL export into a newly created, isolated D1 database for inspection/recovery validation.
4. Only after reconciliation and approval should an operator consider a controlled replacement or migration of an active environment. Confirm the `d1_migrations` history and relevant counts against this record before any cutover.

## Explicitly deferred

Phase 0 did **not** refactor code, remove legacy directories, rename Workers, deploy, migrate D1, reconcile local SQLite with D1, attach queue consumers, fix authentication, rotate credentials, upgrade dependencies, change Cloudflare resources, delete branches, push commits, or run Git garbage collection.

The next step is a decision review using this protection record and the audit findings. Phase 1 must not begin without explicit approval.
