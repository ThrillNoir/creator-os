"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cloudflareEnv } from "@/lib/cloudflare";
import { creatorPrepare } from "@/lib/creator-db";
import { requireCreatorContext } from "@/lib/identity";
import { bookingStates, clientAmountMinor, clientChannels, clientCurrency, clientDate, clientRequestId, clientText } from "@/lib/client-records";

async function editableWorkspace() {
  const identity = await requireCreatorContext("mutate");
  if (identity.creator.role === "viewer") throw new Error("This workspace cannot edit clients.");
  return identity;
}

export async function createClientAction(form: FormData) {
  const identity = await editableWorkspace();
  const creatorId = identity.creator.creator_id;
  const id = clientRequestId(form.get("requestId"));
  const name = clientText(form.get("displayName"), 120, "a client name", true);
  const channel = clientText(form.get("contactChannel"), 20, "a contact method");
  if (!clientChannels.some((item) => item === channel)) throw new Error("Choose a contact method.");
  const contact = channel === "none" ? "" : clientText(form.get("contactValue"), 200, "contact details", true);
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) throw new Error("Enter a valid contact email.");
  const notes = clientText(form.get("notes"), 1000, "notes", false, true);
  const DB = cloudflareEnv().DB;
  await DB.batch([
    creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO creator_clients (id,creator_id,display_name,contact_channel,contact_value,notes)
      VALUES (?,@creator,?,?,?,?)`).bind(id, name, channel, contact, notes),
    creatorPrepare(DB, creatorId, `INSERT INTO creator_client_audit_events (id,creator_id,actor,actor_role,event_type,subject_id,detail)
      SELECT ?,@creator,?,?,'client_created',?,'{}' WHERE changes()=1`).bind(crypto.randomUUID(), identity.email, identity.creator.role, id),
  ]);
  const saved = await creatorPrepare(DB, creatorId, "SELECT display_name,contact_channel,contact_value,notes FROM creator_clients WHERE creator_id=@creator AND id=?")
    .bind(id).first<{ display_name: string; contact_channel: string; contact_value: string; notes: string }>();
  if (!saved || saved.display_name !== name || saved.contact_channel !== channel || saved.contact_value !== contact || saved.notes !== notes) throw new Error("This client request was already used for different details. Refresh before trying again.");
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function createClientBookingAction(form: FormData) {
  const identity = await editableWorkspace();
  const creatorId = identity.creator.creator_id;
  const id = clientRequestId(form.get("requestId"));
  const clientId = clientRequestId(form.get("clientId"));
  const bookedOn = clientDate(form.get("bookedOn"));
  const description = clientText(form.get("description"), 200, "a booking description");
  const DB = cloudflareEnv().DB;
  const client = await creatorPrepare(DB, creatorId, "SELECT id FROM creator_clients WHERE creator_id=@creator AND id=?").bind(clientId).first();
  if (!client) throw new Error("Choose a client in this workspace.");
  await DB.batch([
    creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO creator_client_bookings (id,creator_id,client_id,booked_on,status,description)
      VALUES (?,@creator,?,?,'requested',?)`).bind(id, clientId, bookedOn, description),
    creatorPrepare(DB, creatorId, `INSERT INTO creator_client_audit_events (id,creator_id,actor,actor_role,event_type,subject_id,detail)
      SELECT ?,@creator,?,?,'booking_created',?,json_object('clientId',?) WHERE changes()=1`).bind(crypto.randomUUID(), identity.email, identity.creator.role, id, clientId),
  ]);
  const saved = await creatorPrepare(DB, creatorId, "SELECT client_id,booked_on,description FROM creator_client_bookings WHERE creator_id=@creator AND id=?")
    .bind(id).first<{ client_id: string; booked_on: string; description: string }>();
  if (!saved || saved.client_id !== clientId || saved.booked_on !== bookedOn || saved.description !== description) throw new Error("This booking request was already used for different details. Refresh before trying again.");
  revalidatePath("/clients"); revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?notice=booking_saved`);
}

export async function updateClientBookingStatusAction(form: FormData) {
  const identity = await editableWorkspace();
  const creatorId = identity.creator.creator_id;
  const bookingId = clientRequestId(form.get("bookingId"));
  const clientId = clientRequestId(form.get("clientId"));
  const status = clientText(form.get("status"), 20, "a booking status");
  if (!bookingStates.some((item) => item === status)) throw new Error("Choose a booking status.");
  const DB = cloudflareEnv().DB;
  const current = await creatorPrepare(DB, creatorId, "SELECT status FROM creator_client_bookings WHERE creator_id=@creator AND client_id=? AND id=?")
    .bind(clientId, bookingId).first<{ status: string }>();
  if (!current) throw new Error("Choose a booking in this client record.");
  if (current.status !== status) {
    const results = await DB.batch([
      creatorPrepare(DB, creatorId, `UPDATE creator_client_bookings SET status=?,updated_at=CURRENT_TIMESTAMP
        WHERE creator_id=@creator AND client_id=? AND id=? AND status=?`).bind(status, clientId, bookingId, current.status),
      creatorPrepare(DB, creatorId, `INSERT INTO creator_client_audit_events (id,creator_id,actor,actor_role,event_type,subject_id,detail)
        SELECT ?,@creator,?,?,'booking_status_changed',?,json_object('clientId',?,'from',?,'to',?) WHERE changes()=1`)
        .bind(crypto.randomUUID(), identity.email, identity.creator.role, bookingId, clientId, current.status, status),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new Error("This booking changed while you were editing. Refresh and try again.");
  }
  revalidatePath("/clients"); revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?notice=booking_saved`);
}

