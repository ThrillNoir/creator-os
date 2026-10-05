# Release decision packet — 2026-10-04

Scope: local third readiness pass following [the accepted journey milestone](2026-10-04-local-journey-and-commission.md). This packet grants no release authority. No remote deployment, migration, backup export, provisioning, account operation or private-media upload was performed.

## Decision needed before a production plan exists

The full THOT OS product is not currently ready for a production release approval. `config/deployments.json` registers only a narrow production `publicLinks` foundation. Its passing static preflight does not prove remote existence or validate the private app. The production component has no private web Worker/dashboard hostname/Access policy, native private-library R2 binding, preview queue, operational service Workers/bindings or creator-profile projection contract. Locally named D1/R2/KV/Analytics resources are intentions, not observations. The public `thathuboverthere.com` domain is reserved for creator surfaces; it must not become the private dashboard.

Ben must choose the first production scope and private dashboard hostname/Access policy, approve isolated resource provisioning, and then review a concrete artifact/target/migration plan. The current deploy and bounded migration tools deliberately reject production. A separately reviewed guarded production path is required; changing `staging` to `production` in commands or removing guards is not a release procedure.

The source checkout contains pre-existing dirty booking/deployment work plus the accepted readiness changes. A clean reviewed commit and matching immutable artifact must be established before release. None was committed or pushed by this task.

## Schema ordering and recovery contract

`scripts/build-d1-production-baseline.mjs` freezes the schema-only baseline at `0056_creator_invitations.sql`: 58 reviewed source entries with checksum verification. This artifact is only for an explicitly approved new database, never an existing one. Later migrations `0057` through `0062` are outside that frozen baseline and need an explicit reviewed plan for the selected launch scope. Do not extend the baseline blindly.

`config/staging-d1-migration-ledger.json` records 64 entries through `0062_booking_delivery_evidence.sql`, observed 2026-09-29. That dated file does not prove current live history. `config/bounded-d1-migrations.json` and the planner/apply code remain staging-only. Old examples using `0029`–`0031` in the migration runbook or command help are examples, not today's approved range. Obtain fresh target/history evidence under explicit authorization before selecting any range.

A migration backup must match the exact approved target, plan digest and pre-migration ledger, preserve its private SQL/checksum/receipt, and remain within the tooling freshness window. Local SQL replay checks migration history, SQLite integrity and foreign keys before accepting backup evidence. Synthetic replay proves the validation mechanism; it does not prove today's remote backup is recoverable. A real approved backup still needs an isolated restore rehearsal plus application-level checks. D1 SQL alone does not preserve R2 originals, Worker artifacts, KV, queue state or service/Access configuration; each requires a recovery plan. No production restore command or rehearsal is established.

Rollback means reconciling the actual remote version/traffic and selecting the reviewed prior artifact through the guarded process. Code rollback does not reverse D1 schema/data. Preserve source media, avoid destructive schema rollback, and plan forward repair or an explicitly approved isolated restore. Never retry an uncertain apply/deploy until observed state is reconciled.

## Local commands and approval boundary

Run from the repository root:

```sh
npm run lint
npm test
npm run build
npm run verify:cloudflare
npm run deployment:preflight -- --environment staging --all
npm run deployment:preflight -- --environment production --all --json
npm run d1:production-baseline:check
node --test tests/bounded-d1-backup-rehearsal.test.mjs
git diff --check
```

These validate local code/config only. `artifact:staging` builds an immutable local staging artifact for a reviewed component; dirty-identity guards remain intact.

The following are existing guarded **remote** entry points, listed for a future approved operator; they were not executed. Replace placeholders only from fresh, reviewed evidence, never from old receipts:

```sh
npm run d1:migrations:plan -- --environment staging --release-id <reviewed-id> --from <approved-first> --through <approved-last> --output <absolute-plan.json>
npm run d1:migrations:backup -- --approved-plan <absolute-plan.json> --output-dir <absolute-owner-only-directory>
npm run d1:migrations:apply -- --approved-plan <absolute-plan.json> --backup-receipt <absolute-export.receipt.json> --confirmation <plan-generated-confirmation> --receipt <absolute-receipt.json>
npm run deploy -- --plan --environment staging --component <reviewed-component> --artifact-manifest <manifest> --output <owner-only-plan.json>
```

