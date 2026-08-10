# Future Creator Portal boundary

Status: planned, intentionally not exposed in the product yet.

Creator OS is currently a Super Admin HQ. The future Creator Portal should reuse creator-scoped service modules without exposing HQ credentials, other creators, internal agency notes or publishing authority.

## Shared modules planned for the portal

- Analytics: creator-readable performance and trends with source and capture dates.
- Messaging: agency-to-creator operational conversation and delivery history. Do not relay premium-platform fan message text or explicit media through Telegram.
- Submit content for processing: direct delivery into a creator-scoped intake queue with `uploading`, `received`, `processing`, `needs_information`, `ready_for_review`, `added_to_library`, and `rejected_or_duplicate` states.
- Creator voice: creator-managed examples, vocabulary and notes with version history.
- Personal details: encrypted, access-restricted, excluded from general logs and AI prompts.
- Creator library: creator-scoped assets and use history. A future per-creator setting may require final creator approval before publication.
- Post-processing annotations: creators can add creator friends and private context after agency processing without changing source media.
- Financial dashboard: reporting and reconciliation first; no bank movement authority.
- Yearly Wrapped: a friendly summary generated from retained, dated operational events.

## Data to retain now for Wrapped

- content submissions and processing outcomes;
- classification reviews and changes;
- schedules, handoffs and publication receipts;
- analytics snapshots and earnings imports;
- collaborations and creator-friend links;
- account milestones and human confirmations.

Original media remains read-only. Metadata, links and annotations are versioned separately. Handles never imply consent, and paid multi-content requires an explicit attestation whose evidence remains in OnlyFans or Fansly.
