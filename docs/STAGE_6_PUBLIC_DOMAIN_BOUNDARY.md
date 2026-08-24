# Stage 6 public-domain boundary

Status: `thathuboverthere.com` is an active Cloudflare zone in the THOT OS
account, but it remains unattached. This document defines the boundary before
any public route is created.

## Two different products

| Surface | Address | Worker/data | Access |
| --- | --- | --- | --- |
| Public creator link hub | `https://thathuboverthere.com/<creator-slug>` | `thot-os-public-links-production`; Static Assets, the public KV projection, and aggregate Analytics Engine events only | Public, no sign-in |
| THOT OS creator dashboard | A separately selected production hostname | A separately deployed private Web/control Worker with production D1 and private R2 only where needed | Dedicated Cloudflare Access application and fail-closed identity policy |

The second hostname is deliberately not selected or attached in this stage.
It must not be a hostname under `thathuboverthere.com`, and it must never be
routed to the public-links Worker.

## Enforced public-worker limits

- The public Worker has no D1, private R2, Queue, service binding, or secret.
  It cannot query a creator dashboard, operational account, message, library,
  approval record, consent record, private media, or Dropbox.
- It reads only an explicit, immutable approved public-profile projection from
  the dedicated production KV namespace.
- Its only analytics output is aggregate public profile-view and link-click
  counts in the dedicated Analytics Engine dataset; it records no visitor ID,
  IP address, user agent, referrer, or private dashboard event.
- Dashboard route names such as `/accounts`, `/growth`, `/messages`,
  `/settings`, and `/launch-readiness` are permanently reserved on the public
  link hub and return `404`, even if someone later attempts to use one as a
  creator slug.

## Later launch sequence

1. Keep `thathuboverthere.com` exclusive to the public `/<creator-slug>`
   shape. Attach it only to `thot-os-public-links-production` as a Cloudflare
   Custom Domain, never as a route for a private worker.
2. Build the private production dashboard as a separately named Worker and
   protect its separate hostname with a dedicated Access application before it
   receives any D1/R2 binding or production service secret.
3. Recheck both Worker binding inventories, configure the public WAF/rate
   limits, and run smoke tests proving that public paths cannot resolve private
   dashboard routes.
4. Publish a creator only after the creator, immutable public profile version,
   and every destination have explicit human approval.

Cloudflare Custom Domains require an active zone and Worker, point every path
of the chosen hostname at that Worker, and create the necessary DNS record and
certificate. This is why the public and private surfaces require separate
hostnames rather than path-sharing one Worker. Source: Cloudflare Custom
Domains documentation, observed 2026-08-19, high confidence; recheck before
deployment: <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>.
