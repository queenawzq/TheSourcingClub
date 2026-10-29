import test from "node:test";
import assert from "node:assert/strict";
import { allocatePayouts, payoutAllocationFor } from "../api/_payout-allocation.js";
import { earningStatus, earningsSummaryFor } from "../src/app/order/payment-summary.mjs";

const payments = ["a", "b", "c"].map((id) => ({ id, stripe_transfer_id: `tr_${id}` }));
const credit = (id, amount, at, extra = {}) => ({ id: `txn_${id}`, currency: "usd", type: "payment", net: amount,
  created: at, available_on: at, status: "available", source: { id: `py_${id}`, source_transfer: `tr_${id}` }, ...extra });
const payout = (id, amount, at, status = "paid", extra = {}) => ({ id: `txn_${id}`, currency: "usd", type: "payout", net: -amount,
  amount: -amount, created: at, available_on: at, status: "available", source: { id, amount, status }, ...extra });

test("a mixed-client withdrawal consumes oldest available earnings first, deterministically", () => {
  const tx = [credit("a", 100, 1), credit("b", 200, 2), payout("po_1", 150, 3), payout("po_2", 100, 4)];
  const result = allocatePayouts(tx, payments);
  assert.deepEqual(result.payouts[0].allocations, [{ paymentId: "a", amount: 100 }, { paymentId: "b", amount: 50 }]);
  assert.deepEqual(result.payouts[1].allocations, [{ paymentId: "b", amount: 100 }]);
  assert.deepEqual(allocatePayouts([...tx].reverse(), payments), result);
});
test("unsettled funds cannot finance a payout; settlement order determines FIFO", () => {
  const result = allocatePayouts([credit("a", 100, 1, { available_on: 10 }), credit("b", 100, 2),
    credit("c", 100, 1, { available_on: 0, status: "pending" }), payout("po", 100, 3)], payments);
  assert.deepEqual(result.payouts[0].allocations, [{ paymentId: "b", amount: 100 }]);
  assert.deepEqual(result.pending, [{ paymentId: "c", available_on: 0 }]);
});
test("legacy or unrelated funds are not attributed to a client", () => {
  const result = allocatePayouts([credit("unknown", 100, 1), credit("a", 100, 2), payout("po", 150, 3)], payments);
  assert.deepEqual(result.payouts[0].allocations, [{ paymentId: "a", amount: 50 }]);
});
test("failed payouts return their original earnings for a subsequent withdrawal", () => {
  const result = allocatePayouts([credit("a", 100, 1), payout("po_failed", 100, 2, "failed"), credit("b", 100, 3),
    { id: "txn_return", type: "payout_failure", net: 100, currency: "usd", created: 4, available_on: 4, status: "available", source: { id: "po_failed" } },
    payout("po_ok", 150, 5)], payments);
  assert.equal(result.payouts[0].paid, false);
  assert.deepEqual(result.payouts[1].allocations, [{ paymentId: "a", amount: 100 }, { paymentId: "b", amount: 50 }]);
});
test("processing withdrawals reserve earnings but are not paid out", () => {
  const result = allocatePayouts([credit("a", 100, 1), payout("po", 50, 2, "in_transit"), payout("po_2", 50, 3)], payments);
  assert.equal(result.payouts[0].paid, false);
  assert.equal(result.payouts[1].paid, true);
  assert.equal(result.payouts[1].allocations[0].amount, 50);
});
test("refunds remove their own earning; fees are not counted as bank payouts", () => {
  const result = allocatePayouts([credit("a", 100, 1), credit("b", 200, 2),
    { id: "refund", type: "payment_refund", net: -100, created: 3, currency: "usd", source: { charge: "py_b" } },
    payout("po", 150, 4, "paid", { net: -160 }), payout("po_2", 40, 5)], payments);
  assert.deepEqual(result.payouts[0].allocations, [{ paymentId: "a", amount: 100 }, { paymentId: "b", amount: 50 }]);
  assert.equal(result.payouts[1].allocations[0].amount, 40);
});
test("currency conversion uses actual bank currency and never mixes currency pools", () => {
  const result = allocatePayouts([credit("a", 886, 1, { currency: "eur" }), credit("b", 100, 2),
    payout("po", 100, 3, "paid", { currency: "eur" })], payments);
  assert.equal(result.payouts[0].currency, "EUR");
  assert.deepEqual(result.payouts[0].allocations, [{ paymentId: "a", amount: 100 }]);
});
test("the ledger is fully paginated and the database query is factory-scoped", async () => {
  const tx = [credit("a", 3000, 1), ...Array.from({ length: 30 }, (_, i) => payout(`po_${i}`, 100, i + 2))];
  let scoped = false;
  const db = { from: () => ({ select: () => ({ eq: (key, value) => {
    scoped = key === "production_orders.factory_org_id" && value === "factory";
    return { order: () => ({ range: async () => ({ data: payments, error: null }) }) };
  } }) }) };
  const stripe = { balanceTransactions: { list: () => ({ async *[Symbol.asyncIterator]() { yield* tx; } }) } };
  const result = await payoutAllocationFor(stripe, db, "factory", "acct");
  assert.equal(scoped, true);
  assert.equal(result.payouts.length, 30);
  assert.equal(result.payouts.reduce((s, p) => s + p.allocations[0].amount, 0), 3000);
});
test("client summaries include only their allocated paid withdrawals; account balance stays separate", () => {
  const rows = [
    { id: "a", state: "released", amount_cents: 1000, charged_cents: 1100, currency: "USD", stripe_transfer_id: "tr_a", order: { brand_org_id: "brand-a" } },
    { id: "b", state: "confirmed", amount_cents: 2000, currency: "USD", order: { brand_org_id: "brand-b" } },
  ];
  const balance = { pendingEarnings: [{ paymentId: "a" }], payouts: [{ paid: true, amount: 200, currency: "EUR", allocations: [{ paymentId: "a", amount: 100 }] }] };
  const a = earningsSummaryFor(rows, balance, "brand-a");
  assert.deepEqual(a.total, [{ currency: "USD", amount: 1000 }]);
  assert.deepEqual(a.pending, [{ currency: "USD", amount: 1000 }]);
  assert.deepEqual(a.paid, [{ currency: "EUR", amount: 100 }]);
  assert.deepEqual(earningsSummaryFor(rows, balance, "brand-b").approval, [{ currency: "USD", amount: 2000 }]);
  assert.deepEqual(earningsSummaryFor(rows, balance, "brand-b").paid, []);
  assert.deepEqual(earningsSummaryFor(rows, balance, "All clients").paid, [{ currency: "EUR", amount: 200 }]);
  assert.equal(earningsSummaryFor(rows, null, "brand-a").paid, null);
});
test("a card payment TSC paid out by bank counts as paid out, and never as a balance", () => {
  const rows = [
    { id: "bank", state: "released", amount_cents: 6500, charged_cents: 6955, stripe_transfer_id: null, currency: "USD", order: { brand_org_id: "brand-a" } },
  ];
  assert.deepEqual(earningsSummaryFor(rows, null, "All clients").paid, [{ currency: "USD", amount: 6500 }]);
  assert.equal(earningStatus(rows[0], null), "Paid by bank transfer");
});
test("an earning Stripe is still processing is pending, not credited to the balance", () => {
  const row = { id: "a", state: "released", stripe_transfer_id: "tr_a" };
  assert.equal(earningStatus(row, { pendingEarnings: [{ paymentId: "a", available_on: 10 }] }), "Pending");
  assert.equal(earningStatus(row, { pendingEarnings: [] }), "Credited to balance");
  assert.equal(earningStatus({ state: "confirmed", release_requested_at: "x" }, null), "Pending");
  assert.equal(earningStatus({ state: "confirmed" }, null), "Awaiting approval");
});
