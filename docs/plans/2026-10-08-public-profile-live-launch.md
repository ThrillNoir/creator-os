# Public profile live-domain launch

Status: proposed launch plan; no deployment or remote mutation authorized by this document.
Scope: creator link-in-bio profiles, images, More from, booking enquiries and existing email replies. Keep the private THOT OS editor at its current address. Reuse existing Workers, D1, KV, R2 and publishing workflows; do not build a second platform or synchronization layer.

## Intended addresses

| Surface | Proposed address |
| --- | --- |
| Creator profile | `https://www.thathuboverthere.com/<saved-creator-slug>` |
| Bare-domain profile | `https://thathuboverthere.com/<saved-creator-slug>` redirects to the matching www path |
| Public display images | `https://www.thathuboverthere.com/media/*` |
| More from | `https://more.thathuboverthere.com/age/<saved-creator-slug>` |
| Booking enquiry | `https://booking.thathuboverthere.com/book/<saved-creator-slug>` |

The public domains never host the private dashboard or private publishing-control Worker. Preserve SFW/adult storage separation and the existing age gate, creator authorization, service grants and private-media boundaries.

## Accepted direction and remaining release decision

The user wants the existing editor and backend reused, with a separate URL for every approved creator. Internally staging-named resources would become live dependencies. Record this explicitly in the deployment registry and guards before release; do not bypass their current staging-only checks or claim the result is isolated production. The unused production foundation need not be connected or deleted.

Routine draft saving remains private. Publishing and withdrawal affect one live target. Independent staging/live publication is outside this plan: the current published-version pointer and delivery identities do not distinguish targets. Test work must not overwrite live creator projections or send unsolicited email.

## 1. Read-only launch inventory

- Verify account, zone, www/apex DNS, existing records, TLS and Worker route ownership. Preserve unrelated records, including mail DNS.
- Record current Worker versions, traffic, bindings, configuration, D1 ledger and recovery capabilities; inspect Turnstile hostname settings and email-domain readiness.
- Inventory public, adult and contact projection keys using metadata and redacted summaries. Do not dump private contact values or source media.
- Build a creator launch checklist from actual saved slugs, active state and approved versions. Adelaide is the first canary; other creators require explicit inclusion, not guessed slugs or a blanket publication grant.
- Identify synthetic/test projections and prevent them being served on the live hosts, using reviewed withdrawal or a narrow serving restriction. Do not delete source media.

## 2. Prepare the smallest local change

- Reuse the existing public-links, public-media, adult-gateway and public-contact Workers for the new routes.
- Update URL generation and exact-origin validation consistently in the public Workers, private publishing control and editor. Audit download-page return links for compatibility without expanding the launch to downloads.
- Configure the exact booking and More hostnames in Turnstile and application verification. Reuse existing widgets if appropriate and permitted by their verified configuration; do not assume new widgets or secrets are necessary.
- Make the registry, guarded release tooling and tests describe the approved live use of these existing resources. Retain exact target checks, creator scope, artifact verification and receipts.
- Clearly label the editor's live publishing destination. Keep the private draft preview.
- Plan hostname transition order so old projections and new validators do not produce broken pages. Decide bounded compatibility/redirect behavior for old public URLs; preserve paths and do not redirect enquiry POST bodies blindly.

## 3. Prepare each creator

- Confirm a unique saved public slug, correct identity/branding, approved profile version, permitted links and approved display derivatives.
- Confirm only the intended creator has publishing/service permissions. Extend the Adelaide-focused policy narrowly for each approved launch creator; exclude fixtures.
- Show More from only for that creator's approved, published protected profile; preserve the separate age gate and media checks.
- Show Bookings only when enabled with valid creator contact settings and required service permission. Verify configured reply template and PDF/image attachments when enabled.
- Refresh published snapshots through a reviewed path that actually rewrites their embedded origins. Existing workflow IDs are version-derived: repeating a completed publication can return duplicate success without rewriting anything. Use the normal new-version approval/publication flow where sufficient; verify actual output and preserve attachment/consent state.

## 4. Validate and prepare approval packet

