/**
 * What a factory's Earnings page says about where its money is.
 *
 * One balance (D3): the four figures and the card's Available balance come
 * from the server only (factory_balance(), plus the factory's own Stripe
 * money from /api/stripe-connect `balance`), Total earnings is the four added
 * up, and each row's word agrees with where the server put its money. This
 * pins those, the cases a person saw wrong (IMG 75, 76, 45), and the words
 * each payment state reads, on Payments and the order page alike.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  awaitingApproval, clearingFor, clearingNote, earningPaid, earningStatus, factoryAmount, figuresByPayment, heldOnCancelledOrder, toBeSent,
  ON_HOLD, ON_ITS_WAY, companyStripeRows, pendingParts, legacyOnItsWayCents, owedClearingNote, parseWithdrawAmount, withdrawFeeLine, refundPendingWord, stillClearing, staffBankNote, summaryFrom, withStripePart, withdrawReach, withdrawalProblem, withdrawalRows,
} from "../src/app/order/payment-summary.mjs";
import { balanceFigures } from "../api/_balance-figures.js";

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

/** factory_balance() as the database answers it, with only what a case sets. */
const tsc = (over = {}, parts = {}, rows = []) => ({
  currency: "USD", client: null, awaiting_cents: 0, available_cents: 0, pending_cents: 0, paid_out_cents: 0, has_method: true, next_cleared_at: null,
  parts: { owed_cleared_cents: 0, owed_clearing_cents: 0, owed_moving_cents: 0, pool_available_cents: 0, pool_open_cents: 0, pool_paid_cents: 0,
    withdrawal_fees_cents: 0, stripe_released_cents: 0, other_released_cents: 0, ...parts },
  rows, ...over,
});
const sumOfFour = (s) => s.approval + s.available + s.pending + s.paid;
/** Every case: Total is the four added up, on the page and in the server's answer. */
function checkTotal(figures, label) {
  const s = summaryFrom(figures);
  assert.equal(s.total, sumOfFour(s), `${label}: Total earnings is the sum of the four figures`);
  if (figures.total_cents != null) assert.equal(s.total, Number(figures.total_cents), `${label}: and the server's own total`);
  return s;
}
const row = (payment_id, figure, amount_cents) => ({ payment_id, figure, amount_cents, stripe: false });

// Nothing until the figures answer: placeholders, never a guess.
assert.deepEqual(summaryFrom(null), { total: undefined, approval: undefined, pending: undefined, paid: undefined });
assert.deepEqual(withdrawReach(null), { stripe: null, balance: null, estimated: false });

// IMG 75: a $1 step approved, no withdrawal method. Available $1, Pending $0,
// and the row says "Added to your balance", never "Pending". The card offers
// "Add withdrawal method" (has_method false).
{
  const owed = pay("bulk", 100, "confirmed", APPROVED);
  const figures = balanceFigures(tsc({ available_cents: 100, has_method: false }, { owed_cleared_cents: 100 }, [row("bulk", "available", 100)]), null, null);
  const s = checkTotal(figures, "IMG 75");
  assert.equal(s.available, 100, "IMG 75: Available $1");
  assert.equal(s.pending, 0, "IMG 75: Pending $0");
  assert.equal(s.total, 100, "IMG 75: Total $1");
  assert.equal(figures.has_method, false, "IMG 75: no method, so Add withdrawal method");
  assert.equal(earningStatus(owed, null, figuresByPayment(figures)), "Added to your balance", "IMG 75: the row is in the balance");
  assert.equal(earningStatus(owed), "Added to your balance", "and the order page says the same without the figures");
  assert.equal(earningPaid(owed, null, figuresByPayment(figures)), true, "drawn as money the factory has");
}

// IMG 76: PayPal added. Nothing moves: still Available $1, Paid out $0.
{
  const figures = balanceFigures(tsc({ available_cents: 100 }, { owed_cleared_cents: 100 }, [row("bulk", "available", 100)]), null, null);
  const s = checkTotal(figures, "IMG 76");
  assert.equal(s.available, 100, "IMG 76: Available $1");
  assert.equal(s.paid, 0, "IMG 76: Paid out $0, adding a method pays nothing out");
  assert.equal(figures.has_method, true, "IMG 76: Withdraw");
  assert.deepEqual(withdrawReach(figures), { stripe: 100, balance: 100, estimated: false }, "IMG 76: PayPal reaches the $1");
}

// IMG 45: $1 withdrawn by PayPal, $0.02 fee. Paid out $0.98, Total $0.98:
// the fee is in no figure.
{
  const figures = balanceFigures(tsc({ paid_out_cents: 98 }, { pool_paid_cents: 100, withdrawal_fees_cents: 2 }, [row("y1", "paid_out", 100)]), null, null);
  const s = checkTotal(figures, "IMG 45");
  assert.equal(s.paid, 98, "IMG 45: Paid out $0.98");
  assert.equal(s.total, 98, "IMG 45: Total $0.98");
  assert.equal(s.available, 0, "IMG 45: nothing left to withdraw");
  const asked = withdrawalRows([]);
  assert.deepEqual(asked, [], "a balance withdrawal is listed from factory_withdrawals, not from its step");
}

