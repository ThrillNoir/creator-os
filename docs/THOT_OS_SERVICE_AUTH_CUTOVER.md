# Service authentication cutover

## Decision

Phase 2A.3 uses **expand → verify → compatibility → verify → activate → cutover → contract**. It
does not mutate staging, provision a secret, or deploy a Worker. The aborted
Phase 2A.1 release proved that replacing `identity_audit_service_scope` in the
same migration as new principal tables was an unsafe cutover.

| Component | Observed staging authentication | Canonical authentication | Compatibility |
| --- | --- | --- | --- |
| OpenNext | Pre-canonical Worker; legacy secret inventory only | Holds distinct outbound bearer secrets for each receiver and sends a capability header | Deploy only after expanded D1 and receiver compatibility are verified |
| Instagram / Reddit / Telegram | Historical service-binding requests did not provide a canonical bearer | Exact named principal, SHA-256 credential, creator grant, and route capability | No bearerless fallback: it cannot prove caller identity |
| Vault Bridge | Historical shared catalogue token | `thot-os-web-vault-catalogue` with `vault.catalogue.refresh` | Legacy Vault token remains untouched until contract |
| Identity audit | `service_credentials` plus `service_creator_grants` | `service_principals`, credentials, and capability grants | Migration 0032 accepts either scoped branch; neither has global creator access |

The canonical request chain is: OpenNext service binding → one Web-only bearer
secret → receiver SHA-256 lookup → named active principal → active creator and
capability grant → route action → scoped audit record. Each principal is
distinct. Receiver Workers do **not** receive copies of their
caller bearer: the Web Worker is the sole sender and is the correct secret
target in this architecture.

## Migration policy

The historical Phase 2A EXPAND attempt submitted `0028_migration_ledger.sql`.
Its local Wrangler result was ambiguous, but canonical D1 history confirms
that `0028` is applied. Subsequent reviewed EXPAND releases applied
`0029`–`0031`, and the reviewed COMPATIBILITY release applied
`0032_service_auth_compatibility.sql`; canonical staging history is contiguous
through `0032`. None of `0028`–`0031` touches
`identity_audit_service_scope`. `0032` recreates the SQLite audit trigger with
the legacy and canonical scoped branches. It is a compatibility release, not
an expand or contract release. These migrations must not be replayed, removed,
or manually changed in `d1_migrations`; the next separately approved action is
canonical service-auth activation, not another migration attempt.

Legacy tables, secret names, and legacy trigger acceptance must not be removed
in this phase. A later contract migration requires every canonical Worker to
be deployed, protected QA to pass, a documented zero legacy-usage window, and
rollback no longer depending on legacy authentication.

## Activation workflow

`npm run services:activate -- --environment staging --activation config/service-auth-activation.staging.json --plan`
is read-only and default-safe. It uses the repository-owned structured D1 REST
reader with the scoped D1-read credential held only in the approved OS secure
store item (macOS Keychain or Linux Secret Service). The Linux runner requires
`secret-tool` and an item with service `thot-os-release-d1-read` and account
`thot-os-release`; the release tool never accepts a D1 token from its environment.
Pinned Wrangler 4.125.0 probes `secret-tool --version`, which Ubuntu's
`libsecret-tools` does not support. The checked-in Linux compatibility command
answers only that probe and passes every other operation to `/usr/bin/secret-tool`;
the release subprocess environment puts it on Wrangler's `PATH`.
It verifies the registered staging D1 UUID/name, reads its
ordered migration list, and reads only the deterministic activation run,
canonical-principal, credential-status, grant-status, and audit-event state.
It emits a redacted exact plan and reports independent `partialExpandReady`,
`expandReady`, `compatibilityReady`, and `activationReady` states. A plan with
an already-complete activation fails closed as
`ACTIVATION_ALREADY_SATISFIED`; any partial or unexpected canonical state fails
closed as `ACTIVATION_STATE_CONFLICT`, while a prior recovery remains blocked
as `ACTIVATION_ALREADY_REVOKED`. Tokens, credential hashes, audit details, and raw
API responses are never included in plans or receipts.

