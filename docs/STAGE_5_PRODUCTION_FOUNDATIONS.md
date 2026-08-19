# Stage 5 production foundations

Status: foundation release completed on 2026-08-19. Production remains
**not launched**: it has no custom domain, workers.dev target, private control
Worker, Cloudflare Access application, creator data, public profile, provider
credential, social job, or Dropbox operation.

## What was provisioned

- The production D1 database was created in Cloudflare's Oceania region and
  bootstrapped from the generated schema-only baseline through `0039`.
  The post-apply receipt records `PRAGMA quick_check = ok`, 39 D1 migration
  records, and zero creator rows.
- `thot-os-media-production` and `thot-os-previews-production` are separate,
  empty private R2 buckets. No source media was copied from Dropbox.
- `thot-os-public-links-production` is a separate, empty KV namespace.
- `thot-os-public-links-production` is deployed with a distinct Analytics
  Engine dataset. It binds only Static Assets, that KV namespace, and the
  dataset; it has no D1, private R2, secret, or service binding.
- The Worker has `workers_dev: false`, no `routes` declaration and Cloudflare
  reported zero deployment targets. It cannot serve a creator route until a
  later approved custom-domain release.

## Recovery evidence

The first bootstrap attempt stopped before applying application schema because
the generated baseline included a Cloudflare-reserved `_cf_*` metadata table.
The D1 reconciliation showed only Cloudflare's own internal table and no
application tables. The baseline generator now excludes internal tables; the
second checksum-bound bootstrap completed and retained before/after exports.
No creator or operational row was created during either attempt.

Release receipts are outside the repository at
`/Users/thotos/THOT-OS-PHASE2A-RELEASES/production-foundation-2026-08-19/`.
They include the staging `0039` backup/plan/apply records, both D1 bootstrap
attempt directories, and the route-less Worker deployment receipt.

## Still blocked by design

1. Select a public link-in-bio domain and obtain written content/destination
   compatibility confirmation for the social platforms in scope.
2. Create the private production control/Web deployment with a dedicated
   Cloudflare Access application and a fail-closed allowed-identity policy.
   Staging URLs, audience values, QA flags and service secrets must not be
   copied into it.
3. Attach the selected custom domain only after the public Worker binding
   inventory is rechecked; then configure WAF, rate limits, security headers
   and public smoke tests against that exact domain.
4. Define the production service-principal and secret-release process before
   deploying any scheduler, vault, social or control Worker. Provider reads
   and social actions remain disabled.
5. Obtain explicit human approval for the first creator, immutable public
   profile version, every public destination, and the publication moment.

The production Worker version and schema baseline recorded in the receipt are
the initial rollback references. A later Worker rollback must still be checked
against the then-current D1 schema; Worker rollback never restores database
contents.
