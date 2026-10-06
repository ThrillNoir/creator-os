import assert from "node:assert/strict";
import test from "node:test";
import { DownloadSaleError, SALE_CURRENCIES, parseDownloadSale } from "../src/lib/content-download-sales.ts";

test("sale parser stores exact minor units using each supported currency precision", () => {
  assert.deepEqual(SALE_CURRENCIES, ["AUD", "USD", "EUR", "GBP", "CAD", "NZD", "JPY", "KWD"]);
  assert.deepEqual(parseDownloadSale({ saleAmount: "12.34", saleCurrency: "aud" }), { recipientReference: null, amountMinor: 1234, currency: "AUD" });
  assert.equal(parseDownloadSale({ saleAmount: "1", saleCurrency: "JPY" }).amountMinor, 1);
  assert.equal(parseDownloadSale({ saleAmount: "1.234", saleCurrency: "KWD" }).amountMinor, 1234);
  assert.equal(parseDownloadSale({ saleAmount: "0.00", saleCurrency: "USD" }).amountMinor, 0);
  assert.deepEqual(parseDownloadSale({ recipientReference: " ref " }), { recipientReference: "ref", amountMinor: null, currency: null });
});

test("sale parser rejects invalid pairs, excess precision, malformed decimals, controls, and oversized values", () => {
  for (const input of [
    { saleAmount: "1", saleCurrency: "" }, { saleAmount: "1.001", saleCurrency: "USD" },
    { saleAmount: "1.0", saleCurrency: "JPY" }, { saleAmount: "1e2", saleCurrency: "USD" },
    { saleAmount: "-1", saleCurrency: "USD" }, { saleAmount: "01", saleCurrency: "USD" },
    { saleAmount: "10000000000.01", saleCurrency: "USD" }, { saleAmount: "9".repeat(1000), saleCurrency: "USD" },
    { recipientReference: "x\ny" }, { recipientReference: "x".repeat(121) },
  ]) assert.throws(() => parseDownloadSale(input), (error) => error instanceof DownloadSaleError && error.code === "invalid_request");
});