// A factory with money already in its own Stripe account (D1) and money TSC
// owes it. Stripe reaches both; PayPal or Wise reaches only what TSC holds.
{
  const db = tsc({ awaiting_cents: 700, available_cents: 500, pending_cents: 250, paid_out_cents: 900 },
    { owed_cleared_cents: 500, owed_clearing_cents: 250, stripe_released_cents: 900 },
    [row("a1", "awaiting", 700), row("o1", "available", 500), row("o2", "pending", 250), row("s1", "paid_out", 900)]);
  const figures = balanceFigures(db, {
    available: [{ amount: 300, currency: "usd" }], pending: [{ amount: 100, currency: "usd" }],
    onTheirWay: [{ amount: 50, currency: "usd" }], payouts: [{ amount: 450, currency: "usd", paid: true }],
  }, null);
  // The owner's page (the balance answer, kept fresh by withStripePart) and a
  // member's (the figures action) are the same function's answer: identical.
  const s = checkTotal(withStripePart(db, figures), "mixed D1 + owed");
  const member = checkTotal(figures, "mixed, as a member reads it (figures action)");
  assert.deepEqual(s, member, "owner and member read the same four figures");
  assert.equal(s.available, 800, "mixed: TSC's $5 + the $3 in its Stripe account");
  assert.equal(s.pending, 250 + 100 + 50, "mixed: clearing card payment + Stripe pending + payout on its way");
  assert.deepEqual(withdrawReach(figures), { stripe: 800, balance: 500, estimated: false }, "mixed: Stripe reaches $8, PayPal/Wise $5 (never the Stripe account's)");
  const placed = figuresByPayment(figures);
  const clearingStep = pay("o2", 250, "confirmed", { ...APPROVED, funds_available_at: "2099-01-05T12:00:00Z" });
  assert.equal(earningStatus(clearingStep, null, placed), "Pending", "a card payment still clearing reads Pending, as its figure does");
  assert.match(owedClearingNote(clearingStep, placed) ?? "", /^Available [A-Z][a-z]{2} \d{1,2}$/, "with the day it can be withdrawn");
  assert.equal(owedClearingNote(pay("o1", 500, "confirmed", APPROVED), placed), null, "an available step has no such note");
  assert.equal(earningStatus(pay("o1", 500, "confirmed", APPROVED), null, placed), "Added to your balance");
  assert.equal(earningStatus(pay("a1", 700, "confirmed"), null, placed), "Awaiting approval");
  // A brand approves while the page is open: the database is read again and
  // the Stripe part is kept, so the figures move without asking Stripe.
  const later = { ...db, awaiting_cents: 0, available_cents: 1200, parts: { ...db.parts, owed_cleared_cents: 1200 } };
  const merged = withStripePart(later, figures);
  const m = checkTotal(merged, "after an approval");
  assert.equal(m.approval, 0, "the approved step leaves Awaiting approval");
  assert.equal(m.available, 1500, "and joins Available, the Stripe $3 kept");
  assert.equal(m.total, s.total, "Total is unchanged: the money only moved");
  assert.deepEqual(withdrawReach(merged), { stripe: 1500, balance: 1200, estimated: false });
  // The server's own reach comes first: Stripe's from the balance read (only
  // steps paid by card count), PayPal's and Wise's from my_withdrawal_balance().
  assert.deepEqual(withdrawReach(figures, { stripe_cents: 700, pool_cents: 500, estimated: false }, null), { stripe: 700, balance: 500, estimated: false }, "the balance read's top-level reach");
  assert.deepEqual(withdrawReach(figures, { stripe_cents: 700, pool_cents: 450, estimated: true }, 500), { stripe: 700, balance: 450, estimated: true }, "reach.pool_cents first; the Stripe amount says when it was converted");
  assert.deepEqual(withdrawReach(figures, null, 500), { stripe: 800, balance: 500, estimated: false }, "no Stripe read (members, no Stripe account): my_withdrawal_balance() for PayPal and Wise");
  const cardCode = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  assert.ok(cardCode.includes("withdrawReach(figures, freshReach ?? balance?.reach ?? null, fromBalance.available)") && !cardCode.includes("figures?.reach"), "reach is read only at the server's top level");
  // Re-test: the dialog's Available is read again after anything that moves money and when Withdraw opens.
  assert.ok(cardCode.includes('connectAction(org.id, "figures")') && cardCode.includes("await Promise.all([readReach(), fromBalance.load()])")
    && cardCode.includes("setWithdrawal((was) => (was ? { ...was, max: liveStripeMax } : was))"), "each method's Available is never stale");
  assert.ok(cardCode.includes('withdrawal.estimated ? "Amount (estimated USD)"'), "a converted Stripe reach says estimated USD");
  assert.equal(withStripePart(db, null), db, "no Stripe read: the database's figures as they are");
  assert.equal(withStripePart(null, figures), figures, "no database read yet: the Stripe answer as it is");
}

