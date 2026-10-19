# Stage 6 That Hub public and AMA boundary

Status, 19 October 2026: `https://www.thathuboverthere.com/adelaide` is live and
served by the `thot-os-public-links-staging` Worker configured in this repository.
The separately named **production** public-links Worker remains a route-less
foundation. The live `www` host and the production release stage are different
facts; do not infer one from the other. Ben selected a creator AMA dashboard on
That Hub, replacing the earlier rule that no private path could use this domain.
No private AMA route, Access application, D1 migration, public question intake,
or AMA projection writer has been deployed.

## Site surfaces

| Surface | Canonical address | Data and Worker | Access |
| --- | --- | --- | --- |
| Public creator profile and Q&A | `https://www.thathuboverthere.com/<creator-slug>` and `/<creator-slug>/ama` | Public-links Worker; approved SFW KV projections and aggregate link analytics only | Public |
| Planned creator AMA dashboard | `https://www.thathuboverthere.com/dashboard/ama` and descendants | Separate narrow AMA Worker; creator-scoped questions and answers in D1 | Path-scoped Cloudflare Access plus server-side JWT and active D1 membership checks |

That Hub's public Worker source is co-located in the THOT OS repository; it is
the Worker that owns the live site. The private AMA route is a That Hub creator
experience. The full THOT OS operations dashboard is not mounted on this host.
The apex `thathuboverthere.com` currently redirects supported public paths to
`www`; the AMA plan uses `www` consistently.

## Isolation rules

- The public-links Worker has no D1, private R2, Queue, service binding or
  secret. It reads only approved public projections and records aggregate
  profile/link events. It never receives new questions, drafts, unpublished
  answers, private media or dashboard identity.
- `/dashboard` and all descendants are reserved from creator slugs. If a
  private route is absent or misconfigured, the public Worker returns `404`
  without reading public KV.
- The private AMA Worker must verify Access and one active creator membership
  on every request. The caller cannot choose creator ownership by URL, cookie,
  device, or browser profile. Viewer accounts cannot answer or publish.
- Saving an answer creates only a private draft. Public cards contain the exact
  question and answer from an explicitly published SFW revision. A creator can
  withdraw a card while retaining the private question and revision history.
  The public projection must match the current profile slug and version.

## Release boundary

The local AMA work in `cloudflare/that-hub-ama` is a fixture-backed proof. It
has no Wrangler deployment configuration; its publication adapter and D1
schema are local test fixtures, not remote infrastructure. Before any staging
route, land a reviewed additive migration, a controlled projection writer
with ordered per-creator delivery, stale-generation rejection and retry
receipts, and a public question intake with abuse controls.
Cloudflare KV reads are eventually consistent, and this public route also
advertises a 60-second cache lifetime. Before release, agree on acceptable
withdrawal propagation and test it across regions. If immediate removal is a
requirement, a stronger-consistency public delivery check is needed.
Then configure a narrow AMA Worker and path-scoped Access application for the
exact `/dashboard` fallback, `/dashboard/ama` routes and private assets. Test
route precedence, Access redirects/session expiry, creator A versus B, viewer
denial, public fallback, projection withdrawal, and rollback. Staging or
production attachment requires a separate concrete guarded release plan.

Cloudflare's [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
[Worker Route](https://developers.cloudflare.com/workers/configuration/routing/routes/),
and [Access application path](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
behavior must be checked against the exact host and patterns before release.
