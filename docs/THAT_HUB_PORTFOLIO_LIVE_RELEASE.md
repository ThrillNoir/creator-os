# That Hub Portfolio release

Status: release code deployed, 20 October 2026. Staging D1 migration 0067, the
scoped Adelaide service grants, and the three approved Workers are live. No
Portfolio release record or media was published automatically. The creator
approval and live card checks in step 6 below remain to be completed with a
real eligible selection. The older synthetic preview remains a local fixture.

## User flow

1. A creator adds items from the THOT OS Content Library and edits categories,
   genres, order and visual draft in the 18+ Portfolio workspace.
2. For a full video, the creator links a separate H.264 MP4 teaser to that
   video in the Library and chooses its thumbnail. A release accepts a teaser
   only when its MP4 timeline is at most 60 seconds and its file is at most
   64 MB. Both original and teaser must pass creator, rights and recorded
   consent checks.
3. The creator selects up to 24 ready cards, optionally sets a Telegram username
   and/or email address, confirms public preview rights and consent, and presses
   **Approve and publish**. This records an immutable approval in D1. An
   authenticated control Workflow copies approved previews and thumbnails to
   the isolated adult R2 bucket, then writes a versioned adult KV projection.
4. A visitor on `https://more.thathuboverthere.com/<slug>` sees the published
   cards only after a valid age session. Media is served from the adult bucket
   through session-bound routes. Full Library originals and authoring keys stay
   private. For a full-length request, the visitor supplies a name and reviews
   a prepared Telegram or email message in their own app; there is no inbox,
   payment or download entitlement in this release.
5. **Withdraw public Portfolio** removes the projection first, then the isolated
   media. A retry is available if withdrawal stalls. The existing 15-minute
   control cron rechecks source rights and consent and retries withdrawal.

## Actual boundary

The Worker named `thot-os-adult-gateway-staging` serves the live
`more.thathuboverthere.com` domain. `thot-os-public-links-control-staging` uses
staging D1 and the isolated adult KV/R2 resources for that live public reuse.
Its publication policy currently admits only the declared `adelaide` creator.
The canonical THOT OS manager is `thot-os-staging`. These names must not be
mistaken for a private preview audience.

## Deployment record, 20 October 2026

The deployed source commit is `fd57a5fe586cbe37768c56dc58b408d8ec804228`.
The bounded D1 receipt confirms only `0067_creator_portfolio_releases.sql` was
applied (migration history row 69). The scoped grant receipt verifies two
active Adelaide capabilities: `adult.portfolio.publish` and
`adult.portfolio.withdraw`. The approved Worker runner receipts confirm 100%
traffic on these versions:

| Component | Worker version |
| --- | --- |
| `thot-os-public-links-control-staging` | `0c246be8-af5a-484b-89a6-000a98d9b0cc` |
| `thot-os-staging` | `c66f2c54-3ed4-4147-bcf4-cbf7b6fda52c` |
| `thot-os-adult-gateway-staging` | `b687e170-bc60-4262-9052-d9ab98195fd1` |

Owner-only plans, backup and receipts are in the sibling
`portfolio-release-evidence/` directory. Public HTTP checks returned 200 for
`/age/adelaide` on More and 404 for the unaged `/adelaide` page. An unsigned
request to staging `/health` redirects to Cloudflare Access, so authenticated
health and creator UI checks are still pending. A scoped read of staging D1
returned zero Portfolio release records. The public card, playback, contact,
isolation and withdrawal checks require a real creator-approved release.

## Release order and checks

All remote actions require their existing exact release plans and receipts. The
candidate is scoped to the declared Adelaide live-public reuse; it does not
touch production resources, social schedulers, booking, or Git remotes.

1. Verify the clean candidate commit and D1 ledger checksum. Back up staging D1
   and apply only `0067_creator_portfolio_releases.sql` through the bounded D1
   runner. Confirm its tables, trigger, index and migration receipt.
2. Apply `config/service-auth-portfolio-capability-patch.staging.json` to the
   existing Adelaide web service principal. This grants only
   `adult.portfolio.publish` and `adult.portfolio.withdraw`; no token or secret
   write is required.
3. Release `thot-os-public-links-control-staging` with its existing private
   service endpoint, new Workflows, and read access to the existing private
   preview and Library R2 buckets. Confirm no public route was added.
4. Release `thot-os-staging` web. Its publish UI and classification guard require
   migration 0067. Confirm creator and viewer roles and an empty/unpublished
   Portfolio state.
5. Release `thot-os-adult-gateway-staging` only after its exact plan names
   `more.thathuboverthere.com`. Confirm the age gate and absence of a live
   Portfolio before any creator approval. A creator must then complete and
   explicitly approve a real selection; this code release does not publish any
   existing private draft or media automatically.
6. Verify a complete approved card on the live age-gated domain: thumbnail,
   MP4 range playback, creator labels, full-length contact choice,
   second-creator denial, unaged denial, and withdrawal of a fresh request.
   Keep the release receipt and checks with the deployment record.

If the gateway release must be rolled back, withdraw the current KV projection
first so an older gateway cannot show stale media. D1 migration 0067 is additive;
rollback does not require deleting private draft or release history. Any newly
copied adult preview objects remain isolated until withdrawal or cleanup.

## Local evidence and limits

Gateway and control package suites pass locally; THOT OS lint/build and focused
Portfolio tests pass. A generated one-second H.264 MP4 passes the timeline
validator. No creator session or live provider was used. Actual Adelaide release
still needs a selected teaser, thumbnail, recorded rights/consent and an explicit
creator approval; the code cannot infer those facts from a Library item.
