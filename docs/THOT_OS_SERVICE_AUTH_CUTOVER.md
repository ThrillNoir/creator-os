# Service authentication cutover

## Decision

Phase 2A.2 uses **expand → activate → verify → deploy → contract later**. It
does not mutate staging, provision a secret, or deploy a Worker. The aborted
Phase 2A.1 release proved that replacing `identity_audit_service_scope` in the
same migration as new principal tables was an unsafe cutover.

| Component | Observed staging authentication | Canonical authentication | Compatibility |
| --- | --- | --- | --- |
| OpenNext | Pre-canonical Worker; legacy secret inventory only | Holds four distinct outbound bearer secrets and sends capability header | Deploy only after expanded D1 and receiver compatibility are verified |
| Instagram / Reddit / Telegram | Historical service-binding requests did not provide a canonical bearer | Exact named principal, SHA-256 credential, creator grant, and route capability | No bearerless fallback: it cannot prove caller identity |
| Vault Bridge | Historical shared catalogue token | `thot-os-web-vault-catalogue` with `vault.catalogue.refresh` | Legacy Vault token remains untouched until contract |
| Identity audit | `service_credentials` plus `service_creator_grants` | `service_principals`, credentials, and capability grants | Migration 0031 accepts either scoped branch; neither has global creator access |

The canonical request chain is: OpenNext service binding → one Web-only bearer
secret → receiver SHA-256 lookup → named active principal → active creator and
capability grant → route action → scoped audit record. Each of the four
principals is distinct. Receiver Workers do **not** receive copies of their
caller bearer: the Web Worker is the sole sender and is the correct secret
target in this architecture.

## Migration policy

Remote staging was verified at `0001`–`0027` before this change. Migrations
`0028`–`0030` were never applied to a canonical remote, so amending local
`0029` is permitted and recorded here. It now creates only additive canonical
principal structures. `0030` is unchanged. `0031` adds activation records and
telemetry, then recreates the SQLite audit trigger with two exact scoped
branches: the original legacy branch and the canonical branch. This is a
behaviourally backwards-compatible compatibility change, not a contract.

Legacy tables, secret names, and legacy trigger acceptance must not be removed
in this phase. A later contract migration requires every canonical Worker to
be deployed, protected QA to pass, a documented zero legacy-usage window, and
rollback no longer depending on legacy authentication.

## Activation workflow

`npm run services:activate -- --environment staging --activation config/service-auth-activation.staging.json --plan`
is read-only and default-safe. It reads only the explicitly registered staging
D1 migration list and emits a redacted exact plan. It permits only the known
`0027` baseline (reported as blocked pending expansion) or the exact expanded
state through `0031`.

An eventual `--apply` has to fail closed unless its approved plan, confirmation
token, clean Git SHA and branch, staging registry/D1 ID, exact expanded
migrations, and a fresh matching backup receipt all agree. Its state record is
append-only: `PLANNED`, `SECRET_STAGED`, `D1_ACTIVE`, `VERIFIED`, `ACTIVE`,
or a failure/rollback state. Plain bearers are generated only at the approved
operation, stored only as Cloudflare Web Worker secrets, and represented in D1
only by SHA-256 hashes. Receipts record names, counts, grants, backup and plan
references, and results—never bearer values or hashes.

Cloudflare cannot transactionally combine D1 with Worker secret/version
changes. The future release order is: fresh backup; additive migrations; plan;
stage a compatible Web version containing the four secrets without traffic;
atomically activate D1 principals/hashes/grants; deploy compatible receivers;
route Web traffic; protected no-op authorization probes; then record receipt.
If D1 activation fails, do not route traffic to the staged version. If a
post-deploy probe fails, roll Workers back first, then revoke canonical
credentials and append a rollback receipt.

## Proof and telemetry

No-op receiver probes must prove: valid allowed request; wrong creator denied;
missing capability denied; invalid credential denied; and revoked credential
denied. They must never publish, send a message, or alter creator content.
Canonical audit details include `authPath: canonical`; migration `0031` also
provides an append-only `service_auth_telemetry` table. The existing deployed
bearerless routes cannot be safely identified as a legacy caller, so they are
not accepted by canonical receivers merely for telemetry. That is intentional:
the overlap is schema/audit compatibility plus controlled deployment ordering,
not an indefinite insecure dual HTTP path.