Apply deployment only using the tool-generated approved plan/confirmation and matching artifact. On an uncertain response use the existing `--reconcile` mode with that evidence before considering retry. Obtain fresh Worker version/traffic, D1 ledger/integrity and authenticated smoke results; validate the final receipt through `deployment:receipt`. This list is not a production command sequence.

## Provider and access decisions still pending

- Actual external email OTP/Access policy and invitation delivery, with the existing manual outer allowlist retained until an explicit policy decision.
- Live private image/video ingestion and signed playback behavior, service grants, resource identities and authenticated creator-isolation smoke checks. Actual synthetic download/token handlers now prove creator-bound view authorization, no-store and denial before R2/Stream access. The generated Stream binding exposes `generateToken()` with no expiration argument; token lifetime and previously issued token behavior after membership revocation remain unverified. Do not claim immediate revocation of an already-issued provider token.
- Commission eligible-sale evidence, gross/net treatment after provider deductions/refunds and cadence. Imported income still cannot automatically become THOT-generated income. Existing percentage overrides remain untouched; 50% is a configurable proposed default and software fees are currently zero, future undecided.
- Fansly uncertain transfers remain held; a late receipt may reconcile them. Legacy failed jobs with uncertainty evidence must also remain locked: a failed label alone cannot authorize a duplicate transfer. A no-receipt manual resolution workflow would require a separately reviewed authority/evidence contract before enabling retry. The current pass improves the warning and denies retry of uncertain or uninterpretable failure evidence; it adds no manual resolution transition.

## Safe OnlyFans integration boundary

The separate `creatoros-onlyfans-batch-vault-delivery` source artifact is private-message delivery to a configured recipient. Canonical THOT OS is currently a Fansly vault workflow. These are distinct destinations and receipt contracts. Decide whether the product needs OnlyFans vault intake or supervised message delivery before implementation; the older artifact's presence does not prove an installed extension or current deployed Worker.

Reuse reviewed browser interaction patterns only after establishing per-platform/account pairing, verified external account identity, explicit destination/recipient, protocol/version negotiation, creator-scoped canonical R2 source access, paid-ready classification/consent and human approval. Keep a durable exact-attempt receipt with observed external media/message ID and narrowly scoped browser permissions. Do not restore legacy session interception, capture authentication secrets, bypass platform controls or automatically repeat uncertain sends.

Required synthetic contract tests before integration: mismatched creator/account/platform/target rejection, approval/consent denial, lost and late receipts, duplicate external IDs, ambiguous DOM observation, replay lock, revoked pairing, signed-source expiry, and explicit human reconciliation before any repeat. Live provider acceptance remains separate evidence requiring authorization.

## Third-pass local acceptance and evidence

The synthetic browser reproduced the old empty-selection error boundary. The fix reports inline validation while retaining the unsaved note, then filter Reset restores the synthetic photo, selection count updates and a valid one-asset batch saves successfully. Server-side 50-item and creator/role validation remain authoritative. Private image preview responses now require reauthorization rather than 24-hour browser reuse. Finance CSV currency is explicit and row errors preserve the selected file. Global recovery no longer promises an unchanged result and returns to the affected section; analytics-only refresh no longer claims messages refreshed. Uncertain Fansly claims and legacy failed/uncertain receipts display reconciliation wording without unlocking a retry. The creator-scoped retry action also compares the exact receipt read before changing state, preserving a late uncertainty receipt. Creator/viewer workspaces expose no vault approval or retry controls.

Final combined verification passed **500 tests**: 114 root, 327 canonical app and 59 Worker tests. `npm run lint`, `npm run build`, `npm run verify:cloudflare` (including OpenNext), all ten staging static preflights, the frozen production baseline and diff checks passed. Production static preflight passed only for its single registered public-links foundation. Initial stale cache/copy expectations and synthetic video fixture failures were corrected before the final full rerun; the authorized loopback run also resolves earlier sandbox-only Miniflare restrictions.

Task evidence lives at `/Users/thotos/Documents/Codex/2026-10-04/task-2`: `readiness-complete-tests.log`, `readiness-complete-lint.log`, `readiness-complete-build.log`, `readiness-complete-cloudflare.log`, `readiness-complete-preflight.log`, `readiness-complete-baseline.log`, `readiness-production-preflight.log`, `readiness-change-manifest.json`, `readiness-improvements.patch` and the reconciliation receipt/backups. Original preimages and tested postimages are verified before applying the local bundle. The scoped review/fix cycle is complete; the explicit release decisions and live evidence above remain outstanding.
