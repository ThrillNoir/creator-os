# That Hub AMA — staging decision plan

Status: candidate plan only, 19 October 2026. No deployment, D1 migration,
Cloudflare binding, Access policy, secret or DNS change has been made for AMA.
This plan targets `www.thathuboverthere.com` and the existing public-links
Worker. The separate production public-links foundation remains route-less.

## Intended boundary

- Public: `/<creator-slug>/ama` GET/HEAD and `/<creator-slug>/ama/ask` POST on
  the public-links Worker. A current approved profile is required. The Worker
  has profile KV, an `AMA_SERVICE` binding, a rate-limit binding and a public
  Turnstile site key. It has no D1 or Turnstile secret.
- Private: `/dashboard/ama` and descendants on a narrow AMA Worker, behind a
  path-scoped Access application. The Worker verifies the Access JWT and active
  D1 membership again. Its internal projection/intake endpoints are reached
  only through the service binding at `https://ama.internal`; keep `workers.dev`
  disabled and do not route `/internal/ama/*` externally.
- D1 owns questions, answer revisions and ordered publication events. Public
  cards are queried from D1 through the AMA service on every uncached origin
  read. No public AMA KV projection is written. The public Worker validates the
  allowlisted projection and its current public-profile version before render.

## Staging sequence

1. Review the additive D1 migration translated from the local fixture against
   the actual staging schema, creator FK/role tables and migration history.
   Follow the repository's bounded remote migration plan, backup and receipt
   requirements. No media or existing questions are transformed.
2. Configure the AMA Worker with staging D1, the Access issuer/audience/JWKS,
   the exact public origin and Turnstile secret. Restrict external routes to the
   protected dashboard prefix; disable its `workers.dev` address. Verify Access
   covers the exact dashboard path and descendants, including assets. The
   public Worker must continue returning 404 for all `/dashboard` paths.
3. Add `AMA_SERVICE`, `AMA_RATE_LIMITER` and public Turnstile site key to the
   staging public-links Worker. Verify same-host POST origin, challenge failure,
   rate limit, missing binding, forged/expired Access token, viewer denial and
   two-creator isolation. Confirm the service binding cannot be called through
   an external `/internal/ama/*` route.
4. Publish a synthetic staging question and answer only with an approved
   staging fixture creator, then test draft, preview, explicit SFW publish,
   newer draft staying private, withdraw and stale-preview conflict. Check the
   public page at desktop and mobile widths. Check profile revocation and
   mismatched version both fail closed. Do not use a real creator session for
   this release check.
5. Prepare the repository's concrete staging release plan and receipts before
   traffic changes. Roll back the public Worker/bindings first if intake or
   public delivery fails; keep the D1 migration additive. If the private route
   fails, disable its exact route and Access exposure while retaining audit
   history. Do not infer approval from this document.

## Withdrawal behaviour to accept or change

Recommended v1: D1 is authoritative, AMA HTML uses `Cache-Control: no-store`,
and a committed withdraw event excludes the card on the next origin read. This
avoids Cloudflare KV's eventual write propagation for AMA cards. The local test
proves this sequence against an in-memory D1. Staging must verify D1 read
consistency and response caching on the actual route. A card already loaded in
a browser, an in-flight response, screenshot or external copy can remain
visible. The creator UI should say it is removed from new views, rather than
promise global erasure. If a stricter revocation guarantee is required, choose
and test a stronger delivery gate before launch.

Cloudflare references: [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/),
[Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
[rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[Access path policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).
