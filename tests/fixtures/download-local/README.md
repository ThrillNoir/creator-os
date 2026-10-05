# Local download fixture

`local-integration.test.mjs` replays the repository migration history through
`0063_content_download_links.sql` into a temporary persisted Wrangler D1
database. It adds only synthetic creators, memberships, a verified video, and
an in-memory Miniflare R2 object.

Run it from the repository root:

```sh
node --experimental-strip-types --test --test-name-pattern='local migrated schema' cloudflare/thot-os-downloads/tests/local-integration.test.mjs
```

The test deletes its temporary D1 state after every run. It has no remote
bindings, credentials, or source media.
