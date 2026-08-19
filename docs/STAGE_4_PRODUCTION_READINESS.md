# Stage 4 production-readiness record

Status: staged on 2026-08-19; the first post-deploy scheduled metric-coverage
receipt remains the final staging acceptance observation. Production is
intentionally unprovisioned and no real creator route, custom domain, Dropbox
object, social post, message, or account state is part of this stage.

## Staging deployment evidence

- `0038_instagram_analytics_metric_coverage.sql` is confirmed in
  `thot-os-staging` through the bounded migration runner.
- Instagram scheduler Worker version: `d5037e84-936f-4a9d-b477-607a29bd6803`.
- Private Web Worker version: `78b9c6b6-c96a-4851-a19b-a3ca7192d7d3`.
- The public, unauthenticated check is redirected by Cloudflare Access. The
  release shell did not enter an email or login code, so authenticated visual
  verification is intentionally pending a normal operator sign-in.
- Aggregate D1 checks after deployment show zero new social posts, messages,
  public-profile publications, analytics runs and analytics observations. The
  updated scheduler therefore has not caused an unapproved provider read.
- Bounded-plan, export, apply and deployment receipts are stored outside the
  repository at `/Users/thotos/THOT-OS-PHASE2A-RELEASES/staging-worker-rollout-2026-08-19/`.

## Measurement coverage finding

Observed on 2026-08-19 (staging D1 aggregate query; high confidence; recheck
after the first Stage 4 scheduled collection): 15 current official Instagram
media observations completed successfully, but all 15 lacked views, saves and
shares. Likes and comments were present. This is a provider-field coverage gap,
not evidence that any of those values are zero.

Migration `0038` adds per-run aggregate coverage counters. The scheduler now
makes a bounded, read-only per-media insight lookup for at most 25 media items,
with a concurrency limit of four. It persists any returned fields alongside the
original media result and leaves an unavailable field `NULL`. It does not
message, publish, follow, like, comment, change an account, or retrieve
Dropbox content.

The first post-deploy collection is the acceptance check for this integration:
inspect the retained collection receipt and the aggregate growth screen; do not
infer completeness from a successful collection status alone. If an eligible
metric remains absent, the existing weighted-growth contract continues to
exclude that media instead of silently changing the formula.

## Private launch gate

`/launch-readiness` and `/api/launch-readiness` are Access-protected,
creator-scoped, read-only staging views. They make these conditions explicit:

- unresolved tenant-integrity exceptions;
- external provider receipts in `uncertain` state;
- latest official analytics receipt and freshness;
- complete weighted-metric sample coverage;
- immutable public-profile approval/publication state; and
- the deliberate production-cutover block.

The page does not call a provider, deploy a Worker, publish a profile or change
data. A clear staging screen is evidence for a human release decision, not an
automatic production authorization.

## Monitoring and rollback

All staging Workers already enable invocation logs, custom logs and traces.
Stage 4 adds the structured `instagram_analytics_metric_coverage` event with
only aggregate counts. It deliberately contains no media ID, account ID,
handle, provider token, or content. Cloudflare documents that Workers Logs can
collect invocation, custom, error and exception logs, and recommends structured
JSON fields for filtering. Source: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
(observed 2026-08-19; high confidence; recheck before production).

For a future production release, record the active Worker version before every
traffic change and retain the prior stable version as the rollback target.
Cloudflare supports rolling a Worker back to a specified previous version, but
the platform does not roll back bindings or database schema with that action.
Source: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
(observed 2026-08-19; high confidence; recheck before production). Therefore
each production code rollback must be checked against the then-current D1
schema; migration `0038` is additive and remains compatible with the preceding
scheduler code.

## Staging release sequence

1. Regenerate and verify the schema-only production baseline after local replay.
2. Commit the reviewed change so the bounded D1 planner can enforce a clean
   source state.
3. Produce a fresh checksum-bound staging export, then plan and apply only
   `0038` through the bounded migration runner. Store all receipts outside the
   repository.
4. Deploy the Instagram scheduler after `0038` is confirmed, then deploy the
   private Web Worker. Do not deploy a public Worker for this stage.
5. Verify the private readiness route under Cloudflare Access and verify the
   unauthenticated request remains gated. Do not expose Access cookies or
   tokens in a receipt.
6. Let the pre-authorized scheduled analytics read run; inspect its aggregate
   receipt and logs. A manual refresh remains a human action in the private UI.
7. Confirm that no message, publish, profile or Dropbox operation occurred.

## Explicit production cutover prerequisites

This stage does not create any of these resources. Before the user explicitly
authorizes production, attach each item below to a new release record:

1. A selected public domain plus written destination/content compatibility
   confirmation for the social platforms in scope.
2. New isolated production D1, KV, R2 and Analytics Engine resources; never
   reuse staging identifiers.
3. A clean production schema-only baseline and a fresh production backup/
   migration plan, reviewed independently from staging.
4. Cloudflare Access policy and allowed identity confirmation for the private
   control Worker; public Worker bindings proving no D1 or private R2 access.
5. Custom-domain security headers, WAF/rate-limit rules and public smoke-test
   evidence.
6. A named previous Worker version, a tested public-profile withdrawal version,
   and a schema-compatible rollback procedure.
7. Explicit human approval of the first creator, profile version, every public
   destination, and the moment of publication.
