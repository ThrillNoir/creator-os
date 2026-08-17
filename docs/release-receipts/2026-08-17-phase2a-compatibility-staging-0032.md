# Phase 2A COMPATIBILITY — staging release receipt

- Release ID: `phase2a-compatibility-staging-20260817-09260c0b-2462-4753-b18f-934ffa6b8b02`
- Status: **COMPATIBILITY MIGRATION APPLIED — VERIFICATION INCOMPLETE**
- Branch / HEAD at plan and submission: `audit/pre-cleanup-snapshot-2026-08-15` / `06971e7e0c7eb12d785f0614fe68e12dd5f11d54`
- Target: THOT OS staging D1 `thot-os-staging` (`174532e8-5ada-4e30-abba-1276b3540b3f`) in account `3e7cfa6efb7a97825f1dc24515410c63`
- Production touched: **NO**. The bounded policy permits `staging` only; production remains unprovisioned and non-deployable.

## Scope and source review

The release was authorized to apply exactly `0032_service_auth_compatibility.sql` and no later migration. Fresh review confirmed that it only replaces `identity_audit_service_scope`: it preserves the scoped legacy `service_credentials` plus `service_creator_grants` predicate and adds a second, scoped canonical-principal predicate. It creates no table, principal, credential hash, capability grant, secret, Worker deployment, traffic change, or application data change. It neither removes legacy authentication nor grants global creator access.

The reviewed trigger representation is LF-normalized SQL, trimmed with one final newline, SHA-256 over UTF-8:

| State | Raw SHA-256 / bytes | Normalized SHA-256 / bytes |
| --- | --- | --- |
| Reviewed pre-0032 A | `bb7f2736d1cf437c3585729739dca32b8bf4db30cf3dcef9ecdf09c28e3fa34a` / 545 | `3eee5a9e0d858d6364c8101f8005441a49ce7fff95e61b5151f4ba61400eba07` / 546 |
| Reviewed post-0032 B | `36f16f7b1abd6aebb9d60f752c8ebb4e9d0274e56ee89054eba94e406024ac6d` / 1054 | `f196c7fb2a08e7a01462d9fee2c77804da4b804a27c558f0fa3806ca0a32a499` / 1055 |

## Local verification

- Passed: `npm run lint`; `npm test` (91 passing); `npm run build`; `npm run verify:cloudflare` (including 81 THOT OS Cloud tests); `npm run db:check`; `npm run db:isolation`; and `npm run index:library`.
- Fresh local replay from 0031 through 0032 produced reviewed trigger B exactly and passed `PRAGMA quick_check`.
- The local compatibility matrix passed: an active legacy credential/grant and an active canonical principal/credential/grant were accepted; wrong-creator, revoked credential, expired credential, and revoked-grant cases were denied for their applicable path. No local fixture was applied remotely.
- The Cloudflare build reported pre-existing missing local secret configuration by name only; no value was read, printed, changed, or persisted.

## Structured pre-state, plan, and export

- Structured D1 pre-state at `2026-08-17T03:04:43.620Z`: exactly 31 contiguous migrations ending `0031_service_auth_activation_support.sql`; 0032 absent.
- Pre-state data: creators 3, assets 403, messages 328; legacy credentials/grants 0; canonical principals, credential hashes, grants, audit events, activation runs/steps, and telemetry all 0.
- Pre-state integrity: `PRAGMA quick_check = ok`; foreign-key violations 0.
- Bounded plan selected exactly `0032_service_auth_compatibility.sql` (source SHA-256 `93ac4104a7acfb38e2ebba847fc296f5c170ec418b0e6e9b83e411361184161f`), with no excluded pending migrations. Plan SHA-256: `bb9e41ec212ecb4a9ac1c846b348c1e868de92d2f9358391217789dbb0ad3281`.
- Fresh approved-plan export at `2026-08-17T03:06:25.444Z`: raw-byte SQL SHA-256 `faf50891ccdcc91a025e0c4a02d991dc966b13541cd17ce3794360b871676d08`; parse snapshot SHA-256 `30f648fc98333305ba9db69b88764dbe302ace2c82fde11dc70f2fdfa6790146`; export receipt SHA-256 `a6efd84a35bce852b5af5104db9b7b8582d0e4b81ba678734f12f35b9237f876`.
- Three-way baseline agreement passed exactly: plan pre-state, fresh structured D1 state, and export receipt all contain ordered 0001–0031 history. Final pre-mutation checks reconfirmed clean Git, unchanged source/plan/export digests, trigger A, staging-only policy, and structured D1 authentication.

