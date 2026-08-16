# Bounded D1 migrations

`wrangler d1 migrations apply` always applies every pending migration in its configured directory. It cannot safely perform the Phase 2A EXPAND release because `0032_service_auth_compatibility.sql` is intentionally pending after the safe EXPAND boundary.

The repository-owned executor applies an explicit inclusive range while preserving Cloudflare's canonical `d1_migrations` table. It sends one selected migration at a time as the same unit Wrangler uses: the exact SQL file contents followed by `INSERT INTO "d1_migrations" (name) VALUES ('<filename>')`. After each command it reads the table in `id` order and requires the exact expected prefix.

## Safety contract

- Only the registry allow-listed staging D1 can be addressed. Production is hard-disabled.
- Plan mode uses only `wrangler d1 info` and a `SELECT` from `d1_migrations`; it never uses `wrangler d1 migrations list`, because that command may initialize bookkeeping.
- The repository-pinned Wrangler binary is used, with the account, database name, UUID, and canonical Web DB binding required to agree.
- The migration directory must be a contiguous, unique, valid filename sequence. A reviewed plan records every selected SHA-256 digest, the exact prior migration history, Git SHA/branch, and the later pending files that are deliberately excluded.
- Apply requires a clean tree at the reviewed Git identity, an unchanged plan digest and explicit `bounded:<digest-prefix>` confirmation, matching current D1 history/source files, and a fresh checksum-validated read-only export receipt from `npm run migration:export-target`.
- Each selected migration is executed in a restrictive temporary file and then deleted. Repository migration files are never moved, hidden, copied into the configured directory, or altered.
- On failure, execution stops immediately. Earlier successfully applied migrations remain applied; the failing unit follows D1 file-execution rollback semantics. The receipt records the verified post-state. Resume is only a new reviewed plan from that exact partial state with a new backup.

The executor has no service-auth, credential, Worker, traffic, principal, grant, or secret logic. Release-specific checks remain external reviewed gates.

## Phase 2A EXPAND example

After a fresh approved read-only export while staging is exactly at `0027`, create a plan outside the repository:

```sh
npm run d1:migrations:plan -- \
  --environment staging \
  --release-id phase2a-expand-20260816 \
  --from 0028 \
  --through 0031 \
  --output /absolute/safe-location/phase2a-expand.plan.json
```

The plan must show `0028`–`0031` selected and `0032_service_auth_compatibility.sql` in `excludedPending`. Review its digests, database identity, pre-state, and confirmation string. A later authorized operator can use:

```sh
npm run d1:migrations:apply -- \
  --apply \
  --approved-plan /absolute/safe-location/phase2a-expand.plan.json \
  --backup-receipt /absolute/safe-location/staging.sql.receipt.json \
  --confirmation bounded:<reviewed-prefix> \
  --receipt /absolute/safe-location/phase2a-expand.apply.json
```

This is intentionally not executed as part of local development. The JSON receipt and a redacted Markdown sibling are evidence artifacts; neither contains secrets, token values, credential hashes, raw export data, or migration SQL.

## Boundary proof and later compatibility

The EXPAND release finishes at `0031`. The trigger replacement in `0032` remains excluded and requires its own reviewed compatibility release. Existing local boundary tests prove `identity_audit_service_scope` has an identical normalized SQL definition before and after `0031`; no bounded executor result substitutes for the separate release validation and protected application smoke checks.
