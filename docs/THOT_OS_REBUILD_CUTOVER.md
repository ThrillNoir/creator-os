# THOT OS rebuild cutover

Status: Phase 2B and Stage 3A staging releases were completed on 2026-08-17.
Stage 3B was deployed to staging on 2026-08-18. No custom domain, real creator
public profile, social post, social account, or Dropbox object was changed by
this release. Stage 3B's first scheduled provider read failed safely because a
legacy connection scope differed from the reconstructed scope; the scheduler
now uses the recorded creator-scoped provider identifier. Its bounded retry
completed, recorded 15 official media observations, and retained the first
failure as an audit receipt.

Stage 4 was staged on 2026-08-19 as a staging-only production-readiness
hardening pass. It adds a private launch gate and bounded per-media
official-insight coverage evidence; it does not provision production, create a
public route, attach a custom domain, or change Dropbox. The post-deploy
scheduled coverage receipt and authenticated visual check remain the final
staging evidence. Its release record and production prerequisites are in
`docs/STAGE_4_PRODUCTION_READINESS.md`.

## Staging execution record

- The approved `0033`–`0036` D1 migrations and creator-scoped service
  principals are active in the sole staging database.
- The isolated `thot-os-public-links-staging` KV namespace, public control
  Worker, public Static Assets Worker, and `thot-os-public-link-events-staging`
  Analytics Engine dataset are deployed. The public Worker binds only KV,
  Analytics Engine, and static assets; it has no D1 or private R2 binding.
- Link analytics use the public creator slug as Analytics Engine's tenant index.
  Aggregate profile-view and link-click events contain no visitor identifier,
  private creator data, or destination query-string telemetry.
- A synthetic SFW profile using only `example.com` completed draft → explicit
  approval → publish Workflow → KV projection → public render → transparent
  click → withdrawal Workflow. The private D1 and KV synthetic rows were then
  removed; no real creator route exists.
- Deployment receipts are stored outside the repository at
  `/Users/thotos/THOT-OS-PHASE2A-RELEASES/staging-worker-rollout-2026-08-17/`.
  The Stage 3 Growth Insights rollout receipt is `stage3-growth-web.json`, for
  Worker version `01508612-6dbd-4ff5-a30b-7d4c392c6bdc`. The subsequent
  Accounts-page Instagram connection rollout is
  `stage3-instagram-accounts-web.json`, for current Worker version
  `cc90b550-9142-45a3-b04d-d00244d2fb61`. The latter received authenticated
  browser verification without starting an OAuth flow or returning application
  data to an unauthenticated request.
- Stage 3B receipts are stored in
  `/Users/thotos/THOT-OS-PHASE2A-RELEASES/staging-worker-rollout-2026-08-18/`:
  `stage3b-0037-oauth-plan.json`, the checksum-bound staging export and
  `stage3b-0037-oauth-apply.receipt.json`, followed by `stage3b-web.json`,
  `stage3b-public-links.json`, `stage3b-instagram.json`, and
  `stage3b-instagram-verified.json`. The current scheduler repair is Worker
  version `9c4e46a6-8e99-40ab-8dfb-82475be89dd0`.

## What is now implemented locally

- `0033` prevents the known cross-creator asset, person, account, community,
  post and event relationships; it records existing inconsistencies without
  deleting them.
- `0034` adds immutable public-profile versions, explicit link and public-media
  approval records, a published-version pointer, and publication history.
- `0035` adds a durable operation outbox, provider receipt states, append-only
  Instagram metric observations, and verified conversion receipts.
- Instagram and Reddit resolve Dropbox through the creator-scoped D1 provider
  connection. The former global Dropbox connected-account secret has been
  removed from their configurations.
- Preview dispatch uses D1 outbox intent before Queue delivery. Replayed queue
  messages remain safe because the consumer claims by creator, asset and
  source revision.
- Instagram, Reddit and Telegram now retain an `uncertain` provider receipt
  when an external action may have succeeded but its local receipt could not be
  persisted. A human reconciliation is required; no automatic resend follows.
- The public links Worker has only Static Assets, an approved public KV
  projection and aggregate Analytics Engine writes. It has no D1 or private R2
  binding.
- The private control Worker publishes an approved profile version through a
  Cloudflare Workflow. It validates the version and links, writes the KV
  projection, then records the D1 publication atomically and idempotently.
- The private OpenNext workspace now has a creator-scoped Public profile screen:
  save a draft → human approval → durable publish request. It never reads or
  selects private previews, Dropbox objects, creator notes, people, consent
  evidence, or operational account records for the public surface.
- `0036` permits one mutable draft version per creator, prevents reopening an
  approved version, and makes a public slug immutable after first publication.
  The public-control Worker also has a separate durable withdrawal Workflow:
  it removes the KV projection before marking the private profile paused.
