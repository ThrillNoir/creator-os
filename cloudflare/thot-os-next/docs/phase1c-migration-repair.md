# Phase 1C migration 0018 repair

## Preserved staging failure

- Wrangler: `4.120.0`
- Command path: `wrangler d1 migrations apply thot-os-staging --remote`
- Pending migration: `0018_creator_identity_profiles.sql`
- D1 result: `incomplete input: SQLITE_ERROR [code: 7500]`
- Rollback verification: none of the 0018 tables, indexes, or triggers existed afterward, and 0018 remained absent from `d1_migrations`.

The failing input is preserved in `tests/fixtures/0018-nested-case-repro.sql`. SQL comments and single-quoted error messages are handled correctly by Wrangler's splitter. The first original trigger, `creator_memberships_identity_class_insert`, was the first statement containing two nested compound terminators: the inner `CASE ... END;` and the trigger's outer `BEGIN ... END;`. The remote D1 migration query stopped at the inner terminator and SQLite received an incomplete `CREATE TRIGGER`.

## Remediation

Migration number 0018 remains unchanged because it was never applied remotely. The two compound `CASE` triggers are replaced by four single-purpose triggers: creator/staff isolation for insert and update. Each trigger owns one auditable abort condition and has one `BEGIN ... END` block. Database enforcement, revocation constraints, creator/profile foreign keys, and audit storage are unchanged.

The automated tests use the repository-pinned Wrangler 4.120.0 binary and its `d1 migrations apply --local --persist-to` path for fresh replay, realistic 0017 upgrade, and transactional failure rollback.

## Staging migration receipt

- Database: `thot-os-staging` (`174532e8-5ada-4e30-abba-1276b3540b3f`)
- Pre-migration export: `.creator-os/backups/cloudflare/thot-os-staging-pre-0018-phase1c-20260810T105802Z.sql`
- Export size: `3,093,586` bytes
- Export SHA-256: `82130b335f8be059ffa9c33c705261a918d29026678196c2232b32d30e181ddf`
- Applied with Wrangler `4.120.0`: `0018_creator_identity_profiles.sql` (`20` commands)
- Migration record: exactly one; no migrations remain pending
- Resulting tracked schema: eight tables, three indexes, and four isolation triggers
- Seed: one active Adelaide `agency_admin` membership
- New operational rows: zero browser profiles, bridge credentials, and service credentials
- Adelaide before/after: one creator, 195 assets, five operational accounts, six social posts, and 45 message threads
- Exact Adelaide identifier fingerprint before/after: `cd493f6b89f1b525e2e0f6a2706e562e015517fda3fe9784f696471aacb3e5c5`
- Integrity: `PRAGMA quick_check` returned `ok`
- Deployment boundary: no Worker or application code was deployed
