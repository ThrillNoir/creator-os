# Creator client records: local candidate

The Clients & bookings workspace records named clients, private booking states, and payments reported by an authorized user. Records are scoped to the selected creator. The creator can see a short total by currency; agency staff can also see the action history. A viewer cannot open this workspace.

Migration `0072_creator_client_records.sql` must be applied before deploying a Web build that includes `/clients`. It has only been replayed in local SQLite. No existing creator or public booking data is backfilled or linked.

## Meaning of the numbers

- A client total sums positive, manually reported payments that have not been voided, grouped by currency. It is not bank-verified revenue, net revenue, an amount owed, or a commission calculation.
- A mistaken report can be voided with a reason. The original row and audit history remain, and the report is excluded from totals. A real refund or chargeback needs a separate evidence flow before it can change spending totals.
- A booking's date is its intended appointment date. Its status is manually set; a public booking delivery receipt does not create a booking or identify a client.
- Imported platform earnings remain aggregate. No OnlyFans, Fansly, Tyro, or other payment record is automatically assigned to a client. Any future provider import needs an explicit match and review path.

Contact details and notes are visible to authorized staff in the creator workspace. The forms instruct users not to enter bank or card credentials; they are not a credential store. The free-text note is limited to 1,000 characters. Client and payment writes produce scoped audit events.

Local checks: `tests/client-records.test.mjs` exercises schema isolation and amount validation; the app typecheck and build cover the routes. A signed-in creator browser journey on the new build remains to be done before staging, including adding a client, reopening it, recording and correcting a payment, and confirming another creator cannot see it.