- `0037` records each creator-scoped Instagram analytics attempt in a separate
  durable ledger. The analytics-only route and bounded cron selector do not
  read Instagram messages, change account state, or publish. A single active
  provider read is allowed per creator; abandoned attempts and failures are
  retained and become eligible for retry after 15 minutes.
- Public-link analytics now count aggregate profile views as well as approved
  link clicks. Neither event contains visitor-level data, and neither is
  attributed to Instagram content without a future explicit privacy-reviewed
  contract.
- The canonical internal-service contract adds a fifth, independently revocable
  principal (`thot-os-web-public-links`), granted only
  `public.profile.publish` and `public.profile.withdraw` for explicitly named
  creator workspaces. Its raw bearer is a Web-Worker secret and is never given
  to the public Worker or stored in source control.

## Explicit non-goals and removed paths

Cloudflare Pages is not part of this build. The public surface is one Workers
Static Assets application, routed by creator slug. Cloudflare's current Workers
guidance says that new sites should use Workers Static Assets; Pages remains
supported but is not the target for new platform investment. Source:
https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
(observed 2026-08-17; high confidence; recheck before release).

The public site is not a redirect-cloaking system. It exposes only creator-
approved HTTPS destinations through a single `/go/{creator}/{link}` redirect.
No browser/device automation, karma farming, covert likes, comments, follows,
or platform-evasion behavior is part of this deployment.

The retired Reddit browser publisher and root local scheduler are not deleted
yet. Remote credentials, active clients and rollback dependencies must be
verified first. Their source remains frozen as migration/reference material.

## Staging release sequence

1. Read the remote D1 identity and complete migration history. Do not assume a
   last migration from local files.
2. Create a reviewed bounded migration plan and a fresh, checksum-validated D1
   export receipt. Existing `0029`–`0032` service-auth boundaries remain
   separate approvals; do not combine them blindly with this slice.
3. Once the pre-state is exactly known, release `0033` alone and inspect the
   non-destructive `tenant_integrity_exceptions` table. Resolve or explicitly
   quarantine every entry before operational use of the affected records.
4. Release `0034`, `0035`, and `0036` only after the `0033` acceptance evidence is
   recorded. Regenerate the schema-only baseline and store its checksum with
   the release receipt.
5. Deploy the scheduler/bridge changes only with `0035` present. They depend
   on `operation_outbox` and `external_operation_receipts`.
6. Provision the following isolated staging
   resources:

   - KV namespace `thot-os-public-links-staging`;
   - Analytics Engine dataset `thot-os-public-link-events-staging`;
   - the public-links and public-links-control Workers; and
   - the `thot-os-web-public-links` service principal, restricted to the
     `public.profile.publish` and `public.profile.withdraw` capabilities and
     explicit creator grants.

7. Put the real staging KV namespace identifier into both public Worker
   configurations and run generated-type checks again. Do not create or bind a
   production namespace until production has been explicitly approved.
8. Use a synthetic SFW creator to test draft → explicit approval → Workflow
   publish → KV projection → public render → transparent click → withdrawal.
   Confirm that a public request cannot query D1, private previews, Dropbox,
   creator notes, people, consent evidence, or operational account records.
9. Obtain written content/destination compatibility confirmation for the
   selected public domain and social platforms. Then attach the custom domain,
   enable WAF/rate limits, deploy gradually, and run public smoke tests.
10. Release `0037` before the analytics-only scheduler/web changes. Verify a
    manual analytics refresh through authenticated staging when a human is
    ready to request a provider read, then inspect the collection receipt and
    metric observations. Do not refresh messages as part of that check.

## Acceptance evidence

Before enabling a real creator route, attach all of the following to the
release receipt:

- fresh D1 export and migration-history evidence;
- `PRAGMA quick_check` and foreign-key check results;
- zero unresolved tenant-integrity exceptions for the released creator;
- creator-scoped provider connection proof with no shared Dropbox account ID;
- Queue duplicate and failed-enqueue test evidence;
- provider-success/database-write-failure reconciliation evidence;
- approval checksum, expiry, destination-host and public-media approval tests;
- public Worker binding inventory proving there is no D1/private-R2 binding;
- custom-domain/WAF/security-header test results; and
- an explicit rollback target for both the Worker version and published profile
  version.
- Stage 3 adds a private, creator-scoped Growth Insights page and read-only API.
  It reads only the latest official Instagram observation for each media ID,
  excludes incomplete metric sets instead of treating them as zero, and returns
  a source observation time, sample size, confidence and recheck point with
  every recommendation. It neither calls a provider nor creates a public
  action.

## Cloudflare product references

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Workflows rules and idempotency: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
- Queues at-least-once delivery: https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- KV consistency model: https://developers.cloudflare.com/kv/concepts/how-kv-works/

These product claims were checked on 2026-08-17 (high confidence). Recheck
them before deployment, and again no later than 2026-11-17, because Cloudflare
capabilities and limits change.
