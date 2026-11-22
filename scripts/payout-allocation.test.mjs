import test from "node:test";
import assert from "node:assert/strict";
import { allocatePayouts, payoutAllocationFor } from "../api/_payout-allocation.js";
import { ADDED_TO_BALANCE, earningStatus, figuresByPayment, stripeRelevant, summaryFrom } from "../src/app/order/payment-summary.mjs";

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
  let takesScoped = false;
  const db = { from: (table) => ({ select: () => ({ eq: (key, value) => {
    if (table === "payment_takes") {
      // A step withdrawn through Stripe in parts has a transfer per part (20261120200000).
      takesScoped = key === "org_id" && value === "factory";
      const chain = { not: () => chain, order: () => chain, range: async () => ({ data: [], error: null }) };
      return chain;
    }
    scoped = key === "production_orders.factory_org_id" && value === "factory";
    return { order: () => ({ range: async () => ({ data: payments, error: null }) }) };
  } }) }) };
  const stripe = { balanceTransactions: { list: () => ({ async *[Symbol.asyncIterator]() { yield* tx; } }) } };
  const result = await payoutAllocationFor(stripe, db, "factory", "acct");
  assert.equal(scoped, true);
  assert.equal(takesScoped, true, "the Stripe takes are read for this factory only");
  assert.equal(result.payouts.length, 30);
  assert.equal(result.payouts.reduce((s, p) => s + p.allocations[0].amount, 0), 3000);
});
// The figures come from the server (factory_balance, per client with
// target_client): the page never sums payments itself (D3, 20261120100000).
// The per-client and "paid out by bank" rules these tests pinned on the
// retired earningsSummaryFor() are pinned in supabase/tests/unified_balance_test.sql.
test("the figures are the server's, and Total is their sum (withdrawals in progress included)", () => {
  const figures = { awaiting_cents: 2000, available_cents: 1000, pending_cents: 300, processing_cents: 400, paid_out_cents: 6500 };
  assert.deepEqual(summaryFrom(figures), { total: 10200, approval: 2000, available: 1000, pending: 300, processing: 400, paid: 6500 });
});
test("before the figures are read, every figure is unknown, never zero", () => {
  assert.deepEqual(summaryFrom(null), { total: undefined, approval: undefined, pending: undefined, processing: undefined, paid: undefined });
});
test("a step split between figures is in each once", () => {
  const map = figuresByPayment({ rows: [
    { payment_id: "a", figure: "available", amount_cents: 500 },
    { payment_id: "a", figure: "pending", amount_cents: 500 },
    { payment_id: "b", figure: "paid_out", amount_cents: 0 },
  ] });
  assert.deepEqual([...map.get("a")].sort(), ["available", "pending"]);
  assert.equal(map.has("b"), false, "an empty part is no figure");
});
test("one word per earning: paid by bank is Paid; approved money is in the balance, never Pending unless its figure is", () => {
  assert.equal(earningStatus({ id: "bank", state: "released", stripe_transfer_id: null }), "Paid");
  assert.equal(earningStatus({ id: "a", state: "confirmed", release_requested_at: "x" }), ADDED_TO_BALANCE);
  assert.equal(earningStatus({ id: "a", state: "confirmed", release_requested_at: "x" }, null, new Map([["a", new Set(["pending"])]])), "Pending");
  assert.equal(earningStatus({ state: "confirmed" }), "Awaiting approval");
});
test("Stripe matters only once a step was paid by a Stripe transfer", () => {
  const rows = [
    { id: "s", state: "released", stripe_transfer_id: "tr_s" },
    { id: "r", state: "confirmed", release_requested_at: "x" },
  ];
  assert.equal(stripeRelevant(rows), true);
  assert.equal(stripeRelevant(rows.slice(1)), false);
  assert.equal(stripeRelevant(null), false);
});
