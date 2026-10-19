# That Hub portfolio live release target

Status: source assessment, 19 October 2026. The creator portfolio has **not**
been deployed. The current implementation is a synthetic local fixture.

## Destination

- Creator management belongs in the existing authenticated THOT OS application
  at `https://thot-os-staging.thot-os.workers.dev/`. Add an **Add to portfolio**
  control to the creator's Library item, with a portfolio workspace in that
  application for categories, genres, order, preview, publish and withdrawal.
  Reuse its Access identity and creator membership checks. Do not create a
  That Hub `/dashboard/portfolio` route.
- Proposed visitor destination: published previews appear on the existing
  age-gated `https://more.thathuboverthere.com/<creator-slug>` page. The safe
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
fixture's categories and genres are fixed examples; creator-defined taxonomy
and Library controls have not been built. The deployed adult gateway has no
portfolio loader or publisher. The fixture media
paths are local-only and its media server exists only on `127.0.0.1`.
Redeploying the current Worker would not publish the portfolio.
The current public-links control registry also limits adult-profile publication
to the synthetic `adelaide` creator ID; it does not authorize a general creator
portfolio launch.

## Smallest useful live slice

1. Add **Add to portfolio** to the THOT OS Library item. Its toggle changes a
   private draft selection, not the live More page. Add a creator-scoped
   portfolio workspace in THOT OS where the creator defines categories and
   genres, applies them to selected items, orders them, previews the result,
   explicitly publishes, and withdraws. Store these definitions and states in
   D1 and use the existing Access identity and active creator membership;
   never accept creator ID from a form field. Viewer access stays read-only.
2. Link each chosen preview to its full private asset **inside the control
   plane**. Validate same-creator ownership, rights, consent for anyone shown,
   and an explicit approval for this adult public preview. The existing
   `teaser_for_asset_id` column is only a starting point; application code does
   not yet use it.
3. Publish the creator's category and genre labels, ordered cards and approved
   preview derivatives into an allowlisted projection and isolated adult
   delivery storage. The adult gateway reads only that projection and serves
   only those derivatives after a valid age session.
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
viewer role, cross-creator category/genre use, wrong creator asset, absent
consent, withdrawn preview, stale profile version, absent media object, and
missing contact destination with
local fixtures first. Verify the THOT OS manager denies an unauthenticated user
and the More page denies an unaged visitor. Confirm an approved preview plays,
its full original cannot be fetched from public routes, and withdrawal blocks a
fresh request.
Run package checks plus repository `npm run lint` and `npm run build` after code
changes. Review the exact route, bindings, media-copy behavior, and rollback
before replacing traffic on the live That Hub domains.

No live deploy is safe from this fixture alone: the THOT OS Library toggle,
D1-backed creator definitions and selection, approved derivative
publication/delivery, and real creator contact destination are absent; the
current publication policy is synthetic only. This is an implementation
inventory, not a new approval requirement.
