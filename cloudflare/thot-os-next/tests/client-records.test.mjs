import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { clientAmountMinor, clientCurrency, clientDate, clientText } from "../src/lib/client-records.ts";

const migration = readFileSync(new URL("../../thot-os-app/migrations/0072_creator_client_records.sql", import.meta.url), "utf8");

test("client CRM keeps records inside one creator and only counts explicit payments", () => {
  const db = new Database(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE creators(id TEXT PRIMARY KEY); INSERT INTO creators VALUES ('amber'),('birch');");
    db.exec(migration);
    db.prepare("INSERT INTO creator_clients (id,creator_id,display_name,contact_channel) VALUES ('a','amber','Synthetic A','none'),('b','birch','Synthetic B','none')").run();
    const booking = db.prepare("INSERT INTO creator_client_bookings (id,creator_id,client_id,booked_on,status) VALUES (?,?,?,'2026-10-23','requested')");
    booking.run("ab", "amber", "a");
    assert.throws(() => booking.run("cross", "amber", "b"), /FOREIGN KEY/);
    const payment = db.prepare("INSERT INTO creator_client_payments (id,creator_id,client_id,booking_id,received_on,amount_minor,currency,reference,reported_by) VALUES (?,?,?,?,'2026-10-23',?,'AUD','synthetic receipt','test')");
    payment.run("pay-a", "amber", "a", "ab", 2500);
    assert.throws(() => payment.run("pay-cross-client", "birch", "b", "ab", 9000), /FOREIGN KEY/);
    assert.throws(() => payment.run("pay-cross-creator", "amber", "b", null, 9000), /FOREIGN KEY/);
    assert.throws(() => payment.run("pay-negative", "amber", "a", null, -1), /CHECK/);
    const total = db.prepare("SELECT SUM(amount_minor) AS amount FROM creator_client_payments WHERE creator_id='amber' AND client_id='a'").get();
    assert.equal(total.amount, 2500);
    db.prepare("UPDATE creator_client_payments SET voided_at=CURRENT_TIMESTAMP,voided_by='synthetic' WHERE id='pay-a' AND creator_id='amber' AND client_id='a'").run();
    assert.equal(db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount FROM creator_client_payments WHERE creator_id='amber' AND client_id='a' AND voided_at IS NULL").get().amount, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_client_payments WHERE id='pay-a'").get().count, 1, "corrections retain the original record");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_client_bookings WHERE creator_id='amber'").get().count, 1);
  } finally { db.close(); }
});

test("client input normalization rejects invalid dates, money and unsafe labels", () => {
  assert.equal(clientAmountMinor("15.25"), 1525);
  assert.equal(clientCurrency("aud"), "AUD");
  assert.equal(clientDate("2026-10-23"), "2026-10-23");
  assert.equal(clientText("  Friend  ", 120, "a name", true), "Friend");
  assert.throws(() => clientDate("2026-02-31"), /valid date/);
  assert.throws(() => clientAmountMinor("0"), /supported range/);
  assert.throws(() => clientText("A\nB", 120, "a name", true), /Enter/);
});
