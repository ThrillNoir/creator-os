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
+## Current build assessment — 2026-08-31

Status labels:

- **Verified staging:** deployed behaviour or authoritative D1 evidence exists, and the current canonical release branch passes its relevant checks.
- **Built, proof incomplete:** implementation exists, but its complete live user/provider journey has not passed the release gate.
- **Planned:** agreed product direction with no canonical staging implementation yet.

| Capability | Status | Current evidence | Remaining gap |
| --- | --- | --- | --- |
| Cloud control plane | **Verified staging** | Canonical web, Instagram, Reddit, Telegram and Vault Workers are deployed. D1 has 58 recorded migrations through `0056_creator_invitations.sql`; web Worker version `3153179f-7896-4d1c-9469-e723c5754577` serves commit `7e62286`. | Production is not provisioned. Consolidate the deployed release branch into the primary development baseline. |
| Creator identity and isolation | **Verified staging** | Creator invitation, membership, onboarding and isolation contracts are deployed and the current canonical app passes 166 tests. | Complete one creator-role submit → agency review → activation journey and verify the creator cannot access another workspace. |
| Cloudflare media library | **Verified staging** | New image and video intake creates private, creator-scoped R2-native authority. Adelaide and Bryshanagy both have verified R2-native assets. | Legacy catalogue rows remain historical and were deliberately not migrated. Remove misleading global Dropbox-state language where it appears in operator UI or reports. |
| Accounts and connections | **Built, proof incomplete** | Multiple accounts per platform are schema-supported and migration `0055` is live. Adelaide has one active and one retired Reddit account; Operations hides retired accounts. | Adelaide's active Reddit provider connection is expired and needs reconnecting. Her second Instagram account has not been added or connected. Test multiple Reddit, Instagram and X accounts end to end. |
| Instagram publishing | **Verified staging** | Four Adelaide Instagram publications are recorded as published, and the client confirmed live posting works. | Repeat against the second Instagram account after it is added. |
| Reddit publishing | **Verified staging** | The explicit account-derived **Creator profile** target is deployed in Reddit Worker version `f919744d-cbb4-4fb1-8cfb-5b0ba4297953`. Live creator-profile and subreddit posts both passed with account-scoped receipts. | Repeat only for a new identity or materially different provider path. |
| Fansly Vault | **Verified staging** | The R2-backed Chrome bridge delivered the approved Adelaide asset and recorded one verified vault upload. | Run a clean repeat and clear or review the historical staged/failed backlog before treating the queue as release-ready. |
| OnlyFans bridge | **Built, proof incomplete** | Creator-scoped OnlyFans bridge, batch and receipt foundations exist in the deployed schema/source. | No current connected messaging authority is recorded. Keep it outside the first messaging release gate unless explicitly prioritised. |
| Encrypted Access vault | **Verified staging** | PIN derivation, encryption, creator scope and audit coverage are deployed. The creator-facing account editor requires the PIN for every save and supports password, Google and Apple login metadata. | Repeat the save/reveal flow with the next creator during the onboarding closeout gate. |
| Unified Messages | **Built, proof incomplete** | Telegram, Instagram and Fansly threads/messages exist with creator-scoped audit and receipt models. Fansly live messaging passed; Instagram inbound sync works but Adelaide's provider has blocked outbound messaging. | Complete Telegram's live matrix and later prove Instagram with an independently authorised unrestricted account. Keep Adelaide sends locked and OnlyFans outside this gate. |
| Public and 18+ profiles | **Verified staging** | Adelaide has four recorded public-profile and four age-gated-profile publications. | Treat future design additions as refinement, not a new foundation. |
| Growth insights | **Verified staging, narrow scope** | Adelaide has 63 official Instagram analytics snapshots; the latest was collected on 2026-08-31. Recommendations remain read-only and evidence-labelled. | Add other accounts/platforms only after their official evidence paths exist. |
| Money and health | **Built, no operating data** | Currency-safe finance imports, agency splits and delivery scorecards are implemented and tested. | No staging finance imports exist. Agree platform export definitions before importing earnings. |
| Creator-facing email onboarding | **Built, proof incomplete** | Hash-only invitations, native Email Sending, Access claim, guided/AI-assisted interview, encrypted account capture and explicit review handoff are deployed in commit `7e62286`. | Complete one real creator-role invitation → onboarding → review → activation journey and confirm isolation. |
| Creator AI brain | **Planned** | Data inputs and human-approval rules exist; the architecture decision is one shared runtime with creator-scoped context. | No canonical deployed assistant workflows yet. Start with the deterministic daily operator brief, then add AI explanation and drafting. |

