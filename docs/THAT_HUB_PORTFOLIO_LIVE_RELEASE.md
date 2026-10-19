# That Hub portfolio live release target

Status: source assessment, 19 October 2026. The creator portfolio has **not**
been deployed. The current implementation is a synthetic local fixture.

## Destination

- Proposed creator destination: creators manage their selected previews at
  `https://www.thathuboverthere.com/dashboard/portfolio`, behind a path-scoped
  Cloudflare Access application and a server-side creator membership check.
  This is a narrow That Hub creator tool, not the THOT OS operations dashboard.
- Proposed visitor destination: published previews appear on the existing age-gated
  `https://more.thathuboverthere.com/<creator-slug>` page. The safe
  `https://www.thathuboverthere.com/<creator-slug>/more` route already hands off
  to that page. Neither the safe profile nor an unauthenticated request exposes
  the previews.
- The Workers currently named `*-staging` serve those live That Hub domains.
  The separately named production public-links Worker is route-less. Release
  plans must name the actual domains and Workers, not infer audience from the
  Worker name.

## What is ready

The local fixture proves layout, filtering, native preview playback, selection,
ordering, explicit publish/withdraw, two-creator isolation in fixture state,
and preparation of a Telegram or email message for a full-length clip. The
deployed adult gateway has no portfolio loader or publisher. The fixture media
paths are local-only and its media server exists only on `127.0.0.1`.
Redeploying the current Worker would not publish the portfolio.
The current public-links control registry also limits adult-profile publication
to the synthetic `adelaide` creator ID; it does not authorize a general creator
portfolio launch.

## Smallest useful live slice

1. Give the creator manager authenticated, creator-scoped selection and
   publish/withdraw state in D1. Resolve creator identity from a verified Access
   token and active membership; never accept creator ID from a form field.
2. Link each chosen preview to its full private asset **inside the control
   plane**. Validate same-creator ownership, rights, consent for anyone shown,
   and an explicit approval for this adult public preview. The existing
   `teaser_for_asset_id` column is only a starting point; application code does
   not yet use it.
3. Publish an allowlisted projection plus approved preview derivatives into
   isolated adult delivery storage. The adult gateway reads only that
   projection and serves only those derivatives after a valid age session.
   Withdrawal or revoked consent must prevent a new origin fetch. No original
   Library URL, authoring R2 key, or full asset ID enters public HTML.
4. Configure a creator-approved Telegram username or email address for the
   full-length message draft. The visitor reviews and sends it in their own
   app. The direct-contact feature needs no THOT OS inbox, payment flow, or
   download entitlement. The separate local custom-request form must be
   omitted until it has a real private delivery path.
5. Extend the publication policy deliberately for real creator accounts only
   after the preceding checks are enforced. Keep the existing SFW profile and
   adult portfolio projections separate.

## Release checks

Test an authorized creator and a second creator, missing/invalid Access token,
viewer role, wrong creator asset, absent consent, withdrawn preview, stale
profile version, absent media object, and missing contact destination with
local fixtures first. Verify the real route denies an unauthenticated manager
and an unaged visitor. Confirm an approved preview plays, its full original
cannot be fetched from public routes, and withdrawal blocks a fresh request.
Run package checks plus repository `npm run lint` and `npm run build` after code
changes. Review the exact route, bindings, media-copy behavior, and rollback
before replacing traffic on the live That Hub domains.

No live deploy is safe from this fixture alone: the Access route, D1-backed
creator manager, approved derivative publication/delivery, and real creator
contact destination are absent; the current publication policy is synthetic
only. This is an implementation inventory, not a new approval requirement.
