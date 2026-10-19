# THOT OS Portfolio — staging delivery plan

Status: local authoring candidate, 19 October 2026. No remote migration,
binding change, deployment, private creator session, or public media release
has been made. This plan targets the authenticated THOT OS staging app for
creator management and the existing age-gated More page for eventual visitors.

## Creator journey

1. In the THOT OS Library, **Add to portfolio** creates a private draft entry.
   It never publishes an asset. The Portfolio workspace lets the creator create
   and rename their own categories and genres, assign one category and optional
   genre to each item, set title and order, and choose a separate candidate
   H.264 MP4 for a full video's public preview. When the Library has exactly
   one verified teaser linked to the full asset, the editor suggests it for
   confirmation. A viewer can inspect the draft but cannot change it.
2. Show each item's missing requirements in the workspace. The selected MP4 is
   only a candidate until clip length, rights, consent, poster, and public
   derivative checks pass. The Library original and private playback URL stay
   private. An exact visitor-page preview must precede a distinct Publish
   button. Withdraw must stop fresh public delivery.
3. The published page at `https://more.thathuboverthere.com/<slug>` displays
   only approved cards, creator-defined category and genre filters, and
   session-bound preview media. Full-length enquiries prepare a creator-approved
   Telegram or email draft; they do not create payment or download access.

## Source completed locally

- Additive migration `0066_creator_portfolio_drafts.sql` creates creator-scoped
  private labels, items, and audit events. Composite foreign keys reject
  cross-creator asset, candidate video, category, and genre references.
- The THOT OS Library detail has the draft toggle. `/portfolio` manages labels
  and selected items. Existing Access identity and active creator membership
  are reused. `PORTFOLIO_AUTHORING_ENABLED` defaults to `0`, so the route and
  mutations remain closed until the staging D1 migration is applied and the
  flag is deliberately enabled. The Library offers Add only after the original
  reaches a verified native-media state.
- This slice has no Publish button or public side effect. The local More-page
  fixture still uses synthetic media and fixed example labels.

## Work remaining before the whole feature is staging-ready

1. **Approved media.** Add a poster chooser or upload for video previews and a
   metadata-stripped display derivative for images/posters. Before release,
   verify the candidate clip's actual duration, H.264/MP4 container, size,
   source identity, explicit creator approval, and rights/consent for anyone
   shown. Reject unavailable or changed inputs. No original source key enters
   a public projection.
2. **Publisher.** Add a separate versioned Portfolio publication in D1. The
   authenticated control Worker copies only verified derivatives into isolated
   adult R2 and writes an allowlisted adult KV snapshot; keep D1 as authority.
   Projection and media keys are bound to creator, publication version, and
   opaque public card ID. Recheck eligibility when publishing and withdrawing,
   not only when a draft is saved. A failure leaves the last published snapshot
   intact or the new snapshot absent, with a retryable receipt.
3. **Gateway.** Replace the fixture-only contract with creator-defined labels
   and version-bound card references. Read the separate Portfolio snapshot only
   after a valid age session and current adult-profile version check. Serve
   image/poster and MP4 bytes from isolated adult R2 with exact content type,
   object metadata/checksum validation, no-store headers, and bounded Range
   support for seeking. Resolve the full-length enquiry against the current
   published card and prepare the creator-approved Telegram or email draft;
   the local fixture's POST route is not deployed gateway behavior. Withdraw a
   card by removing its public projection before deleting its media copy; a
   stale browser page must not fetch it anew.
4. **Offline acceptance.** Test two creators, viewer denial, forged/stale Access
   identity, foreign labels/assets, changed source, missing poster, invalid
   duration/codec, changed or revoked consent, old profile version, tampered KV
   or R2 metadata, video seeking, category/genre escaping, replay, failed copy,
   and fresh GET after withdrawal. Run package tests, `npm run lint`, and
   `npm run build` on the final source.

## Staging and live boundary

The release order is:

1. Replay migration 0066 locally, then apply it to staging through the
   repository's bounded migration procedure. Deploy private authoring with the
   flag at `0`, confirm the staging app is healthy, then enable the flag and
   check an authorized creator and a read-only viewer. No public card appears.
2. Complete and review the publisher, approved derivatives, gateway delivery,
   and offline failure cases above. Test the complete journey with synthetic
   local media before any real creator selection.
3. Review the live-domain target separately. The adult gateway Worker named
   `thot-os-adult-gateway-staging` is bound to **live**
   `more.thathuboverthere.com`; its public release cannot be treated as an
   ordinary private staging web deploy. Verify its exact routes and bindings
   before release. Preserve existing D1 and media throughout.

No Git push, remote migration, or deploy is part of this local candidate.

## Small UX refinements worth keeping

- Show **Draft / Needs preview / Awaiting approval / Published** on Library
  items, with a direct **Finish setup** link. The toggle stays a private save.
- Default to one category and an optional genre, and keep unassigned items
  private. Renaming a label updates every attached card without retagging it.
- Filter the video chooser to usable candidates, and explain why an item is
  blocked. Offer a poster upload/chooser first; timeline scrubbing can follow
  once the public clip and frame-capture path are verified.

Proposed Yaps brief, limited to this feature: assess the shortest creator flow
from Library selection to choosing a short video candidate and poster; suggest
clear labels for private draft versus public release. Yaps does not write code
or alter the release boundary.
