# That Hub AMA local slice

This is a local, synthetic demonstration of the That Hub AMA creator journey.
It belongs to `www.thathuboverthere.com`; its source lives in this repository
because `cloudflare/thot-os-public-links` already serves the live public
profile. No creator account, real question, or Cloudflare resource is used.

The public Worker now has a `/<slug>/ama` page. It reads only `public-profile`
and `public-ama` KV projections, checks that their creator slug and published
profile version agree, escapes question and answer text, and renders a
swipeable card collection with keyboard links. An approved ordinary profile
link can point to this page. Without a valid projection the route returns 404.

`cloudflare/that-hub-ama` is a separate, unrouted private Worker prototype.
It verifies Access JWTs and a single active creator membership; viewers are
read only. A creator can review a question, save an immutable private answer
revision, preview both sides of the finished card, explicitly publish a SFW
pair, and request withdrawal without deleting private history. A failed
projection write leaves the public update visibly pending for retry. The local
publisher fixture rejects stale generations before writing the allowlisted
public projection; the tests cover an out-of-order publish/withdraw race. The default
Worker has **no publisher** and returns 503 for a publish attempt.
`tests/schema.sql` is a local fixture, **not** an applied D1 migration. The
prototype has no Wrangler config and cannot be deployed as-is.

Local checks:

```sh
npm --prefix cloudflare/thot-os-public-links test
npm --prefix cloudflare/thot-os-public-links run check
npm --prefix cloudflare/that-hub-ama test
npm --prefix cloudflare/that-hub-ama run check
npm run lint
npm run build
```

For an interactive fixture preview, run
`node --experimental-strip-types cloudflare/that-hub-ama/tests/preview.mjs` and
open `http://127.0.0.1:8789/adelaide`,
`http://127.0.0.1:8789/adelaide/ama`, and
`http://127.0.0.1:8789/dashboard/ama`. The preview server creates a local
Access test key, an in-memory D1 fixture and synthetic cards. It rewrites only
the approved `/adelaide/ama` link to localhost for navigation.

Next delivery: public anonymous intake with bounded form, Turnstile/rate
limits, replay protection and creator-scoped D1 storage; a reviewed D1
migration; a controlled publication and withdrawal path with retry receipts;
then exact same-host routing and Access coverage. The real publisher must
serialize per-creator writes, reject stale generations and reconcile pending
delivery; KV alone cannot provide this guarantee. KV is also eventually
consistent across regions, so a successful write does not prove immediate
global removal. Public Q&A remains SFW under
the current public-links contract. Adult Q&A would require a separate product
decision and protected delivery surface.