// Stripe unreachable: the server answers 502 with the database's figures; the
// card shows them rather than a blank.
{
  const fallback = { ...balanceFigures(tsc({ available_cents: 100 }, { owed_cleared_cents: 100 }), null, null), stripe_unavailable: true };
  const s = checkTotal(fallback, "Stripe unreachable");
  assert.equal(s.available, 100);
  assert.equal(withdrawReach(fallback).stripe, 100, "only what TSC holds, never a guess at the Stripe account");
}

// A partial withdrawal (P1, exact amount): $10 owed, $4 asked for by PayPal.
// $6 stays Available, $4 is Pending until paid; once paid with a $0.10 fee,
// Paid out $3.90 and Total $9.90.
{
  const step = pay("p1", 1000, "confirmed", { ...APPROVED, withdrawal_pool: true });
  const asked = balanceFigures(tsc({ available_cents: 600, pending_cents: 400 }, { pool_available_cents: 600, pool_open_cents: 400 },
    [row("p1", "pending", 400), row("p1", "available", 600)]), null, null);
  const a = checkTotal(asked, "partial, asked");
  assert.equal(a.available, 600, "partial: the rest of the step stays Available");
  assert.equal(a.pending, 400, "partial: exactly the amount asked for is Pending");
  assert.equal(withdrawReach(asked).balance, 600, "partial: the rest can be withdrawn by any method");
  assert.equal(earningStatus(step, null, figuresByPayment(asked)), "Added to your balance", "partial: the step is still in the balance, not Pending");
  const paid = balanceFigures(tsc({ available_cents: 600, paid_out_cents: 390 }, { pool_available_cents: 600, pool_paid_cents: 400, withdrawal_fees_cents: 10 },
    [row("p1", "paid_out", 400), row("p1", "available", 600)]), null, null);
  const p = checkTotal(paid, "partial, paid");
  assert.equal(p.paid, 390, "partial: Paid out is what arrived");
  assert.equal(p.total, 990, "partial: Total less the fee");
}

// N7: a step still clearing reads Pending from the payment alone, so the order
// page (no figures) and Payments say the same word.
{
  const clearingStep = pay("c1", 500, "confirmed", { ...APPROVED, funds_available_at: "2099-01-05T12:00:00Z" });
  assert.equal(stillClearing(clearingStep), true);
  assert.equal(earningStatus(clearingStep), "Pending", "the order page: Pending while the card payment clears");
  assert.equal(earningStatus(clearingStep, null, new Map([["c1", new Set(["pending"])]])), "Pending", "Payments: the same word");
  const cleared = { ...clearingStep, funds_available_at: "2020-01-01T00:00:00Z" };
  assert.equal(earningStatus(cleared), "Added to your balance", "once cleared, in the balance on both");
  assert.equal(earningStatus({ ...clearingStep, withdrawal_pool: true }), "Added to your balance", "old pool money is never clearing");
}

// N4: an old step-by-step payout still being sent is "on its way", not
// "pending … once processing finishes"; one failed and waiting for staff too.
{
  const attemptOf = (status) => ({ id: `a-${status}`, provider: "wise", status, amount_cents: 300, created_at: "2026-11-02T00:00:00Z", money_left_at: "2026-11-02T00:00:00Z" });
  const rows = [
    pay("sending", 300, "confirmed", { ...APPROVED, provider_payouts: [attemptOf("processing")] }),
    pay("bounced", 500, "confirmed", { ...APPROVED, provider_payouts: [attemptOf("failed")] }),
    pay("clearing", 700, "confirmed", APPROVED),
    pay("free", 900, "confirmed", { ...APPROVED, provider_payouts: [attemptOf("failed")] }),
  ];
  const placed = new Map([["sending", new Set(["pending"])], ["bounced", new Set(["pending"])], ["clearing", new Set(["pending"])], ["free", new Set(["available"])]]);
  assert.equal(legacyOnItsWayCents(rows, placed), 800, "processing and failed-for-staff steps the server holds in Pending");
  assert.equal(legacyOnItsWayCents(rows, new Map()), 0, "nothing without the server's figures");
}

// F6: a step released by one-balance withdrawals is listed once, by its
// withdrawal, never as an extra "Bank transfer — Completed".
{
  const base = { order: { brand_org_id: "brand-1", status: "active" }, released_by: "staff-1", released_at: "2026-11-20T00:00:00Z" };
  const byPaypal = pay("w1", 1000, "released", { ...base, released_note: "Withdrawn", payment_takes: [{ status: "sent" }] });
  const mixed = pay("w2", 1000, "released", { ...base, released_note: "Withdrawn", payment_takes: [{ status: "sent" }, { status: "sent" }] });
  const noEmbed = pay("w3", 1000, "released", { ...base, released_note: "Withdrawn" });
  assert.deepEqual(withdrawalRows([byPaypal, mixed, noEmbed]), [], "no second withdrawal row for money a withdrawal took");
  assert.equal(staffBankNote(byPaypal), null, "and no staff reference on it");
  const byBank = pay("w4", 1000, "released", { ...base, released_note: "Wire 9", bank_payouts: { paid_to_bank: "Demo Bank", paid_to_last4: "0001" } });
  assert.equal(withdrawalRows([byBank]).length, 1, "staff's bank payout keeps its row");
}