The current web deployment source is `codex/onboarding-integration` at `7e62286`; the primary working directory remains on `codex/creator-onboarding-access` with substantial uncommitted changes. Preserve those changes and continue through clean integration branches rather than the dirty checkout.

## Delivery roadmap — workshop draft

### 0. Finish the staging operating loop

- Release baseline: reconcile the verified `codex/cloudflare-content-cutover` branch into the intended primary branch without overwriting the existing working tree.
- Access: explain beside **Encrypt and save** that a label, a 12-character password and the four-digit PIN are required. Keep the PIN security check; remove the silent disabled-button failure.
- Accounts: reconnect Adelaide's active Reddit account, add her second Instagram account, and verify that multiple Reddit, Instagram and X accounts remain independent.
- Messaging: complete the Telegram, Instagram and Fansly staging matrix before adding another messaging platform.
- Publishing: retain the verified Instagram and Fansly paths and their external receipts. For Reddit, keep one publishing pipeline but offer two explicit targets: **Creator profile (u/handle)** and **Subreddit (r/community)**. The profile target must be derived from the selected, verified Reddit account rather than entered as arbitrary text. Prove one post to each target and attach each receipt to the correct account.
- Media clarity: keep legacy catalogue content untouched, while making it clear that new canonical media uses R2-native authority.

Execution order:

1. **Isolated implementation:** build the Reddit profile target, Access feedback and any proven UI clarity fixes from the verified release commit in separate branches.
2. **Readiness review:** verify account isolation and the Messages matrix with automated checks; list the remaining provider actions without sending or publishing.
3. **Integration:** review and combine the isolated commits into one candidate based on the verified release branch. Do not merge through the dirty primary checkout or overwrite its uncommitted work.
4. **Automated gate:** run the complete canonical test suite, Reddit Worker tests, lint and build before deployment.
5. **Staging deployment:** deploy only the Workers changed by the reviewed candidate and record their deployment versions.
6. **Client-assisted live gate:** reconnect Adelaide's selected Reddit account, add/connect her second Instagram identity, publish one approved SFW Reddit profile post and one approved subreddit post, then exercise Telegram, Instagram and Fansly messaging without exposing message content in evidence.

Steps 1–5 are complete. The web and Reddit Workers are deployed and remotely observed at 100% traffic; Step 6 is the remaining Phase 0 gate.

Phase 0 is complete when the primary branch represents the deployed baseline, the Access requirement is visible, Reddit is connected to the correct account, creator-profile and subreddit posting both pass, the three-platform messaging matrix passes and no UI describes a retired or legacy account as active.

### 1. Launch creator-facing onboarding

Keep the existing canonical workspace and onboarding records, but replace the admin-led form journey with a creator-facing welcome experience after the agency approves an application.

Journey:

1. An administrator approves the creator and THOT OS creates a pending creator workspace and one-time invitation.
2. THOT OS sends a transactional welcome email to the creator's already-verified contact address. The invite is expiring, single-use and never contains credentials.
3. The creator signs in through the existing Cloudflare Access identity boundary and can enter only their pending workspace.
4. A cheerful, slightly cheeky AI interviewer asks one useful question at a time, explains why THOT OS needs it, and drafts the matching onboarding fields in a visible review panel.
5. The creator confirms each section before it is stored. Manual form entry is always available.
6. Restricted identity fields such as legal name and date of birth use ordinary private inputs and are excluded from the general AI conversation and future creator brain.
7. The creator reviews the completed profile, agrees to the recorded boundaries and submits it for agency review and activation.

Interview chapters:

