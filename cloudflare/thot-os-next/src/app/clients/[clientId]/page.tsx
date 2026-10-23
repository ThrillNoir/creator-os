import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { bookingStates, clientMoney } from "@/lib/client-records";
import { requireCreatorContext } from "@/lib/identity";
import { createClientBookingAction, recordClientPaymentAction, updateClientBookingStatusAction, voidClientPaymentAction } from "../actions";

export const dynamic = "force-dynamic";

type Client = { id: string; display_name: string; contact_channel: string; contact_value: string; notes: string };
type Booking = { id: string; booked_on: string; status: string; description: string };
type Payment = { id: string; booking_id: string | null; received_on: string; amount_minor: number; currency: string; reference: string; reported_by: string; voided_at: string | null; voided_by: string | null; void_reason: string | null };
type Total = { currency: string; amount_minor: number; count: number };
type Audit = { id: string; event_type: string; created_at: string; actor: string };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const [identity, { clientId }, query] = await Promise.all([requireCreatorContext(), params, searchParams]);
  if (identity.creator.role === "viewer" || !/^[0-9a-f-]{36}$/.test(clientId)) notFound();
  const creatorId = identity.creator.creator_id;
  const DB = cloudflareEnv().DB;
  const client = await creatorPrepare(DB, creatorId, "SELECT id,display_name,contact_channel,contact_value,notes FROM creator_clients WHERE creator_id=@creator AND id=?")
    .bind(clientId).first<Client>();
  if (!client) notFound();
  const [bookings, payments, totals, audits] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id,booked_on,status,description FROM creator_client_bookings WHERE creator_id=@creator AND client_id=? ORDER BY booked_on DESC,id DESC LIMIT 100").bind(clientId).all<Booking>(),
    creatorPrepare(DB, creatorId, `SELECT p.id,p.booking_id,p.received_on,p.amount_minor,p.currency,p.reference,p.reported_by,p.voided_at,p.voided_by,
      (SELECT json_extract(e.detail,'$.reason') FROM creator_client_audit_events e WHERE e.creator_id=p.creator_id
        AND e.subject_id=p.id AND e.event_type='payment_voided' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS void_reason
      FROM creator_client_payments p WHERE p.creator_id=@creator AND p.client_id=? ORDER BY p.received_on DESC,p.id DESC LIMIT 100`).bind(clientId).all<Payment>(),
    creatorPrepare(DB, creatorId, "SELECT currency,SUM(amount_minor) AS amount_minor,COUNT(*) AS count FROM creator_client_payments WHERE creator_id=@creator AND client_id=? AND voided_at IS NULL GROUP BY currency").bind(clientId).all<Total>(),
    identity.creator.role === "agency_admin" ? creatorPrepare(DB, creatorId, "SELECT id,event_type,created_at,actor FROM creator_client_audit_events WHERE creator_id=@creator AND (subject_id=? OR json_extract(detail,'$.clientId')=?) ORDER BY created_at DESC,id DESC LIMIT 50").bind(clientId, clientId).all<Audit>() : Promise.resolve({ results: [] as Audit[] }),
  ]);
  return <AppShell active="Clients & bookings">
    <PageHeader eyebrow="PRIVATE CRM" title={client.display_name} subtitle="Bookings and spending here are manually recorded. No platform earnings or public enquiries are automatically assigned to this person." />
    <p><Link className="secondary-action" href="/clients">← All clients</Link></p>
    {query.notice === "booking_saved" && <p className="success" role="status">Booking saved.</p>}
    {query.notice === "payment_saved" && <p className="success" role="status">Reported payment recorded.</p>}
    {query.notice === "payment_voided" && <p className="success" role="status">Mistaken report voided and removed from the summary. Its history remains visible.</p>}
    <section className="panel admin-section"><div className="section-heading"><div><h2>At a glance</h2><p>{client.contact_channel === "none" ? "No contact method recorded" : `${client.contact_channel}: ${client.contact_value}`}</p></div></div>
      <p>{totals.results.length ? totals.results.map((total) => `${clientMoney(total.amount_minor, total.currency)} reported across ${total.count} ${total.count === 1 ? "payment" : "payments"}`).join(" · ") : "No spending evidence recorded yet."}</p>
      {client.notes && <p>Workspace note (visible to authorized staff): {client.notes}</p>}
    </section>
    <section className="panel admin-section"><div className="section-heading"><div><h2>Private bookings</h2><p>A booking's status is a manual record, independent of the public site's enquiry delivery receipt.</p></div></div>
      {bookings.results.length ? <div className="identity-list">{bookings.results.map((booking) => <article className="identity-row" key={booking.id}><div><strong>{booking.description || "Private booking"}</strong><small>{booking.booked_on} · {booking.status}</small></div><form action={updateClientBookingStatusAction} className="inline-form"><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="bookingId" value={booking.id} /><label>Update status<select name="status" defaultValue={booking.status}>{bookingStates.map((state) => <option key={state} value={state}>{state}</option>)}</select></label><button className="secondary-action" type="submit">Save status</button></form></article>)}</div> : <div className="empty">No private bookings recorded.</div>}
      <details><summary>Add a booking</summary><form action={createClientBookingAction} className="inline-form"><input type="hidden" name="requestId" value={crypto.randomUUID()} /><input type="hidden" name="clientId" value={client.id} /><label>Appointment date<input type="date" name="bookedOn" required /></label><label>Short description (optional)<input name="description" maxLength={200} /></label><button className="primary" type="submit">Record request</button></form></details>
    </section>
    <section className="panel admin-section"><div className="section-heading"><div><h2>Spending evidence</h2><p>Record only a payment you can identify for this client. These are human reports, not bank or Tyro verification. Keep currencies separate. Voiding corrects a mistaken entry; actual refunds need separate evidence.</p></div></div>
      {payments.results.length ? <div className="identity-list">{payments.results.map((payment) => <article className="identity-row" key={payment.id}><div><strong>{clientMoney(payment.amount_minor, payment.currency)} {payment.voided_at ? "voided" : "reported"}</strong><small>{payment.received_on}{payment.booking_id ? ` · linked booking ${bookings.results.find((booking) => booking.id === payment.booking_id)?.description || "Private booking"}` : ""}</small><span>Reference: {payment.reference}{identity.creator.role === "agency_admin" ? ` · Recorded by ${payment.reported_by}` : ""}</span>{payment.voided_at && <span>Correction: {payment.void_reason || "Reason unavailable"}{payment.voided_by ? ` · by ${payment.voided_by}` : ""}</span>}</div>{!payment.voided_at && <details><summary>Correct mistaken report</summary><form action={voidClientPaymentAction} className="inline-form"><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="paymentId" value={payment.id} /><label>Reason<input name="reason" maxLength={160} required /></label><button className="secondary-action" type="submit">Void this report</button></form></details>}</article>)}</div> : <div className="empty">No payments recorded.</div>}
      <details><summary>Record a payment</summary><form action={recordClientPaymentAction} className="inline-form"><input type="hidden" name="requestId" value={crypto.randomUUID()} /><input type="hidden" name="clientId" value={client.id} /><label>Received date<input type="date" name="receivedOn" required /></label><label>Amount<input type="number" name="amount" min="0.01" max="999999999999.99" step="0.01" required /></label><label>Currency<input name="currency" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" defaultValue="AUD" required /></label><label>Booking (optional)<select name="bookingId" defaultValue=""><option value="">Unlinked payment</option>{bookings.results.map((booking) => <option key={booking.id} value={booking.id}>{booking.booked_on} · {booking.description || "Private booking"}</option>)}</select></label><label>Non-sensitive reference<input name="reference" maxLength={160} required /></label><button className="primary" type="submit">Record reported payment</button></form></details>
    </section>
    {identity.creator.role === "agency_admin" && <details className="panel admin-section"><summary>Record history</summary><p>Actions are recorded with the actor and time. Client notes and contact details are excluded from audit events.</p>{audits.results.map((event) => <p key={event.id}>{event.created_at} · {event.event_type.replaceAll("_", " ")} · {event.actor}</p>)}</details>}
  </AppShell>;
}
