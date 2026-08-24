# THOT OS production D1 baseline

`schema.sql` is a generated, schema-only replay of the Cloudflare D1 migration
set. It deliberately contains no seeded creator, social account, post,
operator, consent, provider-connection, or credential data. It does include
the Cloudflare D1 migration history as schema provenance, so the next approved
migration starts after the baseline instead of replaying historical changes.

It is for provisioning a brand-new production database only. Never run it on
staging or an existing production database, and never edit historical
migrations to make the baseline look cleaner.

Regenerate and verify it with:

```sh
npm run d1:production-baseline:build
npm run d1:production-baseline:check
```

The production cutover must record the source migration checksums, a fresh
backup/export, the D1 identity, and the later migration-ledger state before
any Worker is deployed.
