# Growth insights measurement contract

The Stage 3 Growth Insights page is a private, creator-scoped read model. It helps a creator or authorised agency member decide what to review next; it never initiates a public platform action.

## Included evidence

- Latest observation for each Instagram media ID from `instagram_media_metric_observations`.
- Only rows whose `source` is `instagram_api` are used. Creator imports and unknown sources are excluded from the comparison.
- Each recommendation records the observation timestamp, metric sample, confidence, a recheck date, and the observed media permalink when the provider supplied one. That permalink is the source URL for the individual evidence item.
- Every manual or scheduled analytics collection receives a creator-scoped receipt in `instagram_analytics_collection_runs`. Failed or abandoned reads are retried by the bounded cron selector after a 15-minute backoff; publishing runs and message syncs are separate ledgers.

## Metric definition and guardrails

Weighted engagement rate is `(likes + 2 × comments + 3 × saves + 3 × shares) ÷ views`.

The rate is unavailable unless the official API returned a non-negative value for every component. Missing values are not converted to zero. The system requires at least six complete media items before comparing formats and at least three items in a format before considering it a repeatable format sample. A format must be at least 15% above the creator's complete-sample baseline before it is shown as a possible signal. These are measurement guardrails, not growth targets or a promise of future performance.

Confidence is based on complete official media count: fewer than 6 is insufficient, 6–11 is early, 12–23 is building, and 24 or more is strong. Evidence older than 14 days is flagged for a manual refresh. Recommendations recheck seven days after the latest observation.

## Action boundary

The page and `GET /api/growth/insights` endpoint are read-only. They do not like, comment, follow, message, create, schedule, approve, publish, or alter any public profile. A recommendation can only be considered by a human in the existing approval workflow.

Link-in-bio clicks and verified downstream conversion receipts remain separate evidence streams. They are not attributed to an Instagram media item unless a future, explicit, privacy-reviewed attribution contract records that linkage.

## Refresh and public-link collection

The private **Refresh official analytics** control calls only the verified Instagram analytics endpoint. It does not inspect messages, alter the account, follow, like, comment, create content, schedule, approve, or publish. The one-minute scheduler selects at most one creator for analytics collection at a time; the normal six-hour freshness interval is retained unless a human explicitly requests a manual refresh.

The isolated public link Worker records only aggregate `profile_view` and `link_click` event counts in Analytics Engine. The public creator slug is the tenant index. It intentionally records no visitor ID, IP address, user agent, referrer, or destination URL beyond the already-approved destination host. Analytics Engine data stays separate from Instagram evidence and from any future conversion attribution contract.
