# Instagram performance intelligence

Creator OS reads approved Instagram account data through the creator's verified Composio connection. It never edits or deletes Instagram content.

## Sync contents

- Up to 100 posts from the previous 365 days, with pagination.
- Publication timestamps, media type, permalink and available public counters.
- Compatible lifetime media insights including reach, views, likes, comments, saves, shares, interactions and reposts.
- Instagram's `online_followers` metric when Meta returns non-empty hourly values.

Metric eligibility differs by account, media type and post age. A missing metric is stored as unavailable, never as invented performance. Media-level insight failures fall back to conservative metric sets and do not discard the rest of a successful sync.

## Timing recommendations

The model operates in `Australia/Perth` for the Thrill Noir pilot.

- With hourly follower data: 70% relative follower activity and 30% observed post performance.
- Without hourly follower data: observed post performance only.
- Exposure uses the strongest available value of reach or views.
- Engagement uses total interactions when available, otherwise a weighted combination of likes, comments, saves and shares.
- Recommendations show their historical sample size and a confidence label.

The score ranks relative opportunities for this creator. It is not a promise of reach and should not override content relevance, platform safety or human scheduling judgment.

## Safety and operations

- Sync is read-only and creator-scoped.
- API credentials remain in local environment configuration; raw tokens are not stored in analytics rows.
- Raw provider responses are retained only for the creator's own media records to support later normalization fixes.
- No recommendation publishes, reschedules or approves content.
- Run `npm run verify` after changes and `npm run db:backup` before material data migrations.