// Re-test (fix round 6): the card's "$X pending" is the Pending figure itself.
{
  const cardCode = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  // The card's lines under the balance add up to the Pending figure exactly:
  // clearing ("$X pending. Available to withdraw on …"), on its way, on hold.
  assert.ok(cardCode.includes("const pendingLines = pendingParts(figures)") && cardCode.includes("const cardPending = pendingLines.clearing;"), "the card draws the three lines from pendingParts");
  const sum = (p) => p.clearing + p.onItsWay + p.onHold;
  const cases = [
    { pending_cents: 187079, parts: { owed_clearing_cents: 11500, disputed_cents: 0 }, stripe: { pending_cents: 0 } },
    { pending_cents: 2000, parts: { owed_clearing_cents: 0, disputed_cents: 0 } },
    { pending_cents: 16500, parts: { owed_clearing_cents: 6500, disputed_cents: 5000 }, stripe: { pending_cents: 1000 } },
    { pending_cents: 500, parts: { owed_clearing_cents: 6500, disputed_cents: 5000 } },
  ];
  for (const figures of cases) {
    const p = pendingParts(figures);
    assert.equal(sum(p), figures.pending_cents, `the lines add up to Pending (${figures.pending_cents})`);
    assert.ok(p.clearing >= 0 && p.onItsWay >= 0 && p.onHold >= 0, "no line below zero");
  }
  assert.deepEqual(pendingParts(cases[0]), { pending: 187079, clearing: 11500, onHold: 0, onItsWay: 175579 }, "withdrawals on their way are not 'available to withdraw'");
  assert.equal(pendingParts(cases[1]).clearing, 0, "only withdrawals pending: no 'available to withdraw on' line");
  assert.equal(pendingParts(null), null);
  // A refunded earning stays listed, in no figure.
  const refunded = pay("r1", 6500, "failed", { ...APPROVED, confirmed_at: "2026-11-19T00:00:00Z", refunded_at: "2026-11-20T00:00:00Z" });
  assert.equal(earningStatus(refunded), "Refunded");
  assert.equal(earningPaid(refunded), false);
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes('|| refundedEarning(row));') && page.includes("payout_arrives_on"), "refunded rows stay on the list; Stripe's arrival is read as its day");
}

// Fix round 6b: Stripe's arrival is a day; "On its way" until that day, even once paid.
{
  const now = new Date(2026, 10, 22, 23, 0); // Nov 22, 11 pm where the reader is
  const [row] = companyStripeRows([{ id: "z", payout_id: "po_z", usd_cents: 2000, fee_cents: 40, payout_status: "paid", payout_arrives_on: "2026-11-23", created_at: "2026-11-20T10:00:00Z" }], () => null, now);
  assert.equal(row.status, ON_ITS_WAY, "paid by Stripe, but its arrival day is tomorrow");
  assert.equal(row.arrives.getDate(), 23, "the arrival day is read as that day, not an instant");
  const [arrived] = companyStripeRows([{ id: "y", payout_id: "po_y", usd_cents: 2000, fee_cents: 40, payout_status: "paid", payout_arrives_on: "2026-11-23", created_at: "2026-11-20T10:00:00Z" }], () => null, new Date(2026, 10, 23, 9, 0));
  assert.equal(arrived.status, "Paid out to your bank", "and at the bank from that day");
  const form = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(form.includes("returnable.get(w.id)") && form.includes("total > 0 ? `Back to your balance: ${formatMoney(total, \"USD\")}` : NOTHING_BACK"),
    "cancelling says what really comes back, or that nothing does after a refund");
}

