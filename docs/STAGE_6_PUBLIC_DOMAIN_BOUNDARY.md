# Stage 6 That Hub public and AMA boundary

Status, 19 October 2026: `https://www.thathuboverthere.com/adelaide` is live
on the `thot-os-public-links-staging` Worker configured in this repository.
The separately named production public-links Worker is still route-less.
Ben selected a creator AMA dashboard on That Hub. No AMA Worker, Access route,
D1 migration, service binding, Turnstile key or rate limiter has been deployed.

| Surface | Address | Authority | Access |
| --- | --- | --- | --- |
| Public profile | `www.thathuboverthere.com/<slug>` | Approved SFW profile KV snapshot | Public |
| Public AMA | `www.thathuboverthere.com/<slug>/ama` and `/ama/ask` | Public Worker reads profile KV and calls the AMA service; no public D1 binding | Public; bounded form, Turnstile and rate limit on intake |
| Creator AMA inbox | `www.thathuboverthere.com/dashboard/ama` and descendants | Narrow AMA Worker, creator-scoped D1 | Path-scoped Cloudflare Access and server-side membership verification |

The That Hub public Worker source is co-located in the THOT OS repository. The
full THOT OS operations dashboard is not mounted here. The apex domain
currently redirects supported public paths to `www`; AMA uses `www` only.
`/dashboard` is reserved from public creator slugs, and the public Worker
returns 404 for its paths if the private route is absent.

In the local AMA candidate, the public Worker cannot read D1 or hold the
Turnstile secret. A service binding asks the separate AMA Worker for the
allowlisted public card set or to save a checked public question. The AMA
Worker resolves creator ownership from the active profile in D1; the caller
cannot select a creator ID. The dashboard additionally requires signed Access
JWT and one active membership. Viewers cannot answer or publish. Answer
revisions and publish/withdraw events are immutable, and only an explicitly
published SFW question-and-answer pair enters the public view.

AMA card delivery is D1-authoritative and `no-store` in the local candidate.
A committed withdraw event removes a card on the next origin read. Previously
loaded pages, in-flight responses and external copies may persist. This is a
practical v1 withdrawal behaviour to verify on staging; it is not a promise of
immediate global erasure. Profile KV remains separate, and the AMA route also
checks the current D1 profile and version before serving cards.

The exact staging configuration, migration checks, route isolation, Access
coverage, fixture acceptance and rollback are in
[`THAT_HUB_AMA_STAGING_PLAN.md`](THAT_HUB_AMA_STAGING_PLAN.md). This document
is a boundary description, not an approval to attach routes or deploy.
