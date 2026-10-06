# Download follow-up checklist — 2026-10-06

This is a local design checklist, not evidence of deployed or live state. The August roadmap in [REVENUE-AI-ROADMAP.md](../REVENUE-AI-ROADMAP.md) is historical; use the dated [execution checkpoint](2026-10-06-roadmap-execution.md) and current source for today's scope.

## Current local milestone

- [x] Style the valid download page to match THOT OS and show a creator name only when it comes from the creator's currently published SFW profile.
- [x] Preserve the existing download checks: active creator and issuer, eligible immutable private R2 original, single-use link claim, one-hour session, and revocation checks.
- [x] Keep this local work separate from live status; no deployment or provider action is authorized.

The approved name source is `creator_public_profile_versions.display_name` joined through `creator_public_profiles.published_version_id`, requiring matching profile and creator IDs, `p.status='active'`, and `v.status='published'`. The current guard and projection are in [`loadCurrentPublicProfile`](../../cloudflare/thot-os-public-links-control/src/index.ts) and the public Worker validates and renders only the projected `creator.displayName` in [`validSnapshot` and `renderProfile`](../../cloudflare/thot-os-public-links/src/index.ts). Do not fall back to `creators.name`, legal identity, or the adult profile. The local download implementation now uses that source for valid links and sessions, and returns no name when the source is unavailable ([source](../../cloudflare/thot-os-next/src/lib/content-download-links.ts)). Approval identity and date must also be present. This does not prove a live deployment.

## Minimal custom-message / sale contract — plan only

- [ ] Add one optional creator-authored message to the shared page; proposed maximum 500 characters of plain text, captured on the link at generation and escaped on render, and keep message content separate from the approved profile bio. No AI drafting is implied.
- [ ] At generation, allow a private recipient reference and manually entered sale amount plus ISO 4217 currency. Store these on the creator-scoped download record (or a minimal creator-scoped sale row only if one sale can cover multiple links); never expose recipient or amount on the public page.
- [ ] Record manual entry as unverified operator data. It is not proof of payment, redemption, delivery, or platform earnings. Keep currencies separate and do not derive sales from link views or downloads.
- [ ] Before schema work, decide recipient-reference format, whether it can contain direct identifiers, who can read it, correction/merge rules, and retention/deletion period. Do not create Client Hub or cross-platform identity linking as part of this contract.

## Decisions required before persistent pages

- [ ] Define what remains visible after the one-day bearer link expires, after explicit revocation, and after the asset becomes ineligible or its creator is inactive. The current download metadata path returns unavailable when link eligibility/expiry fails; a claimed session lasts one hour and revocation blocks session access ([download checks](../../cloudflare/thot-os-next/src/lib/content-download-links.ts), [Worker page](../../cloudflare/thot-os-downloads/src/index.ts)). A page that remains available therefore needs a separate page-visibility lifetime and an explicit content allowlist.
- [ ] Choose whether expiry hides only the download control while title, approved creator name and custom message remain visible, and set the maximum post-expiry display duration. Decide whether revocation hides the whole page immediately or only disables download. No duration or post-revocation exposure is approved yet.
- [ ] Decide recipient data retention and deletion separately from public-page retention, including whether the sale record must survive deletion of its recipient reference.
- [ ] Keep the approved creator-profile Explore link optional and only render a current, approved SFW profile destination. No automatic redirect.

## Existing data boundary

The current [`content_download_links` schema](../../cloudflare/thot-os-app/migrations/0063_content_download_links.sql) stores private creator/asset scope, title, immutable source identity, hashed bearer/session tokens, expiry, redemption, revocation, and issuer; it has no recipient or sale fields. Generation and enforcement live in [`content-download-links.ts`](../../cloudflare/thot-os-next/src/lib/content-download-links.ts). Do not implement a migration until the exposure and retention decisions above are resolved.

## Working roadmap order

These checkpoints reconcile the August plan with October requests; they do not mark historical remote observations as current verification.

| Order | Work | Evidence/status and next gate |
| --- | --- | --- |
| 1 | Reliable onboarding, access and existing delivery | Approval-panel/download-feedback fixes are locally tested at `c3bfd2b`. Deployment and authenticated smoke checks remain separate; Gigi access investigation remains deferred. |
| 2 | Download recipient experience | Current local milestone adds styling and public name only. Custom message follows as a bounded additive field; persistent expired pages need the visibility decision below. |
| 3 | Recipient and manual sale recording | Explicit human download notes request these fields. Confirm retention/correction rules before adding schema; this is not payment collection or proof. |
| 4 | Messaging and account reliability | Existing roadmap calls for provider-specific inbound/reply/receipt/recovery and multiple-account proofs. August results are historical, not evidence those gates pass today. |
| 5 | Earnings and creator assistant | Existing direction: reviewed currency-separated imports, deterministic daily brief, then summaries/drafts grounded in approved facts. Missing exports and provider evidence remain explicit. |
| Proposal | Broader Client Hub, cross-platform identity linking, AI inbox and Telegram recap | Not authorized implementation scope. If accepted, manual creator-scoped client records support inbox triage; no automatic identity merging or autonomous sends. |
| Later | Production pilot | Separate reviewed release decision after staging acceptance; no production action in this milestone. |

Smallest proposed persistent-page choice for owner review: after ordinary expiry, show only the currently published public creator name and approved SFW profile link for up to seven days; hide the title, custom message and download controls. Revoked links, inactive creators and ineligible media continue to return unavailable immediately. Seven days is a proposal, not an approved retention rule. Until decided, all existing expiry behavior stays unchanged.

## Local milestone verification

The commit containing this checklist is based on `c3bfd2b`. Local implementation changes are limited to the download Worker renderer/styles, the shared name lookup, and their two test files. No schema, package, deployment configuration or remote state changed.

- `npm test`: passed 119 root + 344 app + 7 download tests, 470 total (`/tmp/thot-oct6-brand-tests.log`).
- `npm run lint`: passed (`/tmp/thot-oct6-brand-lint.log`).
- `npm run build`: passed (`/tmp/thot-oct6-brand-build.log`).
- `npm run verify:cloudflare`: passed (`/tmp/thot-oct6-brand-cloudflare.log`).
- `git diff --check`: passed. Static deployment preflight was not repeated because deployment/configuration files did not change.
- Read-only independent review found no actionable issues with creator-name isolation, HTML escaping, CSP or existing download authority.
- Browser inspection of the actual Worker renderer with synthetic local metadata passed at desktop size and 320px width, with a visible keyboard-focus outline on Download. The temporary fixture rejected POST requests; it was used only for presentation checks. The local migrated-schema integration test separately proves claim, byte range and revocation behavior. No live creator records or source media were used for the visual fixture.

This is local completion only. No deployment or live browser verification of the new page occurred. Custom message, persistent expired-page behavior and recipient/manual sale fields are not included in this commit.
