# Manual download sale record — decision proposal, 2026-10-06

Based on locally tested `579715e`. No implementation, migration, remote change or payment collection is authorized by this document. The human requested recipient and sold amount on link generation; the broader Client Hub remains a proposal.

## Smallest implementation

Extend a download record with an optional private recipient reference and optional manual sale amount/currency. No new client entity, deduced identity, cross-platform merge or cross-creator search. Blank amount means no recorded sale, not zero revenue. Amount and currency must be supplied together; zero can explicitly represent a complimentary transfer and must not count as a paid sale. Issuing or redeeming a link alone never records a sale.

The existing generator permits active `creator`, `operator` and `agency_admin` membership in the selected workspace. Reuse those permissions for reading and modifying this private record, with server-side checks on every request and link ID. Viewers and outsiders have no access. Public metadata/session queries must explicitly exclude recipient and sale fields, including error responses and HTML.

Proposed recipient field: a free-text label or platform handle, at most 120 characters, plain text with control characters rejected. Copy should discourage email, phone, legal identity and sensitive notes. Do not promise format validation can prove the label is non-identifying. Equal labels do not automatically establish that two people are the same. No per-client spending total until a separate explicit client identity contract exists.

Record one manually reported sale per link, with amount in integer minor units, currency, recorded-by identity and timestamp. Currency precision must be validated; do not reuse the existing CSV parser's blanket two-decimal assumption for currencies with other precision. Reject negative, excessive, non-finite, exponent-form or ambiguous amounts. Use a bounded maximum and exact decimal-to-integer parsing, not floating-point multiplication. Format and total separately by currency.

Private per-asset history shows link status, recipient label, manual sale amount/currency and whether corrected or voided. Totals count only non-void manually recorded paid entries; show complimentary entries separately. Label them “Manually recorded sales — not verified payments.” Do not add them to imported platform earnings or commission invoices automatically. Reissuing a delivery link is not proof of another sale; explain that the amount should only be recorded once for the transaction.

Corrections update the manual amount/currency with actor/time and a minimal change record. A Void action excludes erroneous entries from totals without revoking download access. Clearing a recipient label must remove it from ordinary data and audit payloads; never preserve the erased label in correction history. Revoking access is a separate action and does not mean refund, cancellation or deletion of the sale.

## One owner choice

No existing approved rule sets how long recipient identifiers should remain associated with purchase history. Existing finance conventions establish currency separation and provenance, not recipient retention. The earlier [follow-up checklist](2026-10-06-download-follow-up-plan.md) records this open design question; it is not itself human approval or a new engineering authority.

Choose the recipient-label lifecycle:

1. **Recommended: 90 days from generation**, then erase the recipient label while retaining the non-identifying manual amount/currency and correction/void status. Allow earlier manual clearing. This bounds personal-data retention and supports recent-sale follow-up; it does not support lifetime client-spend tracking.
2. **Until manually cleared**, with the same clear-recipient control. This supports longer follow-up but deliberately retains the recipient-to-sale association indefinitely unless a creator acts.

Amounts and creator-scoped audit identifiers still need any applicable business-record retention policy before production use. No legal retention period is asserted here. Neither option creates CRM identity linking. Automatic label expiry needs an existing bounded cleanup path and deterministic expiry tests; it must not be merely a display-only hiding rule. Backup erasure timing must be recorded separately and not promised as immediate deletion.

This is a product/privacy choice. There is no tool approval rejection or repository instruction requiring a blanket halt to ordinary local work. Storage/correction/cleanup implementation should follow the selected lifecycle so we do not quietly establish a policy for client purchase history.

## Assignment and acceptance after the choice

- Bounded implementation agent: additive local schema and domain validation/history/correction/cleanup in the existing D1 download authority; local fixtures only.
- ATLAS: generator/history UI and action wiring, currency precision and public/private boundary integration.
- Independent verify agent: negative access and public-leakage tests; verify clearing, corrections, voids, counts and per-currency totals. No edits in this assignment.

Required checks: existing Node behavioral tests, legacy migration replay, lint, build, Cloudflare verification, static staging preflight and diff checks. Cases include viewer/outsider denial, forged creator/link IDs, HTML injection, invalid and boundary amounts, multiple currencies, retries/duplicate link generation, clearing without sale loss, void exclusion, correction provenance and selected retention behavior. Record local completion separately from future remote migration/release approval.

Persistent expired download pages are a separate public-exposure decision and do not affect this private record plan. The three tested local feature/fix commits remain intact; this document adds no schema or source changes.
