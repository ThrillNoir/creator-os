# Expired download page — local milestone, 2026-10-06

## Authority and acceptance

The owner answered yes in Money Penny (`01a10fe5-a6ca-76c6-874a-b6211e74b0e7`) to keeping the creator's approved public name/profile link after expiry while hiding the message and download controls. ATLAS independently read the actual user reply on October 6. This is a bounded public-projection decision, not deployment approval.

After an unclaimed link expires, or a redeemed link's resume session expires, its metadata page may display only the currently active, published, approved SFW creator name and profile link, plus generic interface copy. It must not display the title, custom message, media metadata, private recipient reference, price, or download/resume controls. No automatic redirect.

Malformed, unknown and revoked tokens remain unavailable. A redeemed link with an active session does not gain a public fallback for a browser lacking its cookie. Existing issuer, creator, media eligibility and consent checks remain effective. Withdrawing the approved profile removes this fallback. Expired requests cannot redeem or read bytes.

Profile URLs reuse the existing validated public-profile URL helper and a configured staging origin. Static preflight rejects other origins. Missing/invalid runtime configuration cannot create an unsafe link. No tokens are forwarded to the profile; no-store and referrer protections remain.

## Release boundary

This builds on local commit `1a67fee`; private sales and custom-message migrations 0064–0065 remain pending and unchanged. No new migration or dependency is required. No source media, remote data, Access configuration, traffic or deployment is changed. A later release needs the exact reviewed staging plan, guarded migration/backup/recovery process and fresh release evidence. Roll back code/config with prior reviewed artifacts while retaining additive schema.

## Changed files

- `cloudflare/thot-os-next/src/lib/content-download-links.ts`: separate expiry-only lookup projecting name/slug, retaining issuer, creator, profile, media and revocation restrictions.
- `cloudflare/thot-os-downloads/src/index.ts`: creator-only fallback on metadata GET; existing redemption and byte-delivery paths unchanged; reuse validated profile URL helper.
- `cloudflare/thot-os-next/tests/content-download-links.test.mjs` and `cloudflare/thot-os-downloads/tests/surface.test.mjs`: expiry boundaries, approved provenance, private-field exclusion and deny paths, including POST/byte delivery after expiry.
- `cloudflare/thot-os-downloads/wrangler.staging.jsonc`: public-profile navigation origin only; no service/resource binding changes.
- `scripts/deployment-preflight.mjs` and `tests/download-staging-config.test.mjs`: require the exact existing staging public-profile origin.

Local visual inspection used the actual Worker renderer with a synthetic creator-only database response at localhost. The THOT OS card, generic expired copy and profile link rendered without download controls or private content. This was a rendering check, not staging or authentication evidence. The temporary preview tab and server were closed afterward.

## Gated next step

Review the combined local candidate for a staging-only release of `thot-os-staging` and `thot-os-downloads-staging`. Prepare fresh immutable artifacts and the guarded migration plan for 0064–0065 against staging D1 `174532e8-5ada-4e30-abba-1276b3540b3f`. Obtain approval of that concrete plan/target before a fresh plan-bound backup, recovery replay, ledger reconciliation, migration and deployment. Smoke-test generation, private sales visibility, expiry, revoked/foreign denial and profile navigation, then validate the release receipt. Do not deploy other Workers or change production, Access, media or payment processing.

Client Hub, cross-platform identity linking and AI Inbox remain proposals. Gigi's live login investigation remains deferred. No independent approved implementation work is implied by those proposals.

## Verification

Independent read-only review found no actionable issue. Focused Worker surface tests passed 10/10, including rejected expired-session POST/download and unknown well-formed token cases (`/tmp/thot-oct6-expired-surface.log`).

- `npm run lint`: passed (`/tmp/thot-oct6-expired-lint.log`).
- `npm run build`: passed (`/tmp/thot-oct6-expired-build.log`).
- `npm run verify:cloudflare`: passed (`/tmp/thot-oct6-expired-cloudflare.log`).
- `npm run deployment:preflight -- --environment staging --all`: all 11 components passed static checks (`/tmp/thot-oct6-expired-preflight.log`).
- `git diff --check`: passed.
- `npm test`: passed 120 root + 356 app + 11 downloads = 487 tests, including local replay of all 67 migrations (`/tmp/thot-oct6-expired-tests.log`).

No required local check failed or remains unrun. Temporary logs and local rendering do not prove a live deployment; authenticated staging smoke checks remain a release task.
