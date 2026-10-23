import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { clientMoney } from "@/lib/client-records";
import { requireCreatorContext } from "@/lib/identity";
import { createClientAction } from "./actions";

export const dynamic = "force-dynamic";

type Client = { id: string; display_name: string; contact_channel: string; contact_value: string; notes: string; created_at: string };
type Total = { client_id: string; currency: string; amount_minor: number; payment_count: number };
type BookingCount = { client_id: string; count: number };

export default async function ClientsPage() {
  const identity = await requireCreatorContext();
  if (identity.creator.role === "viewer") notFound();
  const creatorId = identity.creator.creator_id;
  const DB = cloudflareEnv().DB;
  const [clients, totals, bookings] = await Promise.all([
    creatorPrepare(DB, creatorId, "SELECT id,display_name,contact_channel,contact_value,notes,created_at FROM creator_clients WHERE creator_id=@creator ORDER BY display_name,id LIMIT 200").all<Client>(),
    creatorPrepare(DB, creatorId, "SELECT client_id,currency,SUM(amount_minor) AS amount_minor,COUNT(*) AS payment_count FROM creator_client_payments WHERE creator_id=@creator AND voided_at IS NULL GROUP BY client_id,currency").all<Total>(),
    creatorPrepare(DB, creatorId, "SELECT client_id,COUNT(*) AS count FROM creator_client_bookings WHERE creator_id=@creator GROUP BY client_id").all<BookingCount>(),
  ]);
  return <AppShell active="Clients & bookings">
    <PageHeader eyebrow="PRIVATE CRM" title="Clients & bookings" subtitle="Keep a simple record of who booked you and what they reported paying. Only payments you explicitly record count toward a client's total." />
    <section className="panel admin-section"><div className="section-heading"><div><h2>Your clients</h2><p>Each creator has a separate client list. Public booking messages and platform earnings are never matched to a person automatically.</p></div><span>{clients.results.length} shown</span></div>
      {clients.results.length ? <div className="identity-list">{clients.results.map((client) => {
        const amounts = totals.results.filter((total) => total.client_id === client.id);
        const bookingCount = bookings.results.find((item) => item.client_id === client.id)?.count ?? 0;
        return <article className="identity-row" key={client.id}><div><strong>{client.display_name}</strong><small>{bookingCount} private {bookingCount === 1 ? "booking" : "bookings"}</small><span>{amounts.length ? amounts.map((total) => `${clientMoney(total.amount_minor, total.currency)} reported (${total.payment_count})`).join(" · ") : "No payments recorded"}</span></div><Link className="secondary-action" href={`/clients/${client.id}`}>Open client</Link></article>;
      })}</div> : <div className="empty"><b>No clients recorded yet.</b><span>Add one when you have a private booking or an identified payment to track.</span></div>}
    </section>
    <section className="panel admin-section"><div className="section-heading"><div><h2>Add a client</h2><p>Use a name you recognize. Contact details and notes are visible to authorized staff in this creator workspace, never on a public page. Never enter card or bank credentials.</p></div></div>
      <form action={createClientAction} className="inline-form"><input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <label>Name or nickname<input name="displayName" maxLength={120} required /></label>
        <label>Contact method<select name="contactChannel" defaultValue="none"><option value="none">Not recorded</option><option value="email">Email</option><option value="telegram">Telegram</option><option value="other">Other</option></select></label>
        <label>Contact detail, if selected<input name="contactValue" maxLength={200} autoComplete="off" /></label>
        <label>Private note (optional)<textarea name="notes" maxLength={1000} /></label>
        <button className="primary" type="submit">Add client</button>
      </form>
    </section>
  </AppShell>;
}
