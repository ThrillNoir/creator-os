# Booking enquiry module — local implementation and staging proposal

Observed: 2026-09-28. Local work on `codex/thot-os-canonical`, based on `d8d6a8595ad1dab961a8b7532dea2a9b4f44655b`. Uncommitted implementation; this is not a release receipt. No remote mutation, migration, deployment or real email was performed. The earlier [plan](2026-09-28-booking-module-plan.md) remains a dated planning record; the user subsequently approved its private-service architecture.

## Implemented

Optional non-sexual event-staffing/entertainment enquiries use the existing creator public-profile editor and approval/publication flow. Creators can edit rules, CTA text and add/remove labelled **What to wear** and **Extra spice** options with explanations. The shared validator bounds configuration and visitor input. Existing private SMS/email contacts are used; enabling requires both. Configuration and destinations are included in the approval checksum. Legacy versions without booking configuration retain the previous checksum.

The public contact Worker displays published options and rules, requires acknowledgement and explicit email/Maps-link consent, verifies signed expiring form identifiers, Origin, Turnstile action/hostname and native rate limiting, then calls the private control service. It has no D1 binding. The control service requires the specific `thot-os-public-contact` principal with a creator-scoped `booking.enquiry.submit` grant, rechecks current publication and withdrawal state in D1, resolves recipients independently, claims the submission atomically and requests email delivery. Only after provider acceptance does the visitor receive manually sent WhatsApp/SMS drafts. Provider acceptance does not prove inbox delivery.

Full enquiry data is not stored in D1 or KV. Minimal receipts contain identifier, creator/version, timestamps and send state; expiry is seven days. Submission also purges expired receipts, and a scheduled handler supports periodic cleanup. Uncertain sends retain their nonce and are not automatically retried. Withdrawal intent blocks stale open forms before asynchronous projection removal; re-enabling a withdrawn version requires a new published version.

Viewer/foreign-creator mutations are denied before DB access, and viewer rendering does not query private contact/configuration. Public-profile projection contains only the CTA; contact configuration stays in the separate private projection. No dependencies, custom agent orchestration, calendars, payments or automatic SMS/WhatsApp were added.

## Validation

- `npm run lint`: pass.
- `npm test`: pass, 96 root tests and 229 application tests (325 total).
- `npm run build`: pass.
- `npm run verify:cloudflare`: pass, including Worker type checks/tests and OpenNext verification; booking control suite 14/14 and contact suite 6/6.
- `npm run deployment:preflight -- --environment staging --all`: pass for the **currently registered** targets. The unregistered contact Worker is not covered; this is not staging-release readiness.
- `git diff --check`: pass.
- Independent Luna boundary review: no concrete findings in final public-contact/shared contract; focused contact typecheck and tests passed. Terra implemented separate editor/contact portions; ATLAS integrated and verified.
- Not run: remote migration, provisioning/deployment, real inbox delivery, authenticated staging canary and iPhone/Android app handoffs. No claim of deployed or end-to-end release verification.

Meaningful checks exercise actual validators, signed form submissions, SQL receipt claims, concurrent/duplicate submissions, provider failure, authoritative recipients, stale/withdrawn profiles, consent, rate/Turnstile denial, checksum changes, projection privacy, action authorization and viewer queries. Additive migrations replay locally. Existing replay subprocess buffers were increased from the Node default to the already-used 16 MiB allowance because the expanded migration inventory exceeded 1 MiB of Wrangler output; assertions and logs remain intact.

Initial normal-suite replay failures were output-buffer exhaustion. A quiet diagnostic run passed the replays but suppressed the version-output assertion. One overlapping Next/OpenNext verification attempt conflicted over `.next`; subsequent builds run serially. These unsuccessful attempts are not release evidence.

## Concrete proposed staging activation — not executed

Target account: `3e7cfa6efb7a97825f1dc24515410c63`. Existing staging D1: `thot-os-staging` / `174532e8-5ada-4e30-abba-1276b3540b3f`. Existing Workers: `thot-os-staging` and `thot-os-public-links-control-staging`. Production is excluded.