export async function recordClientPaymentAction(form: FormData) {
  const identity = await editableWorkspace();
  const creatorId = identity.creator.creator_id;
  const id = clientRequestId(form.get("requestId"));
  const clientId = clientRequestId(form.get("clientId"));
  const bookingId = form.get("bookingId") ? clientRequestId(form.get("bookingId")) : null;
  const receivedOn = clientDate(form.get("receivedOn"));
  const amount = clientAmountMinor(form.get("amount"));
  const currency = clientCurrency(form.get("currency"));
  const reference = clientText(form.get("reference"), 160, "a non-sensitive payment reference", true);
  const DB = cloudflareEnv().DB;
  const client = await creatorPrepare(DB, creatorId, "SELECT id FROM creator_clients WHERE creator_id=@creator AND id=?").bind(clientId).first();
  if (!client) throw new Error("Choose a client in this workspace.");
  if (bookingId && !await creatorPrepare(DB, creatorId, "SELECT id FROM creator_client_bookings WHERE creator_id=@creator AND client_id=? AND id=?").bind(clientId, bookingId).first()) {
    throw new Error("Choose a booking for this client, or leave it unlinked.");
  }
  await DB.batch([
    creatorPrepare(DB, creatorId, `INSERT OR IGNORE INTO creator_client_payments
      (id,creator_id,client_id,booking_id,received_on,amount_minor,currency,reference,reported_by)
      VALUES (?,@creator,?,?,?,?,?,?,?)`).bind(id, clientId, bookingId, receivedOn, amount, currency, reference, identity.email),
    creatorPrepare(DB, creatorId, `INSERT INTO creator_client_audit_events (id,creator_id,actor,actor_role,event_type,subject_id,detail)
      SELECT ?,@creator,?,?,'payment_reported',?,json_object('clientId',?,'currency',?,'amountMinor',?) WHERE changes()=1`)
      .bind(crypto.randomUUID(), identity.email, identity.creator.role, id, clientId, currency, amount),
  ]);
  const saved = await creatorPrepare(DB, creatorId, `SELECT client_id,booking_id,received_on,amount_minor,currency,reference,reported_by
    FROM creator_client_payments WHERE creator_id=@creator AND id=?`).bind(id)
    .first<{ client_id: string; booking_id: string | null; received_on: string; amount_minor: number; currency: string; reference: string; reported_by: string }>();
  if (!saved || saved.client_id !== clientId || saved.booking_id !== bookingId || saved.received_on !== receivedOn || saved.amount_minor !== amount || saved.currency !== currency || saved.reference !== reference || saved.reported_by !== identity.email) {
    throw new Error("This payment request was already used for different details. Refresh before trying again.");
  }
  revalidatePath("/clients"); revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?notice=payment_saved`);
}

export async function voidClientPaymentAction(form: FormData) {
  const identity = await editableWorkspace();
  const creatorId = identity.creator.creator_id;
  const clientId = clientRequestId(form.get("clientId"));
  const paymentId = clientRequestId(form.get("paymentId"));
  const reason = clientText(form.get("reason"), 160, "a correction reason", true);
  const DB = cloudflareEnv().DB;
  const results = await DB.batch([
    creatorPrepare(DB, creatorId, `UPDATE creator_client_payments SET voided_at=CURRENT_TIMESTAMP,voided_by=?
      WHERE creator_id=@creator AND client_id=? AND id=? AND voided_at IS NULL`).bind(identity.email, clientId, paymentId),
    creatorPrepare(DB, creatorId, `INSERT INTO creator_client_audit_events (id,creator_id,actor,actor_role,event_type,subject_id,detail)
      SELECT ?,@creator,?,?,'payment_voided',?,json_object('clientId',?,'reason',?) WHERE changes()=1`)
      .bind(crypto.randomUUID(), identity.email, identity.creator.role, paymentId, clientId, reason),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    const payment = await creatorPrepare(DB, creatorId, "SELECT voided_at FROM creator_client_payments WHERE creator_id=@creator AND client_id=? AND id=?").bind(clientId, paymentId).first<{ voided_at: string | null }>();
    if (!payment?.voided_at) throw new Error("This payment record changed or is outside this client workspace. Refresh and try again.");
  }
  revalidatePath("/clients"); revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?notice=payment_voided`);
}