- Run required lint, tests, build, Cloudflare checks, deployment preflight and diff checks after implementation.
- Verify draft privacy, publish/update/withdraw, creator isolation, rejection of unauthorized or stale versions, and no test-profile exposure.
- Verify www and bare-domain navigation, images, outbound links, More redirects and return links, age/Turnstile denial, booking validation and duplicate-send protection.
- With approved synthetic recipients, verify creator notification and enabled visitor acknowledgement, Instagram link, reply-to and attachments. Check actual receipt/inbox evidence; provider acceptance alone is not delivery confirmation.
- Prepare exact Worker/domain/configuration targets, artifact identities, publication actions, backup references, rollout order and rollback before requesting final remote approval. No database migration is assumed; any discovered schema change needs its own reviewed plan.

## 5. Cut over and release creators

- Release Adelaide first under the approved plan; verify its three public flows on the live hosts.
- Enable subsequent approved creators individually using the checklist. Shared infrastructure does not automatically publish or authorize every creator.
- Record fresh versions, traffic, DNS/TLS, data-state observations, smoke evidence and validated release receipts. Keep unresolved checks explicitly open.

## Recovery and operating limits

Capture recoverable pre-cutover configuration and projection state. Rollback must restore compatible URL configuration and published snapshots as well as Worker traffic/routes; code rollback alone does not restore KV/D1 changes. Preserve booking receipts to avoid duplicate sends, and reconcile uncertain email outcomes before retrying. Changes to the shared editor, database and private backend must be assessed for live impact after launch.

Evidence basis: repository inspection and public-page browser checks on 2026-10-08. The staging profile, booking form and More age gate loaded; www did not resolve in that browser. Authenticated Cloudflare resource inventory and this plan's launch checks remain pending. Current executable contracts are in `config/deployments.json`, Worker configurations and `scripts/deploy-component.mjs`; this plan is not evidence of deployment.

## Preparation update — 2026-10-08

Authenticated read-only inspection confirmed zone `a153d7ee7a17e2a7ec69e66c2f81a08f` is active in account `3e7cfa6efb7a97825f1dc24515410c63`; Cloudflare is the registrar. DNS lists the three staging Worker hosts and email records, with no www or apex web record. Mail records are outside the cutover.

Remote D1 and KV agree on Adelaide's SFW version `338d675a-800a-495c-a2e7-3c64e111030f` (version 16), adult version `15e05ebb-80f5-41f5-9695-d74fa667713b` (version 4), and corresponding booking snapshot. The only other public KV key is `public-profile:staging-authz-fixture`; adult/contact inventories contain Adelaide only. Bryshanagy has drafts, not a published profile. Other creators are not part of the first release.

Both existing Turnstile widgets are Managed with pre-clearance disabled and one staging hostname each. The exact proposed changes are to add `booking.thathuboverthere.com` to widget `0x4AAAAAAFI459ZZKtJAgrMg` and `more.thathuboverthere.com` to widget `0x4AAAAAAEZL1cy4h2SV62cN`, preserving their old hostnames, modes and secrets.

Local implementation retains current resource identities, adds the new routes and exact release guards, and restricts all live creator-facing paths to Adelaide. Fixture projections remain stored but cannot be served by the new routes. Old GET/HEAD URLs redirect temporarily with no-store; stale booking/age-gate POSTs require a fresh form rather than forwarding private payloads. This serving restriction avoids destructive fixture cleanup.

Proposed cutover sequence after exact-plan approval:

1. Recheck current versions/traffic, published version IDs and recovery snapshot hashes. Stop on drift.
2. Add the two reviewed Turnstile hostnames.
3. Deploy public-media, adult-gateway and booking Workers to add their live routes, and deploy the private publishing control with canonical live URLs. The four components keep their existing private/public boundaries.
4. Through the existing authenticated editor, save new versions matching Adelaide's currently published content, compare content checksums, and publish SFW/adult versions so their workflow IDs are fresh. Stop on unrelated content changes, attachment mismatch or failed publication. Verify actual snapshots use the new origins; a duplicate response is insufficient.
5. Deploy public-links last among public surfaces, attaching www/apex and enabling old-profile redirects. Deploy the editor's canonical-link configuration. The existing editor origin does not change.
6. Verify live behavior and denial cases, record receipts, then seek separate creator-specific readiness for any additional creator.

There may be a brief staging-profile interruption while regenerated snapshots await the frontend cutover. Stop rather than leave a partial transition; recovery must restore matching Worker versions and projection origins. Owner-only pre-cutover snapshot files are held outside Git under `/Users/thotos/.codex/release-evidence/public-live-2026-10-08/`. No remote changes have been made in this preparation update.
