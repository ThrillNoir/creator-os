# Staging bundle preparation — 2026-10-05

Status: local preparation and read-only remote observations. No migration, Worker deployment, Access policy save, production change or payment activation has occurred in this preparation.

## Scope and targets

- Carry the accepted October 4 onboarding/invitation, catalogue/batch/recovery, upload/preview/video, commission/manual-payment and UI fixes into the existing booking release checkout. Web target: `thot-os-staging`; Fansly uncertain-transfer safety also updates `thot-os-vault-bridge-staging` and the locally installed browser extension (a Worker release does not update an installed extension).
- One-time video links: `thot-os-downloads-staging` at `https://thot-os-downloads-staging.thot-os.workers.dev`, with only `DB` = staging D1 `174532e8-5ada-4e30-abba-1276b3540b3f` and `LIBRARY_MEDIA` = `thot-os-library-media-staging`. No custom routes, preview URLs, credentials or production bindings. First bootstrap is disabled (`ENABLED=false`), then a separately reviewed ordinary artifact enables it; web issuance is independently gated by `CONTENT_DOWNLOAD_LINKS_ENABLED=1` and the exact staging hostname.
- Additive migration range: only `0063_content_download_links.sql`. Preserve all existing membership, assets and applied migration history. Keep the frozen production baseline unchanged.
- Access proposal: staging-only Allow policy `1605b080-6163-409b-a491-02f789c9ebf6` retains its seven existing emails and adds Include / Login Methods / `One-time PIN • thot-os-staging - Cloudflare Workers`. The application still requires an active D1 user/membership or a valid email-bound invitation. The Service Auth policy, preview application, session settings and production are outside the diff. Anyone can authenticate email at the outer edge after this change; authentication alone grants no workspace membership. Save only after the application hardening is released and the exact access change is approved.
- Payment collection, processor onboarding, automatic payouts and the proposed direct-sale 50/50 split are excluded. Existing commission proposals/manual reported payments are a separate already-implemented workflow.

## Fresh read-only observations

On October 5, web served version `8e74572f-2552-4d8b-ae29-467c38861d3d` at 100%; vault served `426a2d7c-3119-4ef2-a213-85a76440d4d7` at 100%. D1 had 64 applied entries, last `0062_booking_delivery_evidence.sql`. The downloads Worker was absent, proven by exact account/Worker provider code `10007`. The Access policy UI showed one application, exactly `thot-os-staging.thot-os.workers.dev`, and seven email identities. Reobserve before mutation; these observations are not perpetual release evidence.

## Local evidence

The assembled release checkout preserves the seven booking commits through `299bf4c`. Source scope comes from the three accepted October 4 manifests plus the October 5 download implementation, runtime/configuration guards and negative tests.

Passed local lint, build, Cloudflare verification, staging static preflight and full test suites. The assembled checkout passed 119 root tests, 340 app tests and 6 download tests before the final browser-discovered header correction; the corrected Worker suite subsequently passed all 6 tests. Final release artifact checks and migration plan are separate evidence and must be attached before approval.

The integration fixture applies all 65 real migration files locally, uses a local-only D1 identity, synthetic R2 data and a frozen clock, and verifies issue, foreign-creator denial, redeem, byte range and revoke against shared state. Range tests include a logical 5 GiB object without allocating it. This is not a real 5 GiB network transfer benchmark.

A real local browser click exposed `Referrer-Policy: no-referrer` producing `Origin: null` on the form POST. The metadata page now uses `same-origin`; cross-origin referrers remain suppressed and null/foreign origins still fail. Retest produced POST 303, GET 200, exact synthetic downloaded bytes and a Resume page with the one-hour session deadline. Browser evidence: `/tmp/thot-oct5-download-browser-pass.png`. This verifies the recipient flow, not a live staging creator/browser journey.

Additional tests verify a cryptographically valid Access assertion without an active D1 user is denied, invalid/expired/wrong-audience assertions fail before D1, wrong-email/expired/revoked invitations fail, and operator/creator isolation remains enforced.

## Execution and recovery

1. Establish clean reviewed release commit and immutable web/vault/download artifacts. Generate exact staging-only migration plan; obtain approval for its target/range/digest.
2. Immediately before migration apply, take the existing plan-bound owner-only backup, run isolated replay/integrity/foreign-key recovery checks, and recheck the migration ledger. Apply only 0063 through guarded tooling; reconcile before any retry.
3. Record observed applied ledger, rebuild/plan against that clean source identity, and deploy only reviewed artifacts. Bootstrap downloads disabled; check denial before enabling download delivery and web issuance with the reviewed configuration/artifacts.
4. Authenticated staging checks: admin and creator routes, invitation denial/isolation, catalogue/upload recovery, safe finance display, and synthetic download issue/redeem/resume/replay/expiry/revoke. No actual platform publishing or payments. Installed extension update remains a separate local action.
5. Save the precisely approved OTP Include rule only after app hardening checks; verify new-email OTP and unauthorized workspace denial. Do not interpret a policy save as proof of email delivery.
6. Record fresh Worker versions/traffic, D1 ledger, authenticated smoke evidence and validated release receipts. Until then status is prepared, not deployed/verified.

Recovery: remove only the added OTP Include rule to restore the seven-email policy; set download runtime and issuance flags off to deny new requests, and use reviewed previous Worker versions through guarded rollback. Keep additive schema and records intact; do not destructively roll back D1. Revocation cannot retract bytes already delivered. Never retry an uncertain remote outcome before reconciliation.
