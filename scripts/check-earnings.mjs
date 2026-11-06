/**
 * What a factory's Earnings page says about where its money is.
 *
 * A factory paid by hand once read "By Payoneer" where its balance belongs, and
 * money held on a cancelled order counted as earnings while staff refunded it
 * to the brand. This pins: every payment state lands in one figure at most, the
 * figures add up to Total earnings, they follow the staff board's buckets, and
 * a factory paid through Stripe keeps Stripe's answer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  awaitingApproval, earningStatus, earningsSummaryFor, handPaidFigures, heldOnCancelledOrder, isHandPaid, toBeSent,
} from "../src/app/order/payment-summary.mjs";

const usd = (rows) => rows.reduce((sum, row) => sum + row.amount, 0);
const pay = (id, amount, state, extra = {}) => ({
  id, amount_cents: amount, currency: "USD", state, charged_cents: amount, release_requested_at: null, stripe_transfer_id: null,
  order: { brand_org_id: "brand-1", status: "active" }, ...extra,
});
const APPROVED = { release_requested_at: "2026-11-01T00:00:00Z" };
const CANCELLED = { order: { brand_org_id: "brand-1", status: "cancelled" } };

const earnings = [
  pay("not-due", 1, "not_due"), pay("due", 2, "due"), pay("clearing", 4, "processing"), pay("failed", 8, "failed"),
  pay("held", 100, "confirmed"),
  pay("approved", 200, "confirmed", APPROVED),
  pay("approved-then-cancelled", 400, "confirmed", { ...APPROVED, ...CANCELLED }),
  pay("held-cancelled", 800, "confirmed", CANCELLED),
  pay("paid", 1600, "released", { payoneer_payouts: { payoneer_payment_id: "X" } }),
];

const hand = handPaidFigures(earnings);
assert.equal(usd(hand.pending), 100, "pending is funded and waiting for the brand");
assert.equal(usd(hand.balance), 600, "balance is approved and not sent, also when cancelled after the approval");

const summary = earningsSummaryFor(earnings, null, "All clients");
assert.equal(usd(summary.approval), usd(hand.pending), "Awaiting approval is the card's pending");
assert.equal(usd(summary.pending), usd(hand.balance), "To be sent is the card's balance");
assert.equal(usd(summary.paid), 1600, "Paid out is what TSC sent");
assert.equal(usd(summary.total), usd(hand.balance) + usd(hand.pending) + usd(summary.paid), "total = balance + pending + paid out");

// Nothing is in two figures, and money held on a cancelled order is in none.
for (const row of earnings) {
  const buckets = [awaitingApproval(row), toBeSent(row), row.state === "released", heldOnCancelledOrder(row)].filter(Boolean);
  assert.ok(buckets.length <= 1, `${row.id} is in one place at most`);
}

// The words, in each branch.
const held = earnings.find((row) => row.id === "held");
const approved = earnings.find((row) => row.id === "approved");
assert.equal(earningStatus(approved, null, true), "To be sent");
assert.equal(earningStatus(approved, null, false), "Pending", "a Stripe factory's approved row keeps its word");
assert.equal(earningStatus(held, null, true), "Awaiting approval");
assert.equal(earningStatus(earnings.find((row) => row.id === "held-cancelled"), null, true), "Order cancelled");
assert.equal(earningStatus(earnings.find((row) => row.id === "paid"), null, true), "Paid by Payoneer");

// Who is paid by hand. Loading earnings (null) does not count as Stripe-paid.
const transferred = [pay("t", 5, "released", { stripe_transfer_id: "tr_1" })];
assert.equal(isHandPaid(null, earnings), true, "no Stripe account");
assert.equal(isHandPaid({ transfers_active: false }, earnings), true, "Stripe setup not finished, nothing paid through it");
assert.equal(isHandPaid({ transfers_active: true }, earnings), false, "Stripe can take transfers");
assert.equal(isHandPaid({ transfers_active: false }, transferred), false, "paid through Stripe before");
assert.equal(isHandPaid(null, null), true);

// A factory paid through Stripe still waits for Stripe's answer.
const stripeSummary = earningsSummaryFor(transferred, null, "All clients");
assert.equal(stripeSummary.paid, null, "Paid out cannot be known without Stripe");
const answered = earningsSummaryFor(transferred, { pendingEarnings: [{ paymentId: "t" }], payouts: [] }, "All clients");
assert.equal(usd(answered.pending), 5, "Stripe's pending earning is Pending");

// The same rules as the staff board's buckets. A change there must change here.
const board = readFileSync(new URL("../src/app/admin/AdminPayments.jsx", import.meta.url), "utf8");
for (const rule of [
  'payout: rows.filter((row) => row.state === "confirmed" && row.release_requested_at)',
  'held: rows.filter((row) => row.state === "confirmed" && !row.release_requested_at && !cancelled(row))',
]) {
  assert.ok(board.includes(rule), `the board's rule changed; check payment-summary.mjs: ${rule}`);
}

// A hand-paid card never goes back to saying how it is paid in place of a figure.
const card = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
assert.ok(!/"By Payoneer"|"By bank transfer"/.test(card), "the card's headline is the balance");

console.log("earnings figures: every state in one place, adding up, same rules as the board");