// Fix round 5 (local tester).
{
  // M5: a disputed step is On hold, never "Available <day>", on both pages.
  const disputed = pay("d1", 500, "confirmed", { ...APPROVED, disputed_at: "2026-11-20T00:00:00Z", funds_available_at: "2099-01-05T12:00:00Z" });
  assert.equal(earningStatus(disputed), ON_HOLD);
  assert.equal(earningStatus(disputed, null, new Map([["d1", new Set(["pending"])]])), ON_HOLD);
  assert.equal(owedClearingNote(disputed, new Map([["d1", new Set(["pending"])]])), null, "no date for held money");
  // M4: a step all withdrawn reads Paid, whichever road took it.
  const sentByStripe = pay("s1", 6500, "released", { ...APPROVED, stripe_transfer_id: "tr_1", released_note: "Withdrawn", payment_takes: [{ status: "sent" }] });
  assert.equal(earningStatus(sentByStripe), "Paid", "a step a Stripe withdrawal took and sent is paid");
  assert.equal(earningStatus(pay("s2", 6500, "released", { stripe_transfer_id: "tr_2" })), "Added to your balance", "an old transfer to the Stripe balance is as before");
  // M3/M4: the company's Stripe withdrawals, for owner and member alike, from stripe_withdrawals.
  const now = new Date("2026-11-20T12:00:00Z");
  const rows = companyStripeRows([
    { id: "a", payout_id: "po_1", usd_cents: 1000, fee_cents: 32, payout_status: "paid", payout_arrives_at: "2026-11-23T00:00:00Z", created_at: "2026-11-20T10:00:00Z" },
    { id: "b", payout_id: "po_2", usd_cents: 2000, fee_cents: 50, payout_status: "paid", payout_arrives_at: "2026-11-19T00:00:00Z", created_at: "2026-11-18T10:00:00Z" },
    { id: "c", payout_id: "po_3", usd_cents: 500, fee_cents: 0, payout_status: "failed", created_at: "2026-11-18T10:00:00Z" },
    { id: "d", payout_id: null, usd_cents: 500, created_at: "2026-11-18T10:00:00Z" },
  ], () => null, now);
  assert.equal(rows.length, 3, "only withdrawals that made a payout");
  assert.equal(rows[0].status, ON_ITS_WAY, "paid by Stripe but not at the bank until its arrival day");
  assert.equal(rows[0].note, "Your bank is processing the payout.", "the processing sentence sits on its own row");
  assert.equal(rows[0].amount, -968, "what reaches the bank: the withdrawal less Stripe's fee");
  assert.equal(rows[1].status, "Paid out to your bank");
  assert.equal(rows[1].note, "Fee $0.50, taken from it", "the fee in the PayPal row's words");
  assert.equal(rows[2].failed, true);
  // Minor: the amount is read as typed, never clamped.
  assert.equal(parseWithdrawAmount("65.01", 6500).problem, "You can withdraw up to $65.00.");
  assert.equal(parseWithdrawAmount("1,000", 200000).cents, 100000, "a thousands comma is read as meant");
  assert.equal(parseWithdrawAmount("0.001", 6500).problem, "Enter the amount in dollars and cents, like 45.50.");
  for (const bad of ["-5", "abc", "", "0"]) assert.equal(parseWithdrawAmount(bad, 6500).problem, "Enter an amount to withdraw.", bad);
  // M7: the fee and what arrives, before asking, in the factory's existing sentence.
  assert.equal(withdrawFeeLine(89, 4411), "Payout fee $0.89 is taken from this payment: you receive $44.11.");
  const form = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(form.includes('data-testid="withdraw-fee"') && !form.includes("Reload the page to see it"), "the PayPal/Wise dialog shows its fee; a refusal needs no reload");
  assert.ok(!/setAmountText\(Number\(value\) > available/.test(form), "the amount is never clamped");
}

// Money held on a cancelled order is in no figure; approved before the
// cancellation it is still owed.
assert.equal(earningStatus(earnings.find((r) => r.id === "approved-then-cancelled")), "Added to your balance");

// Nothing is in two figures, and money held on a cancelled order is in none.
for (const row of earnings) {
  const buckets = [awaitingApproval(row), toBeSent(row), row.state === "released", heldOnCancelledOrder(row)].filter(Boolean);
  assert.ok(buckets.length <= 1, `${row.id} is in one place at most`);
}

// The words, in each branch.
const held = earnings.find((row) => row.id === "held");
const approved = earnings.find((row) => row.id === "approved");
assert.equal(earningStatus(approved), "Added to your balance", "approved money is in the balance (D3), never Pending");
assert.equal(earningStatus(held), "Awaiting approval");
assert.equal(earningStatus(earnings.find((row) => row.id === "held-cancelled")), "Order cancelled");
assert.equal(earningStatus(earnings.find((row) => row.id === "paid")), "Paid");
// What the brand reads for the same money: held on a cancelled order is on its way back, approved first is still owed.
assert.equal(refundPendingWord({ state: "confirmed", release_requested_at: null }, { status: "cancelled" }), "Refund pending");
assert.equal(refundPendingWord({ state: "confirmed", release_requested_at: null }, { status: "active" }), null);
assert.equal(refundPendingWord({ state: "confirmed", ...APPROVED }, { status: "cancelled" }), null);
assert.equal(refundPendingWord({ state: "cancelled", refunded_at: "2026-11-02T00:00:00Z" }, { status: "cancelled" }), null);
assert.equal(earningStatus.length, 1, "the word comes from the payment alone, so owner and member read the same");

// Every payment sent has its own withdrawal row, and the figures still add up:
// on All, an earning and its withdrawal net to what is still owed or held.
const attempt = (id, status, extra = {}) => ({ id, provider: "wise", status, paid_to: "Demo Bank ending 0001", amount_cents: 300, created_at: "2026-11-02T00:00:00Z", failure_code: null, paid_at: null, ...extra });
const money = [
  pay("sending", 300, "confirmed", { ...APPROVED, provider_payouts: [attempt("a", "processing", { money_left_at: "2026-11-02T00:00:00Z" })] }),
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
assert.ok(rows.find((row) => row.id === "provider-b").amount < 0, "a failed row keeps its sign, struck through");
assert.equal(rows.find((row) => row.id === "provider-d").note, "The payment did not go through. Check your payout details or contact TSC operations", "and one with no known reason says what to do");
// Why it failed, from the provider's code (src/shared/payout-failure-words.mjs).
const bouncedBack = withdrawalRows([pay("bounced-back", 500, "confirmed", { ...APPROVED, provider_payouts: [attempt("f", "failed", { failure_code: "other", failure_detail: "bounced_back", amount_cents: 500 })] })]);
assert.equal(bouncedBack[0].note, "Your bank returned the payment. Check your bank details: TSC pays again once they are right", "a known code says why");
assert.equal(withdrawalProblem([pay("returned", 500, "confirmed", { ...APPROVED, provider_payouts: [attempt("g", "failed", { provider: "paypal", failure_code: "other", failure_detail: "RETURNED", amount_cents: 500 })] })])?.line,
  "A withdrawal failed. PayPal returned the payment: nothing arrived. Check your PayPal address: TSC pays again once it is right.", "and the card says the same");
assert.equal(earningStatus(money.find((row) => row.id === "by-stripe")), "Added to your balance", "a Stripe transfer is in the factory's balance, not its bank");
assert.equal(earningStatus(money.find((row) => row.id === "wise-paid")), "Paid");
assert.ok(rows.every((row) => !/\b\d{5,}\b/.test(row.meta ?? "")), "no row carries a number");
assert.equal(withdrawalProblem(money)?.line, "A withdrawal failed. Check your bank details.", "the card raises a failure on money still owed");
assert.equal(withdrawalProblem(money.filter((row) => row.id !== "bounced")), null, "not one since retried and paid");
assert.equal(withdrawalProblem(money, { details_changed_at: "2026-11-05T00:00:00Z" }), null, "nor once the details have changed since");
const unclaimed = [pay("held-by-paypal", 12000, "confirmed", { ...APPROVED, provider_payouts: [attempt("p", "processing", { provider: "paypal", amount_cents: 12000, currency: "USD", paid_to: "a@example.com", money_left_at: "2026-11-03T00:00:00Z", details_asked_at: "2026-11-03T00:00:00Z" })] })];
assert.equal(withdrawalProblem(unclaimed)?.line, "Your payment of $120.00 is waiting. Check your PayPal address.", "the page says what the bell says");
assert.equal(withdrawalRows(unclaimed)[0].note, "Check your PayPal address");
assert.equal(withdrawalRows(unclaimed)[0].status, "Waiting");
// A corrected address stops asking, and the money is still at the old one: neither "on its way" nor silence.
const corrected = { paypal_email: "new@example.com", details_changed_at: "2026-11-04T00:00:00Z" };
assert.equal(withdrawalProblem(unclaimed, corrected)?.line, "Your payment of $120.00 is waiting. TSC will send it again.");
assert.equal(withdrawalProblem(unclaimed, corrected)?.fixable, false);
assert.equal(withdrawalRows(unclaimed, corrected)[0].note, "TSC will send it again");
assert.equal(withdrawalProblem(unclaimed, { paypal_email: "A@example.com" })?.line.endsWith("Check your PayPal address."), true, "saving the same address changes nothing");
// A Wise transfer nobody has funded has not left: no row, not on its way, still the balance.
const unfunded = [pay("unfunded", 6500, "confirmed", { ...APPROVED, provider_payouts: [attempt("u", "processing", { amount_cents: 6500 })] })];
assert.deepEqual(withdrawalRows(unfunded), [], "an unfunded transfer is no withdrawal");
// The detail Wise refused, in our words, on the row and the card.
const named = [pay("named", 500, "confirmed", { ...APPROVED, provider_payouts: [attempt("n", "failed", { failure_code: "details_rejected", amount_cents: 500, asked_to_check: "Check your SWIFT code" })] })];
assert.equal(withdrawalRows(named)[0].note, "Check your SWIFT code");
assert.equal(withdrawalProblem(named)?.line, "A withdrawal failed. Check your SWIFT code.");
assert.equal(withdrawalProblem(named)?.zh, undefined, "one language: the factory's screens are English");
assert.equal(withdrawalRows(named, { details_changed_at: "2026-11-05T00:00:00Z" })[0].note, null, "fixed since: the row stops asking, and stays failed");
assert.equal(withdrawalRows(named, { details_changed_at: "2026-11-05T00:00:00Z" })[0].failed, true);
assert.equal(factoryAmount(money[0]), 300);
// A payout fee (src/shared/withdrawal-fees.mjs) comes off the one figure: the row,
// the summary and the withdrawal all say what the factory received.
{
  const paidWithFee = { id: "fee1", state: "released", amount_cents: 6500, charged_cents: 7194, payout_fee_cents: 128, currency: "USD", released_at: "2026-11-16T10:00:00Z",
    order: { brand_org_id: "b1" }, provider_payouts: [{ id: "x1", provider: "paypal", status: "paid", paid_to: "p@example.com", amount_cents: 6500, money_left_at: "t", paid_at: "2026-11-16T10:00:00Z" }] };
  assert.equal(factoryAmount(paidWithFee), 6372, "the earning is what arrived");
  assert.equal(withdrawalRows([paidWithFee])[0].amount, -6372, "the withdrawal is what left for the factory");
  assert.equal(factoryAmount({ ...paidWithFee, payout_fee_cents: null }), 6500, "no fee, the step");
}

// Staff's bank note reaches the factory only if a person typed one.
const bankPaid = { state: "released", released_by: "staff", released_note: " Wire ref HSBC-7788 " };
assert.equal(staffBankNote(bankPaid), "Wire ref HSBC-7788", "a typed note is shown, trimmed");
assert.equal(staffBankNote({ ...bankPaid, released_note: null }), null, "no note, nothing shown");
assert.equal(staffBankNote({ state: "released", released_by: null, stripe_transfer_id: "tr_1", released_note: "Paid out through Stripe." }), null, "Stripe's own sentence is not staff's note");
assert.equal(staffBankNote({ ...bankPaid, released_by: null }), null, "written by nobody: not staff's note");
assert.equal(staffBankNote({ ...bankPaid, payoneer_payouts: { payoneer_payment_id: "X" } }), null, "a Payoneer row says its ID instead");
assert.equal(staffBankNote({ ...bankPaid, state: "confirmed" }), null, "not paid yet");

const transferred = [pay("t", 5, "released", { stripe_transfer_id: "tr_1" })];
assert.equal(earningStatus(transferred[0]), "Added to your balance", "the same word as the order page: in its Stripe balance, not its bank");
assert.match(readFileSync(new URL("../src/app/order/LiveOrderDetail.jsx", import.meta.url), "utf8"), /case "released":\s*\/\/[^\n]*\n\s*return isFactory \? earningStatus\(payment\)/, "the order page uses that word for the factory");

// Stripe money still clearing, on the owner's page (Nov 18): its row says
// "Pending · Available Nov 19" and it is counted in the Pending figure, from
// the one read (clearingFor), so the rows and the figures always agree. Total
// is the same with or without it; a non-owner, who can't read Stripe, sees the
// figures as before.
{
  const brand2 = { brand_org_id: "brand-2", status: "active" };
  const stripeEarnings = [
    pay("s-clearing", 21000, "released", { ...APPROVED, stripe_transfer_id: "tr_1" }),
    pay("s-clearing-2", 9000, "released", { ...APPROVED, stripe_transfer_id: "tr_2", order: brand2 }),
    pay("s-available", 5000, "released", { ...APPROVED, stripe_transfer_id: "tr_3" }),
    pay("s-awaiting", 7000, "confirmed"),
    pay("s-owed", 124800, "confirmed", APPROVED),
  ];
  // Midnight UTC on Nov 19, 2026, as Stripe gives it.
  const nov19 = Date.UTC(2026, 10, 19) / 1000;
  const balance = { pendingEarnings: [{ paymentId: "s-clearing", available_on: nov19 }, { paymentId: "s-clearing-2", available_on: nov19 }] };
  const clearing = clearingFor(balance);
  assert.equal(clearingFor(undefined).size, 0, "no Stripe read, nothing clearing");
  assert.equal(earningStatus(stripeEarnings[0], clearing), "Pending", "a clearing earning reads Pending");
  assert.equal(earningStatus(stripeEarnings[0]), "Added to your balance", "without the read, it reads as before");
  assert.equal(earningStatus(stripeEarnings[2], clearing), "Added to your balance", "one Stripe has made available reads as before");
  assert.equal(earningPaid(stripeEarnings[0], clearing), false, "a clearing earning is not drawn as paid");
  assert.equal(clearingNote(stripeEarnings[0], clearing), "Available Nov 19", "its note says the day, read in UTC");
  assert.equal(clearingNote(stripeEarnings[2], clearing), null, "no note once available");
  // The page builds both from the same map.
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes("const clearing = clearingFor(stripeBalance);")
    && page.includes("status: earningStatus(row, clearing, placed)")
    && page.includes("const placed = figuresByPayment(balanceFigures);"), "each row's word comes from the same reads as the figures");
}

// The same rules as the staff board's buckets. A change there must change here.
const board = readFileSync(new URL("../src/app/admin/AdminPayments.jsx", import.meta.url), "utf8");
for (const rule of [
  // Owed, whichever tab draws it: a Wise or PayPal payout underway is shown under Processing.
  'const owed = rows.filter((row) => row.state === "confirmed" && row.release_requested_at)',
  'held: rows.filter((row) => row.state === "confirmed" && !row.release_requested_at && !cancelled(row))',
]) {
  assert.ok(board.includes(rule), `the board's rule changed; check payment-summary.mjs: ${rule}`);
}

// The factory's order page and its Payments page give one payment the same
// word. Each reads its own columns (milestone.js, PayoutDetails.jsx); a column
// earningStatus() needs that one of them leaves out makes them disagree, which
// is how the order page said "Pending" for PayPal balance money that Payments
// called "Added to your balance". Run every state through both column lists.
{
  const columnsIn = (file, pattern) => {
    const code = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const match = code.match(pattern);
    assert.ok(match, `${file}: the payment select was not found`);
    return match[1].split(",").map((column) => column.trim()).filter((column) => /^\w+$/.test(column));
  };
  const orderPage = columnsIn("lib/domain/milestone.js", /listMilestones[\s\S]*?order_payments \(([^)]*)\)/);
  const payments = columnsIn("app/order/PayoutDetails.jsx", /\.select\("(id, order_id, amount_cents[^"]*?), order_milestones/);
  const only = (row, columns) => ({ ...Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column]])), order: row.order });
  const rows = [
    ...earnings,
    pay("pool", 4500, "confirmed", { ...APPROVED, withdrawal_pool: true }),
    pay("pool-cancelled", 4500, "confirmed", { ...APPROVED, ...CANCELLED, withdrawal_pool: true }),
    pay("stripe", 300, "released", { stripe_transfer_id: "tr_1" }),
    pay("released-pool", 300, "released", { withdrawal_pool: true }),
  ];
  for (const row of rows) {
    assert.equal(earningStatus(only(row, orderPage)), earningStatus(only(row, payments)),
      `payment "${row.id}": the order page and Payments read different words (milestone.js's payment select is missing a column earningStatus needs)`);
  }
  assert.equal(earningStatus(only(rows.find((row) => row.id === "pool"), orderPage)), "Added to your balance", "PayPal/Wise balance money on the order page");
}

