# That Hub Portfolio follow-on — source assessment

Status: read-only assessment, 19 October 2026. AMA delivery remains first. No
Portfolio code, Cloudflare resource, migration, or route has been created.

## Recommended first slice

Add a creator-scoped Portfolio manager beside the existing Library. The creator
explicitly selects **Add to portfolio**, chooses a section and display order,
previews the public result, and publishes or withdraws each item. The intended
public entry is **“Want a sneak peek?”** on the That Hub creator page, expanding
the portfolio at `https://more.thathuboverthere.com/adelaide`. A read-only HEAD
request on 19 October returned 404 for that address, so route ownership and the
public page need to be established before linking to it. Render from a separate
approved SFW projection, match the existing That Hub appearance, and use image
or short video-preview cards. Use restrained transitions, respect reduced-motion
preferences, and give each video native playback controls (play/pause, seek,
volume and fullscreen where supported), `preload="none"`, `playsinline`, and no
autoplay. Show only an approved public preview, never a private source URL.

Sections and genres need a small explicit viewer-facing taxonomy. Current
Library filters for media type, safety and destination are operational metadata,
not public Portfolio sections. Existing authoring and public profile review
flows are useful for the select → preview → explicit publish journey.

The proposed “Don't see what you want? Request a custom” form should create a
creator-scoped private enquiry with a clear no-guarantee acknowledgement. A
later inbox can add accept, decline and quote states. No automatic payment or
fulfilment is implied.

Each video may eventually offer a **Download full video** action after payment.
A creator-supplied payment URL by itself is insufficient to prove that a
particular buyer paid for a particular asset. Payment confirmation must come
from a verified provider event or status lookup with an order reference bound
to creator, asset, buyer, amount and currency. A server-side entitlement then
authorizes a short-lived download route. Never expose an original R2 URL in the
page or treat a visually hidden button as access control. Tyro integration
capability and the specific merchant product are still being assessed; no
payment or download implementation is authorized in this slice.

Tyro's [Portal Payment Links](https://help.tyro.com/s/article/Payment-Links-in-Tyro-Portal)
describe a manually managed paid status and notification email. The reviewed
Portal documentation does not establish an API event or buyer-to-asset
correlation for an arbitrary pasted link. It should therefore remain a manual
confirmation path. [Pay Online API](https://docs.connect.tyro.com/docs/online-payments/pay-online/overview)
is a separate integration that creates a Pay Request per order and supports
[signed webhooks](https://docs.connect.tyro.com/docs/getting-started/notification-events/webhooks)
or a server status lookup. A future implementation would verify the final
status and order attributes, handle duplicate or out-of-order events, and grant
an idempotent entitlement. Tyro requires a
[technical review before live use](https://docs.connect.tyro.com/docs/online-payments/pay-online/going-live/certification).

## What source already does

- `cloudflare/thot-os-next/src/app/library/page.tsx` and `src/lib/library.ts`
  query the creator-scoped catalog; `src/components/asset-card.tsx` shows private
  image/video review surfaces and classification tags.
- `asset_classifications.teaser_for_asset_id` in migration
  `0001_adelaide_library.sql` can point a teaser to a full asset, and migration
  `0033_tenant_integrity_and_quarantine.sql` guards same-creator ownership.
  **No current UI or application query reads or writes this relationship.**
  The “Has teaser” flag is not the relationship.
- `verified-video-preview.tsx` and the private video download route play the
  full verified original for an authenticated creator. Stream playback tokens
  are also creator-authenticated. These are not short public teaser delivery.
- `cloudflare/thot-os-public-media/src/index.ts` serves approved profile WebP
  derivatives only. It has no public video path.
- The current public profile control plane projects approved data to public
  KV and supports withdrawal; it is a useful pattern, not a Portfolio publisher.
- Booking intake has origin, Turnstile, rate-limit and replay patterns, but no
  persistent custom-enquiry inbox or quote workflow. Provider `/messages` is a
  separate inbox.

## Required boundary

Store an explicit preview-asset-to-full-asset relationship and Portfolio opt-in.
The relationship may point to the private vault original **internally**; the
public player must resolve only an approved teaser derivative or separately
authorized public Stream identity. A request for full content can point to a
creator-managed destination or start a private enquiry. The existing expiring
original-download link is a bearer delivery action and should not be embedded
as a public player URL. Public selection also requires current consent and
rights checks for any other person shown; `safety='sfw'` alone is insufficient.
Withdrawing an item or revoking consent must remove public delivery.

Owner choices before implementation: confirm SFW-only public Portfolio v1 and
the policy for content with other people. A fixed starter set of sections is a
reasonable first version and can become creator-defined later. Determine the
verified Tyro payment flow before promising pay-to-download. AMA remains the
current delivery priority.
