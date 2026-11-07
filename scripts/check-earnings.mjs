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
  awaitingApproval, earningStatus, earningsSummaryFor, factoryAmount, failedWithdrawal, handPaidFigures, heldOnCancelledOrder, isHandPaid, toBeSent,
  staffBankNote, withdrawalRows,
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
assert.equal(usd(summary.pending), usd(hand.balance), "the strip's Pending is the card's balance while nothing is being sent");
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
assert.equal(earningStatus(approved, null), "Pending");
assert.equal(earningStatus(held, null), "Awaiting approval");
assert.equal(earningStatus(earnings.find((row) => row.id === "held-cancelled"), null), "Order cancelled");
assert.equal(earningStatus(earnings.find((row) => row.id === "paid"), null), "Paid");

// Every payment sent has its own withdrawal row, and the figures still add up:
// on All, an earning and its withdrawal net to what is still owed or held.
const attempt = (id, status, extra = {}) => ({ id, provider: "wise", status, paid_to: "Demo Bank ending 0001", amount_cents: 300, created_at: "2026-11-02T00:00:00Z", failure_code: null, paid_at: null, ...extra });
const money = [
  pay("sending", 300, "confirmed", { ...APPROVED, provider_payouts: [attempt("a", "processing")] }),
  pay("bounced", 500, "confirmed", { ...APPROVED, provider_payouts: [attempt("b", "failed", { failure_code: "details_rejected", amount_cents: 500 })] }),
  pay("wise-paid", 700, "released", { provider_payouts: [attempt("c", "paid", { amount_cents: 700, paid_at: "2026-11-03T00:00:00Z" })] }),
  pay("retried-paid", 900, "released", { provider_payouts: [attempt("d", "failed", { failure_code: "other", amount_cents: 900 }), attempt("e", "paid", { amount_cents: 900, paid_at: "2026-11-03T00:00:00Z" })] }),
  pay("by-bank", 1100, "released", { released_by: "staff", released_note: "Wire 77", bank_payouts: { paid_to_bank: "Demo Bank", paid_to_last4: "0001" } }),
  pay("by-payoneer", 1300, "released", { payoneer_payouts: { payoneer_payment_id: "X", paid_to_email: "a@example.com" } }),
  pay("by-stripe", 1500, "released", { stripe_transfer_id: "tr_9" }),
  pay("waiting", 1700, "confirmed"),
];
const rows = withdrawalRows(money);
const sentOut = rows.filter((row) => !row.failed).reduce((sum, row) => sum - row.amount, 0);
assert.equal(sentOut, 300 + 700 + 900 + 1100 + 1300, "each payment sent is one withdrawal; Stripe's come from Stripe; failures never count");
assert.equal(rows.filter((row) => row.failed).length, 2, "a failed attempt keeps its row");
assert.equal(rows.find((row) => row.id === "provider-a").status, "Processing");
assert.equal(rows.find((row) => row.id === "provider-b").note, "Check your bank details", "a refused account says what to do");
assert.equal(rows.find((row) => row.id === "provider-d").note, "TSC will try again", "and one the factory can't fix says so");
assert.ok(rows.every((row) => !/\b\d{5,}\b/.test(row.meta ?? "")), "no row carries a number");
assert.equal(failedWithdrawal(money)?.id, "b", "the card raises a failure on money still owed");
assert.equal(failedWithdrawal(money.filter((row) => row.id !== "bounced")), null, "not one since retried and paid");
const moneyFigures = handPaidFigures(money);
assert.equal(usd(moneyFigures.onItsWay), 300, "being sent is on its way");
assert.equal(usd(moneyFigures.balance), 500, "a failed one is owed again");
const moneySummary = earningsSummaryFor(money.filter((row) => row.id !== "by-stripe"), null, "All clients");
assert.equal(usd(moneySummary.pending), usd(moneyFigures.balance) + usd(moneyFigures.onItsWay), "Pending is balance + on its way");
assert.equal(usd(moneySummary.total), usd(moneySummary.approval) + usd(moneySummary.pending) + usd(moneySummary.paid), "total = awaiting + pending + paid out");
assert.equal(factoryAmount(money[0]), 300);

// Staff's bank note reaches the factory only if a person typed one.
const bankPaid = { state: "released", released_by: "staff", released_note: " Wire ref HSBC-7788 " };
assert.equal(staffBankNote(bankPaid), "Wire ref HSBC-7788", "a typed note is shown, trimmed");
assert.equal(staffBankNote({ ...bankPaid, released_note: null }), null, "no note, nothing shown");
assert.equal(staffBankNote({ state: "released", released_by: null, stripe_transfer_id: "tr_1", released_note: "Paid out through Stripe." }), null, "Stripe's own sentence is not staff's note");
assert.equal(staffBankNote({ ...bankPaid, released_by: null }), null, "written by nobody: not staff's note");
assert.equal(staffBankNote({ ...bankPaid, payoneer_payouts: { payoneer_payment_id: "X" } }), null, "a Payoneer row says its ID instead");
assert.equal(staffBankNote({ ...bankPaid, state: "confirmed" }), null, "not paid yet");

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

// Queena: a factory never reads Stripe, "by hand" or an upgrade it did not ask for.
for (const file of ["StripePayoutCard.jsx", "PayoutDetails.jsx", "PayoutSetupSteps.jsx", "AddPayoutMethodForm.jsx", "payment-summary.mjs"]) {
  const code = readFileSync(new URL(`../src/app/order/${file}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [, text] of code.matchAll(/(?:>|["'`])([^<>"'`{}]*\b(?:Stripe|by hand|Upgrade payout)\b[^<>"'`{}]*)(?:<|["'`])/g)) {
    assert.ok(/^(?:[./\w@-]+|\s*)$/.test(text) && !/\s/.test(text.trim()), `${file} says "${text.trim()}" to a factory`);
  }
}

console.log("earnings figures: every state in one place, adding up, same rules as the board");