1. Review and commit the intended artifact separately from pre-existing authority/CI/access work. Extend the existing deployment registry and service-principal tooling to represent the contact Worker as the credential owner; currently the principal planner assumes every caller is the web Worker. Do not put the contact credential in web secrets or bypass guards.
2. Proposed new staging Worker: `thot-os-public-contact-staging`, proposed custom hostname `booking-staging.thathuboverthere.com`, proposed private KV `thot-os-booking-contact-staging`. These are proposed names, not verified available or provisioned resources. Verify DNS/zone and allocation first. Keep preview and workers.dev exposure disabled. Register actual returned resource IDs and audited configuration before deployment.
3. Apply only `0061_creator_booking_module.sql` and `0062_booking_delivery_evidence.sql` after fresh staging ledger verification, exact bounded plan, plan-bound backup and recovery evidence. They are recorded only as pending in the local ledger. Migrate before deploying the new web/control code: profile reads require the new configuration table even when email activation is disabled.
4. Bind the private contact KV to contact/control and `PUBLIC_LINKS_CONTROL` to the contact Worker. Configure Turnstile for the exact hostname, independent form-signing and service secrets, and native limiter 5 attempts/60 seconds per creator/IP (per-location platform limit). The private DB claim additionally caps 20 sends/hour per creator. Store only the service credential hash in D1 and grant only the approved canary creator; no wildcard or publication grant.
5. Bind control EMAIL with sender `welcome@thathuboverthere.com`, configure `BOOKING_ACTION_BASE_URL`, and schedule receipt cleanup every 15 minutes. Receipts expire at seven days and are physically removed on the next successful cleanup; monitor cleanup failures. Start with `BOOKING_ENQUIRIES_ENABLED` disabled. Existing live configuration has none of this activation enabled.
6. Canary proposal: existing `staging-synthetic-creator`, with a separately confirmed test mailbox/phone. Save and publish explicitly approved synthetic options/rules. Enable enquiries only after all bindings, guards and exact artifact checks pass. Do not use a real creator as an implicit test recipient.
7. Verify an actual received email, both manual draft links on available iPhone/Android devices, no automatic messages, creator/operator allowed edits, viewer/foreign-creator denial, stale-version/withdrawal rejection, duplicate/uncertain send handling and cleanup. Record device gaps. Capture fresh versions/traffic/D1 evidence and validate the release receipt through existing tooling.

Required human authority: approval of this exact staging resource/migration/service-grant plan and a canary mailbox/phone. Provisioning approval is distinct from deployment approval: the final runnable registry/configuration and artifact must use the returned resource IDs and pass guards before a release is proposed. The earlier staging intent does not identify these new resources or a migration range. Root [AGENTS.md](../../AGENTS.md), “Migrations” and “Releases or remote infrastructure”, requires explicit target/range and concrete plan approval. There is also local release-tooling work outstanding before activation/deployment; this report does not mark that work complete. Read-only review located the assumptions in `scripts/service-principal-plan.mjs` (all secrets compared with web), `scripts/service-auth-activation-lib.mjs` (hard-coded web staging plan), and `scripts/service-auth-activate.mjs` (aggregate secret payload staged on web). The bounded extension is per-component secret ownership/staging with negative tests rejecting the contact token on web; preserve the existing activation/backup/receipt gates.

Rollback: disable booking activation, revoke the contact principal credential/grants, withdraw the canary projection, and restore previously reviewed Worker versions through existing release guards. Keep additive schema and migration history. Already accepted emails or visitor-sent messages cannot be recalled. Confirm D1 withdrawal state and stale-form denial before declaring rollback verified.

## Changed files

The following manifest belongs to this booking implementation and its local verification. Pre-existing changes to root `AGENTS.md`, `README.md`, CI, `docs/AGENTS.md` and the earlier access-recovery plan are preserved and excluded.

- `cloudflare/shared/booking-contract.ts`
- `cloudflare/thot-os-app/migrations/0061_creator_booking_module.sql`
- `cloudflare/thot-os-app/migrations/0062_booking_delivery_evidence.sql`
- `cloudflare/thot-os-next/src/app/actions.ts`
- `cloudflare/thot-os-next/src/app/public-profile/page.tsx`
- `cloudflare/thot-os-next/src/components/public-profile-editor.tsx`
- `cloudflare/thot-os-next/tests/booking-authority.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0023.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0028.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0030.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0031.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0033-0035.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0039-production-contract.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0040-profile-interactions.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0041-profile-appearance.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0042-profile-image-derivatives.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0043-projection-delivery.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0050-source-media.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0055-provider-connection-account-scope.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0057-instagram-account-scope.test.mjs`
- `cloudflare/thot-os-next/tests/d1-migration-0061-booking-module.test.mjs`
- `cloudflare/thot-os-next/tests/public-profile-surface.test.mjs`
- `cloudflare/thot-os-public-contact/src/index.ts`
- `cloudflare/thot-os-public-contact/tests/surface.test.mjs`
- `cloudflare/thot-os-public-contact/wrangler.local.example.jsonc`
- `cloudflare/thot-os-public-contact/wrangler.staging.template.jsonc`
- `cloudflare/thot-os-public-links-control/src/booking-env.d.ts`
- `cloudflare/thot-os-public-links-control/src/booking.ts`
- `cloudflare/thot-os-public-links-control/src/index.ts`
- `cloudflare/thot-os-public-links-control/tests/booking.test.mjs`
- `config/staging-d1-migration-ledger.json`
- `docs/reviews/2026-09-28-booking-module-implementation.md`
- `docs/reviews/2026-09-28-booking-module-plan.md`
- `tests/bounded-d1-migrations.test.mjs`
