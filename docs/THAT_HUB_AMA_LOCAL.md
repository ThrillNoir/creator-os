# That Hub AMA local slice

Status: local synthetic proof, 19 October 2026. That Hub's public source lives in
this repository because `cloudflare/thot-os-public-links` serves the live
`www.thathuboverthere.com` creator profile. No real question, creator session,
Cloudflare resource, migration or route has been changed.

## Local journey

1. A visitor opens `/<slug>/ama`, sees published question-and-answer cards, and
   submits an anonymous question. The public Worker checks the active approved
   profile, same-origin form, 8 KiB body, 800-character question, acknowledgement,
   empty honeypot, a rate-limit binding and a Turnstile token. Its service binding
   forwards only allowlisted fields to the AMA Worker. The AMA Worker verifies
   the single-use Turnstile token server-side and inserts the question under the
   D1-resolved creator ID. A question never appears publicly on submission.
2. The Access-protected `dashboard/ama` inbox verifies the signed JWT and one
   active creator membership. A viewer is read only. A creator saves immutable
   private answer revisions, sees a finished-card preview, and explicitly
   publishes an SFW pair. A stale preview cannot overwrite a newer action.
3. The public Worker reads an allowlisted projection from the AMA Worker over a
   service binding on each uncached origin request. The AMA Worker derives the
   current card set from ordered D1 publish/withdraw events. There is no AMA KV
   writer or public D1 binding. Withdrawal removes a card from the next origin
   read; old browser pages, in-flight responses and copies cannot be recalled.

The local fixture includes a synthetic, single-use challenge in place of a
real Turnstile browser call. `tests/schema.sql` is a fixture, **not** an applied
D1 migration. The AMA Worker has no Wrangler deployment configuration and is
not routable as-is. The public Worker's AMA paths fail closed without the
planned service binding; its existing live profile behaviour is unchanged.

## Verify locally

```sh
npm --prefix cloudflare/thot-os-public-links test
npm --prefix cloudflare/thot-os-public-links run check
npm --prefix cloudflare/that-hub-ama test
npm --prefix cloudflare/that-hub-ama run check
npm run lint
npm run build
```

Run `node --experimental-strip-types cloudflare/that-hub-ama/tests/preview.mjs`
and open `http://127.0.0.1:8789/adelaide`,
`http://127.0.0.1:8789/adelaide/ama` and
`http://127.0.0.1:8789/dashboard/ama`. The preview uses an in-memory D1 fixture,
a local Access test key and synthetic Q&A. One public question can be sent per
preview restart because the local challenge token is deliberately single-use.

The fixture tests cover an anonymous question reaching only its creator, replay,
rate and boundary failures, private draft isolation, explicit publish, stale
publish rejection, withdrawal, and active-profile revocation. Mobile and desktop
screenshots and an actual local HTTP submission-to-withdrawal journey were also
checked. These are local proofs, not a live Access, Turnstile or D1 integration.

Release prerequisites and rollback order are in
[`THAT_HUB_AMA_STAGING_PLAN.md`](THAT_HUB_AMA_STAGING_PLAN.md).
