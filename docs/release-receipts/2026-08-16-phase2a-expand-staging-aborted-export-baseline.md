# Phase 2A EXPAND continuation staging — aborted at export gate

- Release ID: `phase2a-expand-staging-20260816-cc43e22c`
- Timestamp: `2026-08-16T10:46:07Z`
- Result: **ABORTED — no remote mutation submitted**
- Environment: staging only
- Branch / HEAD: `audit/pre-cleanup-snapshot-2026-08-15` / `672b609855046ce49d55b743c5c73e2421051480`

## Repository and local gates

The working tree was clean at planning time. The following commits were present:

- `79f78e2` — separate service-auth compatibility boundary
- `f9a90df` — bounded D1 migration executor
- `46f6b6a` — strict Wrangler JSON parsing
- `6f2cfde` — raw-byte backup checksums
- `672b609` — structured post-mutation reconciliation

The bounded migration policy allows only `staging` and deliberately disables
production. Repository migration review confirmed that `0028` is already
applied and outside this release, `0029`–`0031` are the EXPAND range, and only
`0032_service_auth_compatibility.sql` changes
`identity_audit_service_scope`.

Passed local checks: `npm run lint`, `npm test`, `npm run build`,
`npm run verify:cloudflare`, the Cloudflare D1 migration test suite,
`npm run db:check`, `npm run db:isolation`, and `npm run index:library`.
The dedicated local 0031 migration test proved the legacy audit trigger is
unchanged through the EXPAND boundary.

## Fresh structured D1 pre-state

The repository-owned structured read client, using the Keychain-held D1
read-only token only in process memory, verified this target:

| Field | Value |
| --- | --- |
| Account | `3e7cfa6efb7a97825f1dc24515410c63` |
| D1 | `thot-os-staging` |
| UUID | `174532e8-5ada-4e30-abba-1276b3540b3f` |
| Canonical history | Exact contiguous `0001`–`0028` |
| Final migration | `0028_migration_ledger.sql` |
| 0029–0032 present | No |
| Creators / assets / messages | 3 / 403 / 328 |
| Legacy credentials / grants | 0 / 0 |
| Canonical service-auth objects | 0 |
| `PRAGMA quick_check` | `ok` |
| Foreign-key violations | 0 |

The full legacy `identity_audit_service_scope` definition was captured only in
the ephemeral private pre-state evidence. Its exact UTF-8 fingerprint was
`bb7f2736d1cf437c3585729739dca32b8bf4db30cf3dcef9ecdf09c28e3fa34a`
(545 bytes).

Ordered canonical migration history at the final structured read:

```text
0001_adelaide_library.sql
0002_library_classification_events.sql
0003_operations_foundation.sql
0004_reddit_scheduler.sql
0005_reddit_queue_controls.sql
0006_instagram_operations.sql
0007_vault_bridge.sql
0008_reddit_native_bridge.sql
0009_unified_messages.sql
0010_telegram_connector.sql
0011_instagram_completion.sql
0012_instagram_replies.sql
0013_instagram_reply_window.sql
0014_instagram_message_subscription.sql
0015_message_attachments.sql
0016_telegram_fansly_messages.sql
0017_reddit_community_events.sql
0018_creator_identity_profiles.sql
0019_actor_role_audit.sql
0020_actor_role_contract.sql
0021_creator_dropbox_source.sql
0022_asset_preview_queue.sql
0023_fansly_account_invariant.sql
0024_finance_foundation.sql
0025_reddit_composio_native_api.sql
0026_retire_reddit_browser_bridge.sql
0027_reddit_post_flairs.sql
0028_migration_ledger.sql
```

## Fresh bounded plan

The new plan was written to the private release-evidence path
`/private/tmp/thot-os-phase2a-expand-20260816.jsqV1l/bounded-plan.json` and
will be removed after this abort. It selected exactly:

| Migration | SHA-256 |
| --- | --- |
| `0029_service_principal_capabilities.sql` | `bc78ed7fe45da8f2f9365314c4f49c12ce94bc98242e75e6b1dc6ca68ea508e8` |
| `0030_canonical_control_plane.sql` | `5af26213782ae8b41d748f8cb8adbe0697cbd03f4256ef98fd810814bbd70fc8` |
| `0031_service_auth_activation_support.sql` | `b588a4db5dbe1276fde28165a569f29f938dabee6c1d386aaa19da0f6ff02948` |

- Plan SHA-256: `4da37da81bf23e0f11b43e916e70bb58b04c82296ad5bcbeee3d73492d69b792`
- Explicitly excluded: `0032_service_auth_compatibility.sql`
- `0028` replayed: **NO**

## Export-gate failure

`scripts/migration/export-target.mjs` performed a fresh read-only staging D1
export, but rejected it before emitting a backup receipt. Its Phase 1C.6
safety contract still declares `0027_reddit_post_flairs.sql` as the final
remote migration and `0028_migration_ledger.sql` as pending. The fresh,
canonical structured state is instead through `0028`, so the export validator
correctly failed closed with:

```text
Target D1 migration state does not exactly match the declared staging baseline.
```

The untrusted, unaccepted temporary export was 10,866,428 bytes with raw-byte
SHA-256 `ff7bc31b55f2397464d5e41066c05b1f5df720f658f8d6c90d11622d8f2b10d8`.
No export receipt was produced, so it was not eligible as migration backup
evidence and no apply command was invoked.

## Mutation, application, and isolation status

| Field | Actual value |
| --- | --- |
| Attempted | none |
| Locally confirmed | none |
| Remotely confirmed | none |
| Confirmed no change | none |
| Outcome unknown | none |
| Remote mutation state | `NONE` |
| Final canonical migration history | unchanged, exact `0001`–`0028` |
| 0032 applied | **NO** |
| Service-auth activation | **NO** |
| Secrets, credentials, principals, grants created | **NO** |
| Worker deployment or traffic change | **NO** |
| Application smoke test | not run; release stopped before migration |
| Activation plan | not run; EXPAND was not completed |
| Production touched | **NO** |

No rollback is required: no mutation reached Wrangler submission. The relevant
warning is the stale Phase 1C.6 export-baseline contract, not staging drift.

## Recommended next action

In a separate tooling-change review, update and test the read-only export
validator so its declared baseline accepts the already-canonical `0028` state.
Then begin a wholly fresh release with a new ID, plan, export, receipt, and
all gates rerun. Do not apply `0032` or activate service authentication as part
of that future EXPAND release.
