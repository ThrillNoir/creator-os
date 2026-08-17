# Phase 2A ACTIVATE — staging failure receipt

- Result: **STOPPED / FAILED before canonical D1 activation**
- Activation ID: `staging-canonical-service-auth-v1`
- Branch / HEAD: `audit/pre-cleanup-snapshot-2026-08-15` / `6730e9dff4621ec22f1673d29a0048fcc1e63d29`
- Target: THOT OS staging D1 only. Production touched: **NO**.

## Fresh approval evidence

- Fresh plan: canonical staging migration history remained exactly `0001`–`0032`, ending `0032_service_auth_compatibility.sql`.
- Fresh structured activation state was `ABSENT`: zero activation runs, steps, canonical principals, credential hashes, grants, and audit events.
- The approved plan remained exact: 4 planned principals, 4 credential hashes/secret destinations, and 15 Adelaide-scoped grants.
- A new external read-only D1 export/receipt was created and revalidated against this plan: 32 migrations, `PRAGMA quick_check = ok`, and zero foreign-key violations. The raw export remains outside the repository in the protected local backup directory.

## Attempt and reconciliation

- One explicitly approved staging `--apply` attempt was made.
- Worker secret staging returned locally, but the immediately required Worker metadata comparison did not find every expected secret destination on the new latest Worker version.
- The activation executor therefore stopped **before** it attempted the canonical D1 SQL transaction.
- The redacted operation receipt records `FAILED`, no canonical credentials disabled (because none were created), legacy authentication unchanged, and no D1 canonical credential attempt.
- Fresh structured D1 status after the stop remains `ABSENT` with all canonical counts zero.
- Fresh Worker metadata shows the newly latest version remains at 0% traffic. Deployment allocation remains unchanged. The expected canonical destinations were not proven present, so this version must not be routed or used for activation.

## Explicit non-actions

- Canonical principals activated: **NO**.
- Canonical credential hashes installed: **NO**.
- Capability grants activated: **NO**.
- Traffic cutover: **NO**.
- Legacy authentication removal: **NO**.
- Binding, queue-consumer, route, and production changes: **NO**.
- Automatic revoke: **NOT APPLICABLE**; no canonical D1 activation was attempted.

## Next action

Do not retry this activation. Diagnose and harden the Worker secret-staging/metadata path in a separate local-only phase, then rerun a fresh plan, backup, and approval hold. The current zero-traffic Worker version is evidence only; do not route traffic to it or use it as proof that canonical secrets were installed.
