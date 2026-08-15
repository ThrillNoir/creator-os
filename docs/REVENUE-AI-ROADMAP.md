# THOT OS revenue and AI working brief

## Operating prompt

Build THOT OS into a private, creator-scoped system that increases verified earnings while reducing operator effort. Prefer measurable revenue-producing actions over vanity activity. Keep publishing, messaging, pricing, spending and identity changes behind explicit human approval. Never estimate missing earnings, combine currencies, treat a queued action as a successful delivery, or let an AI task imply that an external action occurred.

## Primary goals

1. Make imported net earnings visible by creator, platform, currency and period, with source provenance and an explainable agency split.
2. Make false success difficult by measuring only external publication receipts and confirmed native-vault delivery.
3. Put failed, stalled, device-blocked and unread work into one revenue-protection queue.
4. Reduce repetitive preparation with bounded AI drafts that always return to human review.

## KPI framework

Primary outcomes:

- Imported net earnings, grouped by creator, platform and currency. Source: reviewed platform CSV. Never summed across currencies.
- Verified delivery rate: externally receipted social publications plus confirmed vault deliveries divided by those verified deliveries plus failed attempts.
- Revenue-protection backlog: unreviewed failures, deliveries stalled for more than 15 minutes and failed vault transfers.

Drivers:

- Approval coverage for scheduled, publishing and published social work.
- Signed-device queue size for premium vault transfers.
- Unread open conversations.
- Median approval-to-verified-delivery time once event history is complete enough to support it.

Guardrails:

- Zero unverified work presented as published or uploaded.
- One hundred percent human approval coverage for external actions.
- No autonomous sends, publishes, price changes or spending.
- No creator, credential or private-note leakage across workspaces or agent environments.

## AI sequence

### 1. Assist

- Caption and title alternatives grounded only in approved creator voice and the selected asset.
- Conversation summaries and reply drafts using the current thread, with consent and tagging preferences enforced.
- Weekly performance explanation using stored receipts and imported earnings, with missing data called out.

All output is a draft. The operator chooses, edits and approves it.

### 2. Recommend

- Rank approved content by historical reach, verified delivery reliability and paid-content eligibility.
- Recommend posting windows with sample size and confidence.
- Surface likely revenue-protection work: unread conversations, failed delivery, expired pairing or stale queue claim.

Recommendations cannot approve or execute actions.

### 3. Bounded operations

- Prepare creator-scoped batches, classify obvious operational states and open the correct recovery screen.
- Require a fresh human approval at the final external-action boundary.
- Record the approving human, immutable input references and external receipt.

Autonomous direct messages, publishing, pricing and spending remain out of scope until separately authorized, threat-modelled and validated with rollback and audit controls.

## Data still needed

- Reviewed OnlyFans and Fansly daily earnings exports.
- A decision on whether imported `net_revenue` already includes platform fees, refunds, tax and GST.
- Purchase attribution or campaign identifiers before claiming that a post or message caused revenue.
- Enough delivery history to set evidence-based targets rather than arbitrary percentages.
