# That Hub Portfolio follow-on — source assessment

Status: local synthetic portfolio fixture added, 19 October 2026. No Cloudflare
resource, migration, or public route has been created.

## Recommended first slice

Add **Add to portfolio** to Library items in the authenticated THOT OS app at
`https://thot-os-staging.thot-os.workers.dev/`, with a creator-scoped Portfolio
workspace there. The creator defines categories and genres, applies them to
selected items, chooses display order, previews the public result, and
publishes or withdraws each item. The live
`https://www.thathuboverthere.com/adelaide` profile already has a **More from
Adelaide Suede** action. Its safe `/adelaide/more` route hands off to the
existing age-gated `more.thathuboverthere.com/adelaide` Worker. An unauthenticated
404 at that destination is expected: the adult profile requires a signed age
session. The local fixture places **“Want a sneak peek?”** inside that protected
page after the existing handoff. Render from a separate approved projection,
match the existing That Hub appearance, and use image
or short video-preview cards. Use restrained transitions, respect reduced-motion
preferences, and give each video native playback controls (play/pause, seek,
volume and fullscreen where supported), `preload="none"`, `playsinline`, and no
autoplay. Show only an approved public preview, never a private source URL.

Categories and genres are defined by each creator and appear as viewer-facing
filters on that creator's portfolio. The fixed labels in the local fixture are
examples, not the intended live taxonomy. Current Library filters for media
type, safety and destination are operational metadata, not public Portfolio
categories or genres. Existing authoring and public profile review flows are
useful for the select → preview → explicit publish journey.

The proposed “Don't see what you want? Request a custom” form should create a
creator-scoped private enquiry with a clear no-guarantee acknowledgement. A
later inbox can add accept, decline and quote states. No automatic payment or
fulfilment is implied.

The separate **Message creator for full length** action can hand the visitor
to a creator-approved Telegram chat or email draft with the clip reference
already filled in. That direct-contact flow does not require a THOT OS inbox.
The visitor sends the message in their own app; no payment or download is
granted by opening the draft.

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
correlation for an arbitrary pasted link. It remains a manual or assisted
confirmation path until a genuine notification and its fields are verified.
[Pay Online API](https://docs.connect.tyro.com/docs/online-payments/pay-online/overview)
is a separate integration that creates a Pay Request per order and supports
[signed webhooks](https://docs.connect.tyro.com/docs/getting-started/notification-events/webhooks)
or a server status lookup. A future implementation would verify the final
status and order attributes, handle duplicate or out-of-order events, and grant
an idempotent entitlement. Tyro requires a
[technical review before live use](https://docs.connect.tyro.com/docs/online-payments/pay-online/going-live/certification).

## Earnings reconciliation follow-on

Ben also wants THOT OS to record how much each creator made and reconcile the
agency share. The existing `0065_content_download_sales.sql` stores optional
sale amount/currency on a download link with audit events, while
`src/lib/finance.ts` holds agency split settings and proposals. Those are
starting points, not a verified payment ledger or an amount-due calculation.
A later sale ledger should retain provider/order reference, creator and asset,
currency, captured gross, actual fees when reported, refunds/chargebacks,
settlement status and a per-sale snapshot of the agreed split. Direct creator
settlement can remain the payment flow; reconciliation records the agency
amount owing rather than moving funds. Gross-versus-net fee basis remains an
owner decision.

Tyro's [Reporting API](https://docs.connect.tyro.com/docs/business-operations/reporting/overview)
may support later transaction and settlement reconciliation with merchant
authorisation. It is a pull reporting path, not instant purchase confirmation.
For Pay Online, a [`SUCCESS` state](https://docs.connect.tyro.com/docs/online-payments/pay-online/payment-scenarios/during-payment) may reflect authorisation or capture; any
future unlock must establish actual capture and amount. An authenticated
merchant payment email may be worth assessing as a bounded manual or assisted
path if a genuine redacted sample shows reliable transaction, buyer, asset and
amount correlation. Those fields and authenticity have not been verified.
No payment, email ingestion, entitlement or financial-record work is part of
this AMA slice.

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

Before a real release, decide which eligible adult previews are approved for the
age-gated page, including consent and rights for other people shown. A fixed
starter set of sections is used in the local fixture and can become
creator-defined later. Determine the verified Tyro payment flow before
promising pay-to-download. The local portfolio preview is documented in
`THAT_HUB_PORTFOLIO_LOCAL.md`.
