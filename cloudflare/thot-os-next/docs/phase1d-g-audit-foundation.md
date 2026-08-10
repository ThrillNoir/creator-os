# Phase 1D-G audit and staging fixture foundation

Migration `0019_actor_role_audit.sql` adds a required actor role to canonical
identity audit records. The existing columns keep their established semantics:

- `actor_email`: the verified human email, or `service:<service_name>` for a machine;
- `actor_role`: `agency_admin`, `operator`, `creator`, `viewer`, `service`, or the
  temporary audit-provenance value `legacy`;
- `creator_id`: the effective creator workspace;
- `event_type`: the action;
- `created_at`: the D1 timestamp.

Human audit rows are accepted only when the identity, role and creator match an
active membership. Service audit rows are accepted only when an active,
unexpired service credential has an active grant for the effective creator.

Legacy rows retain their IDs, actors, creator IDs, actions, details and
timestamps. Because historical roles were not recorded and mutable current
memberships or actor naming conventions cannot reconstruct them reliably, every
legacy row is classified as `legacy`. This is audit provenance, not an
authorization role, and it cannot appear in `creator_memberships` or grant any
permission.

The operational audit tables for classification, scheduling, community policy,
vault uploads and messaging also receive an `actor_role` snapshot. Historical
rows use the same `legacy` provenance value. Human writers bind the role derived
from `requireCreatorContext`; Cloudflare scheduled/service-bound Workers and
credential-authenticated bridge handlers bind `service`. Browser payloads never
select either value.

Migration 0019 is the expand step of an expand-contract rollout. Its
`actor_role` columns temporarily default to `legacy` so the currently deployed
rollback application and Workers continue writing during the migration-to-code
interval. The new writers always bind the derived role explicitly, and source
tests enumerate every operational audit INSERT. A later numbered contract
migration may remove the compatibility defaults and reject omitted roles only
after all rollback versions also supply `actor_role`. Explicit `viewer` values
remain truthful snapshots of read-only memberships; viewers cannot perform
protected mutations.

After all new writers are deployed, record a UTC deployment timestamp and the
`MAX(rowid)` high-water mark for each of the six audit tables. Run controlled
human and service probes, allow scheduled Workers to execute, then verify every
row above those marks has an explicit non-legacy role. Any post-boundary
`legacy` row means a rollback writer is still active and blocks the contract
step. Store the timestamp, deployed commit and six table/rowid values in the
redacted deployment receipt; do not use event timestamps alone as the boundary.

The later numbered contract migration must:

1. rebuild each audit table without a compatibility default;
2. reject omitted roles for all new inserts;
3. exclude `legacy` from the permitted values for new rows; and
4. preserve existing historical `legacy` rows truthfully in immutable history,
   for example by archiving them before enforcing the contracted live schema.

The synthetic creator is deliberately not part of a numbered migration.
`fixtures/staging/phase1d-g-synthetic-creator.sql` is a tracked, idempotent,
staging-only fixture. It contains no QA email, accounts, media, messages,
connections or publishing authority. Apply it explicitly only to
`thot-os-staging` after the migration and Access-policy review.