- **Welcome to your operating system:** what THOT OS will organise, measure and help with.
- **Keep work and personal life separate:** recommend a dedicated creator-operations Gmail for platform accounts, recovery and the assigned Chrome profile. Use a password manager, a unique password and MFA; never recommend weaker authentication or shared passcodes.
- **The account map:** record every Instagram, Reddit, X, paid-platform and other account independently.
- **Make the AI sound like you:** voice, vocabulary, examples, humour, content pillars and phrases to avoid.
- **Hard boundaries are useful:** consent, tagging, disclosures, private facts and topics the assistant must never invent or mention.
- **What are we building toward?:** audience, positioning, promotion goals, revenue priorities and the creator's preferred level of involvement.
- **Ready for launch:** show the completed forms, missing items and exactly what the agency will review next.

The AI interviewer is a bounded interface over the existing onboarding schema, not a separate chatbot platform. It may propose field values and follow-up questions, but it cannot approve the creator, create platform accounts, connect credentials or make external claims.

Acceptance path:

1. Send an invitation to a controlled staging email and confirm delivery, expiry and single use.
2. Complete, leave and resume the interview without losing confirmed answers.
3. Review and correct every AI-drafted field before submission.
4. Add multiple accounts on the same platform and one encrypted Access credential.
5. Activate the creator and confirm that Adelaide data, credentials, messages, media and private notes are inaccessible from the new workspace.
6. Confirm the creator cannot see agency-only controls or another creator selector.

The native Cloudflare Worker Email Sending binding and invitation flow are now deployed. Phase 1 closes after one real creator completes the full acceptance path above.

### 2. Prove unified messaging end to end

Test one inbound message, one human-approved reply, its provider receipt, refresh, unread state and failure recovery for every enabled platform. Never use private message text as test evidence.

Current Adelaide staging baseline on 2026-08-31:

- Telegram: connected and provider-validated; six recorded sends.
- Instagram: connected in assist mode; two sent and two failed reply drafts, but outbound reply validation is not yet set.
- Fansly: device bridge ready in assist mode; the premium reply queue has five sent and six failed records requiring a clean regression pass after the bridge fixes.
- OnlyFans: not connected; decide whether to connect it before including it in the release gate.

Release order:

1. Close Phase 1 with one creator-role onboarding submission, agency review, activation and isolation check.
2. Prove Telegram and re-run the already-working Fansly path without recording private message text.
3. Keep Adelaide's Instagram send path locked; prove Instagram only when an independently authorised unrestricted account is available.
4. Integrate only contract or failure-state fixes found by those proofs, then deploy only the Workers that changed.

### 3. Build the creator AI brain from existing data

Use one shared assistant runtime. A creator's “brain” is a creator-scoped context assembled from approved onboarding facts, voice and boundaries; account capabilities; R2 library metadata and usage history; messages; publication receipts; analytics; earnings; and human feedback. Do not create a separate model, vector database or agent service per creator until measured scale requires it.

First bounded workflows:

1. **Daily operator brief:** rank unread conversations, failed deliveries, expiring connections and approved content opportunities.
2. **Content and promotion assistant:** propose creator-grounded content choices, captions, platform variations and posting windows from approved assets and measured performance.
3. **Message assistant:** summarize the selected conversation and draft replies in the approved voice; every reply returns to human review.
4. **Weekly growth review:** explain verified performance and earnings, identify experiments, and record what the human accepts or rejects.

The assistant may read only the selected creator's approved context. It may create drafts and recommendations, but sending, publishing, pricing, spending, identity changes and credential use remain separate human-approved actions.

### 4. Measure before adding autonomy

- Track draft acceptance, edit distance, verified delivery, reply outcomes, revenue-protection backlog and operator time saved.
- Feed verified receipts and human decisions back into recommendations; do not treat guesses or queued work as learning signals.
- Add specialist or autonomous agents only when a measured bottleneck cannot be handled by the shared bounded workflows.

### 5. Production readiness

- Create a reviewed production environment only after Phases 0–3 pass in staging.
- Provision separate production Workers, D1, R2, Access policy, Email Sending domain and service/device credentials; do not reuse staging resources.
- Promote one bounded creator pilot first, retain rollback evidence and expand only after verified delivery, messaging and isolation remain healthy.