// A hand-paid card never goes back to saying how it is paid in place of a figure.
const card = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
assert.ok(!/"By Payoneer"|"By bank transfer"/.test(card), "the card's headline is the balance");
// One card for every factory (D3): "Available balance (USD)", its number the
// server's Available, the page's four figures the same read. No second card
// version, no figure summed from payments in the browser.
assert.ok(!card.includes("Balance (USD)") && !/isHandPaid|handFigures|handPaid/.test(card), "one card: no hand-paid version");
assert.ok(card.includes('estimatedLabel ? "Available balance (estimated USD)" : "Available balance (USD)"'), "the label says estimated only while the Stripe account holds money in another currency");
assert.ok(card.includes("formatMoney(Number(figures.available_cents) || 0, \"USD\")"), "the big number is the server's Available");
assert.ok(card.includes("Boolean(figures?.has_method) || balanceChoices.length > 0"), "Withdraw or Add withdrawal method by has_method (D6), and at once after the first method is saved (M1)");
assert.ok(card.includes("failure?.details?.figures"), "a 502 with figures still shows them");
{
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes("summaryFrom(transactionsReady ? shownFigures : null)"), "the four figures come from the one balance");
  assert.ok(page.includes('rpc("factory_balance", { target_org: org.id, target_client: client })'), "a client's figures from the same function");
  assert.ok(page.includes("figures={earningsError ? null : allFigures}"), "the card and the figures read the same answer");
  assert.ok(!/earningsSummaryFor|handPaidFigures|inBalance/.test(page), "no figure is summed from payments in the browser");
  // Members and factories with no Stripe account read the server's figures
  // action (the same answer as an owner's balance read; it records missing
  // clearing dates itself), at most once a minute, and wait for its first answer.
  assert.ok(page.includes('connectAction(org.id, "figures")') && /clearingAskedAt\.current > 60_000/.test(page)
    && page.includes("setViaFigures(failure?.details?.figures ?? null)") && !page.includes("refreshClearingDates"), "the figures action on the non-Stripe path");
  assert.ok(page.includes("if (w.destination_label) return [`To ${w.destination_label}.`, w.destination_bank]"), "a Stripe withdrawal row says where it went, for owner and member");
}

// Queena: a factory or a brand never reads Stripe, "by hand" or an upgrade it did not ask for.
// The one exception: a withdrawal method names the provider that pays it
// (src/shared/payout-method-info.mjs).
const PROVIDER_NAMED = new Set(["Bank account (Stripe)"]);
for (const file of ["order/StripePayoutCard.jsx", "order/PayoutDetails.jsx", "order/PayoutSetupSteps.jsx", "order/AddPayoutMethodForm.jsx", "order/payment-summary.mjs", "order/StripeConnectEmbed.jsx", "order/LiveFund.jsx", "payments/LiveBrandPaymentDetail.jsx"]) {
  const code = readFileSync(new URL(`../src/app/${file}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [, text] of code.matchAll(/(?:>|["'`])([^<>"'`{}]*\b(?:Stripe|by hand|Upgrade payout)\b[^<>"'`{}]*)(?:<|["'`])/g)) {
    if (file === "order/StripePayoutCard.jsx" && PROVIDER_NAMED.has(text.trim())) continue;
    assert.ok(/^(?:[./\w@-]+|\s*)$/.test(text) && !/\s/.test(text.trim()), `${file} says "${text.trim()}" to a factory`);
  }
}

console.log("earnings figures: every state in one place, adding up, same rules as the board");
