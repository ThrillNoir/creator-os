# THOT OS rebuild cutover

Status: local implementation complete for the first safety-and-public-links
slice. No Cloudflare resource, custom domain, D1 database, credential, social
post, account, or Dropbox object was changed by this work.

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
6. Provision, but do not route publicly yet, the following isolated staging
   resources:

   - KV namespace `thot-os-public-links-staging`;
   - Analytics Engine dataset `thot-os-public-link-events-staging`;
   - the public-links and public-links-control Workers; and
   - the `thot-os-web-public-links` service principal, restricted to the
     `public.profile.publish` and `public.profile.withdraw` capabilities and
     explicit creator grants.

7. Put the real KV namespace identifier into both public Worker configurations
   and run generated-type checks again. The committed configurations omit an
   ID intentionally, so they cannot accidentally bind a made-up namespace.
8. Use a synthetic SFW creator to test draft → explicit approval → Workflow
   publish → KV projection → public render → transparent click → withdrawal.
   Confirm that a public request cannot query D1, private previews, Dropbox,
   creator notes, people, consent evidence, or operational account records.
9. Obtain written content/destination compatibility confirmation for the
   selected public domain and social platforms. Then attach the custom domain,
   enable WAF/rate limits, deploy gradually, and run public smoke tests.

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

## Cloudflare product references

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Workflows rules and idempotency: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
- Queues at-least-once delivery: https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- KV consistency model: https://developers.cloudflare.com/kv/concepts/how-kv-works/

These product claims were checked on 2026-08-17 (high confidence). Recheck
them before deployment, and again no later than 2026-11-17, because Cloudflare
capabilities and limits change.
