# That Hub portfolio local preview

Status: synthetic local fixture, 19 October 2026. This is a bounded design and
route proof for the existing That Hub profile handoff. It is not published to
staging or production.

## What is wired locally

The live [Adelaide profile](https://www.thathuboverthere.com/adelaide) has a
**More from Adelaide Suede** action. Public-links redirects its safe
`/adelaide/more` route to the existing age-gated Worker at
`more.thathuboverthere.com`. The local portfolio renderer is injected into that
Worker only by the fixture runner. Its deployed default still renders the
existing protected profile without a Portfolio. There is no new live binding,
media route, or release configuration.

The fixture demonstrates a collapsed **Want a sneak peek?** section, a small
section/genre taxonomy, responsive synthetic image and video cards, native
video controls, a local custom-request form, and a creator-side manager for
selection, order, preview, explicit publish and withdrawal. The media is
generated locally. It contains no Library originals, creator sessions, R2
keys, private URLs, payments or entitlements. The preview server listens only
on `127.0.0.1` and simulates age entry for synthetic content; that shortcut is
not part of the Worker.

Start from the repository root:

```sh
node --experimental-strip-types cloudflare/thot-os-adult-gateway/tests/portfolio-preview.mjs
```

Open `http://127.0.0.1:8790/`, then use **View protected portfolio** or
**Creator manager**. The local runner requires `ffmpeg` to generate a short
test-pattern MP4 in memory. Its state resets when the process stops. The
custom request is kept only in memory; it sends no message.

Focused tests:

```sh
npm --prefix cloudflare/thot-os-adult-gateway test
npm --prefix cloudflare/thot-os-adult-gateway run check
```

## Remaining delivery work

This fixture is not a publish pipeline. A release needs creator-scoped D1
selection and approval state, current rights/consent verification, a separate
approved preview derivative (or authorized public Stream identity), protected
media delivery with withdrawal/revocation, and a private custom-request inbox
with rate limits and Turnstile. The manager needs real Access identity and
creator membership checks. It must not expose verified Library originals to
visitors. Staging needs route/binding and age-gate tests before deployment.
Payment confirmation, paid downloads, and revenue reconciliation are separate
follow-on work.