## Mutation accounting and canonical reconciliation

| Migration | Attempted | Locally confirmed | Remotely confirmed | Outcome |
| --- | --- | --- | --- | --- |
| `0032_service_auth_compatibility.sql` | yes | no | yes | `CONFIRMED` |

- The repository-owned bounded executor marked submission before invoking Wrangler. Its strict local JSON parser reported `LOCAL_RESULT_UNAVAILABLE`; no Wrangler output was used as database truth.
- Structured D1 immediately reconciled the exact next canonical history. Executor result: `APPLIED`; remote mutation: `CONFIRMED`; confirmed no-change: none; unknown outcome: none.
- Migration applied: **0032 only**. Migrations 0001–0032 are now contiguous and unique, ending `0032_service_auth_compatibility.sql`.

## Post-migration verification

- Structured post-state at `2026-08-17T03:15:27.404Z`: 32 canonical migrations, with exact reviewed trigger B. The normalized and raw fingerprints both match the reviewed result, and semantic SQL comparison passed.
- The 240 application schema objects match the reviewed post-export prediction exactly. Cloudflare D1 additionally exposes one provider-reserved `_cf_KV` storage table, which is not represented in the export parse snapshot; it is not an application object and is documented by Cloudflare as reserved.
- Data and dormant state are unchanged: creators 3, assets 403, messages 328; legacy credentials/grants 0; canonical principals, credential hashes, grants, audit events, activation runs/steps, and telemetry all 0.
- Integrity remains clean: `PRAGMA quick_check = ok`; foreign-key violations 0.
- Structural legacy compatibility: **PASS**. The legacy branch remains represented and local fixtures prove its accepted and denied cases.
- Canonical compatibility: **PASS (structural)**. The canonical branch is represented by the exact reviewed trigger, but no canonical principal is operationally active.
- Live legacy credential probe: **NOT PERFORMED** — staging has no legacy credential/grant and none was provisioned for this release.

## Protected probe, application evidence, and activation boundary

- Protected/no-op receiver probe: **UNAVAILABLE / DEFERRED**. The cutover runbook specifies this only after a separate activation, compatible receiver deployment, and traffic-routing sequence. No probe was invented and no operational credential was created.
- Read-only `npm run services:activate -- --environment staging --plan` passed: EXPAND ready **YES**; COMPATIBILITY ready **YES**; activation technically ready **YES**. It would create 4 principals, 4 secrets, 4 credential hashes, and 15 creator capability grants if separately approved. `--apply` was not invoked and plan mode created nothing.
- Read-only Cloudflare Worker identity: current script `thot-os-staging`, ID `e6520e8bf8324e50bd268181d453b816`. No Worker version/deployment action was run.
- Cloudflare observability after the migration recorded a completed 200 response and no 4xx/5xx responses in the post-migration observation window.
- **Authenticated route smoke is incomplete.** Fresh browser navigation was locally blocked by the browser client, and the shell has no authenticated Cloudflare Access session variable for the repository health checker. The unauthenticated health request correctly reached the Access boundary (HTTP 302), but this is not a substitute for authenticated health, library, messages, and operations checks.

## Explicit non-activation and recovery boundary

- Service-auth activation performed: **NO**.
- Secrets created: **NO**.
- Credentials installed: **NO**.
- Principals activated: **NO**.
- Capability grants activated: **NO**.
- Worker deployment: **NO**.
- Traffic cutover: **NO**.
- Legacy authentication removal: **NO**.
- Production touched: **NO**.

No automatic D1 rollback is appropriate: 0032 is canonically committed, exactly verified at the schema/data/integrity level, and remains the intended compatibility state. The protected temporary export/evidence directory containing raw staging data was moved recoverably to this Mac user's Trash after receipt capture; it is not committed.

## Required next action

Restore an authenticated, read-only staging Access smoke path and record successful health, library, messages, and operations checks against D1 at 0032. Until then, retain this status as **COMPATIBILITY MIGRATION APPLIED — VERIFICATION INCOMPLETE**. Do not execute ACTIVATE, create secrets, provision principals or grants, deploy Workers, change traffic, remove legacy authentication, or touch production.
