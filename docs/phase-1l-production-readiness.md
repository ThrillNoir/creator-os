# Phase 1L production-readiness review

Date: 2026-08-11

## Decision

**NO-GO for production promotion and main-branch merge.**

This review made no production deployment, database, Access-policy, secret,
browser-profile, membership, pairing, platform, Chrome, or Telegram change.

The blocking controls are:

1. No reviewed production Cloudflare topology exists. The reviewed repository
   configuration and the accessible Cloudflare account
   describe staging resources only. There is no reviewed production Worker,
   D1, R2, Queue, route/domain, Access, backup, or rollback configuration to
   certify.
2. The sealed Codex Security scan cannot complete on this host because its
   required preflight helper needs `tomllib` or `tomli`, neither of which is
   available to the host Python runtime. The durable scan remains unsealed.

## Read-only evidence

| Surface | Result | Limitation |
| --- | --- | --- |
| Git base | Clean `main` at `0636ba374cf54c71b79222e2f22612685eee0430` before this branch | None |
| GitHub protection | GitHub Pro permits classic protection; `main` now requires a PR and the six observed Actions checks, requires the branch to be current, and blocks force pushes/deletion | Zero required approvals preserve the emergency administrator recovery path; protections apply to future PRs |
| Staging D1 | 20 migrations applied; no migrations pending; `quick_check` returned `ok` | Staging only |
| Identity migrations 0018--0020 | Cloudflare application tests replay migrations locally and exercise creator isolation; staging reports all migrations applied | No production database was available for comparison |
| Creator/profile preservation | Redacted staging checks confirm the named creator records, Adelaide's two assignments and two active credentials, and no cross-creator assignment or credential rows | IDs, emails, credentials, and pairing data were not read or recorded |
| Staging topology | One staging D1, four staging R2 buckets, two staging queues, and five staging Workers were visible in the accessible account | Does not prove resources in another account do not exist |
| Worker versions and secrets | Each visible staging Worker had deployment history; required secret names were present, but values were not requested or read | Staging only; no production Worker was configured |
| Access | Source tests reject requests without an Access JWT; dashboard review confirmed a primary staging application with four approved identities and a wildcard-preview application with one approved identity | Staging only; no production Access application exists |
| Billing | THOT OS reports zero current/projected cost and no invoices; R2 Paid is active with zero billable usage within included limits | Billing is not a production-readiness substitute |
| QA fixture | `STAGING_QA_ENABLED` is present only in the staging application configuration | A production configuration is absent, so live exclusion cannot yet be proved |
| Health and logs | The health endpoint is intentionally authenticated; no unauthenticated probe or log-tail was performed | Production health/log readiness is unverified |

## Migration and rollback assessment

Migrations 0018--0020 form an expand/contract sequence: identity and
membership tables, audit-role backfill and validation, then role-contract
triggers. The local replay coverage is a positive prerequisite, not an
automatic production rollback mechanism. These migrations include schema
changes and trigger replacement, so a failed production migration must stop
the rollout and restore from a verified pre-migration D1 export rather than
attempting ad-hoc reverse SQL.

Before any production application:

1. Create and verify a production D1 export and record its redacted checksum
   and restore owner.
2. Verify a restore rehearsal against an isolated target.
3. Apply migrations once, stop immediately on failure, and do not deploy code
   that assumes a newer schema.
4. Retain the prior Worker versions as the compute rollback target. A Worker
   rollback does not roll back D1; database restoration requires the verified
   export and a separately approved recovery procedure.

## Required promotion order (not executed)

1. Enable GitHub branch protection or a ruleset on `main` with the actual CI
   checks from this pull request, PR-required merging, and force-push/deletion
   disabled. Preserve administrator recovery only for incidents, not normal
   merges.
2. Define and review production-only Worker, route/domain, D1, R2, Queue,
   service-binding, cron, observability, backup, and rollback configuration.
   Ensure no staging fixture flag or staging service URL is copied across.
3. Compare production and staging Cloudflare Access applications and policies
   while authenticated. Confirm the production policy fails closed, contains
   only approved identities, and has no staging QA identity or fixture access.
4. Back up and rehearse recovery for the production D1 target, then apply the
   migration plan in the order above.
5. Deploy the application and Workers in dependency order, verify authenticated
   health, Access, bindings, cron state, and logs, and stop on any failed
   migration, Access failure, or creator-isolation failure.
6. Keep platform operations disabled through verification: no posting,
   messaging, media retrieval, or new pairing. Re-run creator-isolation checks
   before any later platform enablement.

## CI scope

`.github/workflows/verify.yml` runs only for pull requests to `main`, cancels
superseded runs, grants `GITHUB_TOKEN` only `contents: read`, uses immutable
checkout and Node setup action revisions, and uses `npm ci` in every package.
It runs reproducible root lint, tests, build, TypeScript, and diff checks;
the root database integrity/isolation scripts remain data-dependent local
checks and were run locally in this review. Cloudflare application tests
include local migration replay and isolation coverage,
Next and OpenNext builds, all standalone Worker TypeScript checks, and Telegram
unit tests. It deliberately contains no deployment command, Cloudflare token,
secret, platform session, or authenticated service-identity verification.

The first successful run established the six concrete status names, and those
same GitHub Actions contexts are now required on `main`; no unavailable or
synthetic context was added.

## Redacted CI security receipt

Manual review of the workflow confirms that it uses the `pull_request` event
(not a privileged target event), exposes only `contents: read`, disables
persisted checkout credentials, pins its two GitHub Actions dependencies by
immutable revision, and contains no deployment, Cloudflare, platform, browser,
secret, or service-identity command. It also cancels superseded pull-request
runs.

The first successful run used these checks: `Root verification`, `Cloudflare
application`, `Worker - Instagram scheduler`, `Worker - Reddit scheduler`,
`Worker - Telegram bridge`, and `Worker - Vault bridge`.

The current durable Codex Security scan targets the stable PR head, but cannot
pass its mandatory preflight on this host because Python lacks `tomllib` and
`tomli`. Consequently this is a manual security receipt, not a sealed
workbench report, and remains a certification blocker.