An eventual `--apply` has to fail closed unless its approved plan, confirmation
token, clean Git SHA and branch, staging registry/D1 ID, exact EXPAND **and**
COMPATIBILITY migrations, fresh structured D1 `ABSENT` state, and a fresh
activation-bound backup receipt all agree. The backup is produced only from an
approved plan with:

```sh
npm run services:activation-backup -- \
  --environment staging \
  --approved-plan /absolute/secure/path/activation.plan.json \
  --output-dir "/absolute/secure/non-repository/activation-backups"
```

It invokes only a read-only remote D1 export through the isolated Wrangler
OS keyring/OAuth boundary, parses the export locally only to verify its ordered
migration history, and deletes that temporary parse copy. The retained SQL
export and its `0600` receipt remain in the user-owned `0700` external backup
directory, never in the repository. The receipt binds its raw-byte SHA-256,
freshness, target identity, activation ID, plan digest, Git identity, and exact
migration history. `--apply` rechecks the receipt and the raw export bytes; a
historical, stale, altered, insecure, or differently bound receipt is refused.

Its state record is append-only:
`PLANNED`, `SECRET_STAGED`, `D1_ACTIVE`, `VERIFIED`, `ACTIVE`, or a
failure/rollback state. Plain bearers are generated only at the approved
operation, supplied to Wrangler by stdin, stored only as Cloudflare Web Worker
secrets, and represented in D1 only by SHA-256 hashes. Mutation and metadata
Wrangler children strip inherited `CLOUDFLARE_*`, `CF_*`, and `WRANGLER_*`
variables, then use only the reviewed OS keyring/OAuth boundary. Each attempt
generates a fresh receipt-only release-attempt ID. Receipts record names,
counts, version/deployment metadata, backup and plan references, and
results—never bearer values or hashes.

`--status` is a separate read-only diagnostic: it reports the same structured
D1 state together with Worker version, deployment, and secret-name metadata.
Worker secret metadata is read through `versions view --json` for the newest
listed version, not the unstable `versions secret list --latest-version`
command. It does not create a version or change traffic. `--revoke` is not an alias for
plan or apply: it requires a plan showing the current activation run and a
separate `REVOKE:<activation-id>:<plan-sha-prefix>` confirmation derived from
that exact plan, plus an output receipt path.

Cloudflare cannot transactionally combine D1 with Worker secret/version
changes. The future release order is: fresh backup; additive migrations; plan;
capture the latest Worker-version, secret-name, and deployment metadata; stage
a compatible Web version containing the approved receiver secrets without traffic; require a
fresh zero-traffic version and unchanged deployment metadata; atomically
activate D1 principals/hashes/grants; deploy compatible receivers; route Web
traffic; protected no-op authorization probes; then record receipt. If D1
activation fails, do not route traffic to the staged version. If a post-deploy
probe fails, roll Workers back first, then use the explicit confirmed
`--revoke` recovery path to revoke canonical credentials and append a rollback
receipt. Recovery re-reads structured D1 state after the deterministic revoke
SQL and accepts only `REVOKED`; it never changes Worker traffic or legacy
authentication.

## Proof and telemetry

The EXPAND release uses a non-provisioning structural proof: capture the
normalized `sqlite_master` SQL and SHA-256 digest for
`identity_audit_service_scope` before the release and require exact equality
after `0028`–`0031`. Local migration fixtures also prove the granted legacy
case remains accepted and wrong-creator/revoked cases remain rejected. This
proves D1 migration non-interference and deterministic trigger semantics; it
does **not** prove live staging authenticated legacy traffic. Staging currently
has no legacy credentials or grants, and none may be created merely for a
smoke test.

No-op receiver probes must prove: valid allowed request; wrong creator denied;
missing capability denied; invalid credential denied; and revoked credential
denied. They must never publish, send a message, or alter creator content.
Canonical audit details include `authPath: canonical`; migration `0031` also
provides an append-only `service_auth_telemetry` table. The existing deployed
bearerless routes cannot be safely identified as a legacy caller, so they are
not accepted by canonical receivers merely for telemetry. That is intentional:
the overlap is schema/audit compatibility plus controlled deployment ordering,
not an indefinite insecure dual HTTP path.
