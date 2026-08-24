# Phase 2A EXPAND staging release — aborted at backup validation

- Release ID: `phase2a-expand-staging-20260816t055721z`
- Recorded: `2026-08-16T05:58:43Z`
- Branch: `audit/pre-cleanup-snapshot-2026-08-15`
- HEAD: `46f6b6a7d4e9e24f52e8603bae3d2e93815e116f`
- Environment: staging only
- D1: `thot-os-staging` (`174532e8-5ada-4e30-abba-1276b3540b3f`)

## Passed gates

Repository and local verification passed at clean HEAD `46f6b6a`. Required
boundary (`79f78e2`), bounded-executor (`f9a90df`), and parser-remediation
(`46f6b6a`) commits were present. The staging-only policy remained in effect.

Fresh read-only staging verification found the expected migration history
through `0027`, creators `3`, assets `403`, messages `328`, and legacy trigger
fingerprint `bb7f2736d1cf437c3585729739dca32b8bf4db30cf3dcef9ecdf09c28e3fa34a`.
Production remained unprovisioned and untouched.

A new strict JSON plan selected only `0028`–`0031`, explicitly excluding
`0032_service_auth_compatibility.sql`. Its digest was
`318795e620f662d8cfdc10ccd4311a26ceea6d83decd8aad231792e3d3626f85`.

## Fresh export evidence

The new read-only export receipt reported SQL checksum
`2becc9349fae27bccb20ca25eac807cc51b93c849b80f929e5563ca42b64fe7b` and
receipt hash `fab62d8ca64179bd4b12bcdd980eda123ccbf65369ac3b9e454bfd7c7f29c1eb`.
An independent raw-byte SHA-256 calculation matched the receipt exactly.

## Abort condition

The bounded executor's `validateBackup()` nevertheless rejected the export:

```text
Backup export is missing or its checksum does not match the receipt.
```

Inspection after the gate failure established that the validator supplies a
file `Buffer` to the executor's JSON-oriented `sha256()` helper rather than
hashing raw file bytes. This produces a different digest despite the valid
receipt/export pair. No workaround, retry, or tooling edit was made during this
release.

## Post-abort read-only capture

Staging canonical history remained exactly `0001` through `0027`; no
`0028`–`0032` record exists. Counts remained creators `3`, assets `403`, and
messages `328`.

## Release result

- Migrations applied: none
- `0032` applied: no
- Service-auth activation: no
- Worker deployment or traffic change: no
- Production touched: no
- Push: no

Recommended next action: a separately approved bounded-executor backup-hash
fix with raw-byte regression coverage, followed by a completely new release
ID, plan, and export. Do not reuse this release evidence as authorization.
