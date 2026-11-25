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
  ON_HOLD, ON_ITS_WAY, pendingParts, serverWithdrawalRows, legacyOnItsWayCents, owedClearingNote, parseWithdrawAmount, withdrawFeeLine, refundPendingWord, stillClearing, staffBankNote, summaryFrom, withdrawReach, withdrawalProblem, withdrawalRows,
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
const sumOfFour = (s) => s.approval + s.available + s.pending + s.processing + s.paid + (s.fees ?? 0);
/** Every case: Total is the figures added up (withdrawals in progress and withdrawal fees included), on the page and in the server's answer plus fees. */
function checkTotal(figures, label) {
  const s = summaryFrom(figures);
  assert.equal(s.total, sumOfFour(s), `${label}: Total earnings is the sum of the four figures and the fees`);
  if (figures.total_cents != null) assert.equal(s.total, Number(figures.total_cents) + s.fees, `${label}: and the server's own total, fees added back`);
  return s;
}
const row = (payment_id, figure, amount_cents) => ({ payment_id, figure, amount_cents, stripe: false });

// Nothing until the figures answer: placeholders, never a guess.
assert.deepEqual(summaryFrom(null), { total: undefined, approval: undefined, pending: undefined, processing: undefined, paid: undefined });
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
}

// IMG 45: $1 withdrawn by PayPal, $0.02 fee. Paid out $0.98 (what arrived),
// Total $1.00: a withdrawal fee does not shrink the earnings (flow check W2).
{
  const figures = balanceFigures(tsc({ paid_out_cents: 98 }, { pool_paid_cents: 100, withdrawal_fees_cents: 2 }, [row("y1", "paid_out", 100)]), null, null);
  const s = checkTotal(figures, "IMG 45");
  assert.equal(s.paid, 98, "IMG 45: Paid out $0.98");
  assert.equal(s.total, 100, "IMG 45: Total $1.00, the fee added back");
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
  // Owner and member read the same answer (the figures action): identical.
  const s = checkTotal(figures, "mixed D1 + owed");
  assert.equal(s.available, 800, "mixed: TSC's $5 + the $3 in its Stripe account");
  // The server decides where a payout on its way sits (api/_balance-figures.js);
  // the card shows its answer to the cent, never a sum of its own.
  assert.equal(s.pending, figures.pending_cents, "mixed: the card's Pending is the server's");
  // The server's rule (round 8): only money in the factory's own Stripe account
  // now is added; a payout on its way is already in the database's Pending.
  assert.equal(figures.pending_cents, db.pending_cents + 100, "mixed: Pending = server pending + Stripe pending");
  assert.equal(figures.paid_out_cents, db.paid_out_cents - (300 + 100), "mixed: Paid out = server paid out − (Stripe available + pending)");
  assert.equal(s.total, db.awaiting_cents + db.available_cents + db.pending_cents + db.paid_out_cents, "mixed: Total = the database's total, to the cent");
  assert.equal(s.total, figures.total_cents, "mixed: the card's Total is the server's, to the cent");
  const placed = figuresByPayment(figures);
  const clearingStep = pay("o2", 250, "confirmed", { ...APPROVED, funds_available_at: "2099-01-05T12:00:00Z" });
  assert.equal(earningStatus(clearingStep, null, placed), "Pending", "a card payment still clearing reads Pending, as its figure does");
  assert.match(owedClearingNote(clearingStep, placed) ?? "", /^Available [A-Z][a-z]{2} \d{1,2}$/, "with the day it can be withdrawn");
  assert.equal(owedClearingNote(pay("o1", 500, "confirmed", APPROVED), placed), null, "an available step has no such note");
  assert.equal(earningStatus(pay("o1", 500, "confirmed", APPROVED), null, placed), "Added to your balance");
  assert.equal(earningStatus(pay("a1", 700, "confirmed"), null, placed), "Awaiting approval");
  // What each road reaches is the server's (the balance read's `reach`), as it is.
  assert.deepEqual(withdrawReach({ stripe_cents: 700, pool_cents: 450, estimated: true }), { stripe: 700, balance: 450, estimated: true }, "the balance read's top-level reach; the Stripe amount says when it was converted");
  const cardCode = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  assert.ok(cardCode.includes("const reach = withdrawReach(answer?.reach);") && !cardCode.includes("figures?.reach"), "reach is read only at the server's top level");
  // Re-test: the dialog's Available is read again when Withdraw opens, and follows every later read.
  assert.ok(cardCode.includes("const server = await read.reload().catch(() => null);")
    && cardCode.includes("setWithdrawal((was) => (was ? { ...was, max: liveStripeMax } : was))"), "each method's Available is never stale");
  assert.ok(cardCode.includes('withdrawal.estimated ? "Amount (estimated USD)"'), "a converted Stripe reach says estimated USD");
}

// Stripe unreachable: the server answers 502 with the database's figures; the
// card shows them rather than a blank.
{
  const fallback = { ...balanceFigures(tsc({ available_cents: 100 }, { owed_cleared_cents: 100 }), null, null), stripe_unavailable: true };
  const s = checkTotal(fallback, "Stripe unreachable");
  assert.equal(s.available, 100);
}

// A partial withdrawal (P1, exact amount): $10 owed, $4 asked for by PayPal.
// $6 stays Available, $4 is Pending until paid; once paid with a $0.10 fee,
// Paid out $3.90 and Total $9.90.
{
  // (The old pool is takes since 20261121350000: the rest is owed money.)
  const step = pay("p1", 1000, "confirmed", { ...APPROVED });
  const asked = balanceFigures(tsc({ available_cents: 600, processing_cents: 400 }, { owed_cleared_cents: 600, taken_open_cents: 400 },
    [row("p1", "pending", 400), row("p1", "available", 600)]), null, null);
  const a = checkTotal(asked, "partial, asked");
  assert.equal(a.available, 600, "partial: the rest of the step stays Available");
  assert.equal(a.pending, 0, "partial: a withdrawal asked for is not Pending");
  assert.equal(a.processing, 400, "partial: exactly the amount asked for is processing");
  assert.equal(earningStatus(step, null, figuresByPayment(asked)), "Added to your balance", "partial: the step is still in the balance, not Pending");
  const paid = balanceFigures(tsc({ available_cents: 600, paid_out_cents: 390 }, { owed_cleared_cents: 600, taken_paid_cents: 400, withdrawal_fees_cents: 10 },
    [row("p1", "paid_out", 400), row("p1", "available", 600)]), null, null);
  const p = checkTotal(paid, "partial, paid");
  assert.equal(p.paid, 390, "partial: Paid out is what arrived");
  assert.equal(p.total, 1000, "partial: Total is the earnings, fee included");
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
}

// N4: an old step-by-step payout still being sent is "on its way", not
// "pending … once processing finishes". One that failed is not (R33 L2): its
// money reads where the server put it, as its attempt's row says "Failed".
{
  const attemptOf = (status) => ({ id: `a-${status}`, provider: "wise", status, amount_cents: 300, created_at: "2026-11-02T00:00:00Z", money_left_at: "2026-11-02T00:00:00Z" });
  const rows = [
    pay("sending", 300, "confirmed", { ...APPROVED, provider_payouts: [attemptOf("processing")] }),
    pay("bounced", 500, "confirmed", { ...APPROVED, provider_payouts: [attemptOf("failed")] }),
    pay("clearing", 700, "confirmed", APPROVED),
    pay("free", 900, "confirmed", { ...APPROVED, provider_payouts: [attemptOf("failed")] }),
  ];
  const placed = new Map([["sending", new Set(["pending"])], ["bounced", new Set(["pending"])], ["clearing", new Set(["pending"])], ["free", new Set(["available"])]]);
  assert.equal(legacyOnItsWayCents(rows, placed), 300, "R33: only a payout under way is on its way, never a failed one");
  const bounced = rows[1];
  // Since Nov 23 a payout on its way reads "Processing", the same word as a
  // withdrawal waiting or being sent, so only "pending" and "available" can differ.
  assert.equal(ON_ITS_WAY, "Processing", "a withdrawal on its way reads Processing, not On its way");
  for (const where of ["pending", "available"]) {
    assert.notEqual(earningStatus(bounced, null, new Map([["bounced", new Set([where])]])), ON_ITS_WAY, `R33: a failed per-step payout never reads Processing (${where})`);
  }
  // Placed under processing it is a withdrawal waiting (Processing), never counted as a payout under way.
  assert.equal(earningStatus(bounced, null, new Map([["bounced", new Set(["processing"])]])), "Processing");
  assert.equal(legacyOnItsWayCents([bounced], new Map([["bounced", new Set(["processing"])]])), 0, "R33: a failed per-step payout is not a payout under way");
  assert.equal(earningStatus(bounced, null, new Map([["bounced", new Set(["available"])]])), "Added to your balance", "R33: in the balance, as the server says");
  assert.equal(earningStatus(rows[0], null, new Map([["sending", new Set(["processing"])]])), ON_ITS_WAY, "one under way still is");
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

// Re-test (fix round 6, round 14): the card's "$X pending" is the Pending
// figure: earnings not yet available. Withdrawals in progress are Processing.
{
  const cardCode = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  // The card's lines: clearing ("$X pending. Available to withdraw on …") and
  // disputed on hold add up to Pending; waiting (its own row), on its way and
  // the held part of a withdrawal add up to Processing.
  assert.ok(cardCode.includes("const pendingLines = pendingParts(figures)") && cardCode.includes("const cardPending = pendingLines.clearing;"), "the card draws its lines from pendingParts");
  const disputedOf = (figures) => Math.min(figures.pending_cents, figures.parts?.disputed_cents ?? 0);
  const cases = [
    { pending_cents: 11500, processing_cents: 175579, parts: { owed_clearing_cents: 11500, disputed_cents: 0 }, stripe: { pending_cents: 0 } },
    { pending_cents: 0, processing_cents: 2000, parts: { owed_clearing_cents: 0, disputed_cents: 0 } },
    { pending_cents: 12500, processing_cents: 4000, parts: { owed_clearing_cents: 6500, disputed_cents: 5000 }, stripe: { pending_cents: 1000 } },
    { pending_cents: 500, processing_cents: 0, parts: { owed_clearing_cents: 0, disputed_cents: 5000 } },
  ];
  for (const figures of cases) {
    const p = pendingParts(figures);
    assert.equal(p.clearing + disputedOf(figures), figures.pending_cents, `clearing and disputed add up to Pending (${figures.pending_cents})`);
    assert.equal(p.waiting + p.onItsWay + (p.onHold - disputedOf(figures)), figures.processing_cents, `withdrawal lines add up to Processing (${figures.processing_cents})`);
    assert.ok(p.clearing >= 0 && p.onItsWay >= 0 && p.onHold >= 0 && p.waiting >= 0, "no line below zero");
  }
  assert.deepEqual(pendingParts(cases[0]), { pending: 11500, processing: 175579, clearing: 11500, onHold: 0, waiting: 0, onItsWay: 175579 }, "withdrawals on their way are not 'available to withdraw'");
  // A PayPal/Wise withdrawal waiting for staff, or on hold, is "waiting" as a
  // whole (its own block); "on hold" is only disputed earnings no withdrawal
  // holds; only what was sent is "on its way".
  const round8 = { pending_cents: 5000, processing_cents: 4500 + 100000, parts: { owed_clearing_cents: 0, disputed_cents: 5000 },
    withdrawals: [{ id: "h", road: "pool", word: "on_hold", amount_cents: 4500 }, { id: "w", road: "pool", word: "waiting", amount_cents: 100000 }] };
  assert.deepEqual(pendingParts(round8), { pending: 5000, processing: 104500, clearing: 0, onHold: 5000, waiting: 104500, onItsWay: 0 },
    "the dispute on hold, both withdrawals in their blocks, nothing called on its way");
  assert.ok(!cardCode.includes("waiting`}</p>") && !cardCode.includes("payout-waiting"), "no waiting line: the withdrawal's own row says it");
  // The Pending card is the header's pending amount: a waiting withdrawal is in neither.
  const shot = { pending_cents: 131300, processing_cents: 100000, parts: { owed_clearing_cents: 131300, disputed_cents: 0 },
    withdrawals: [{ id: "pp", road: "pool", provider: "paypal", word: "waiting", amount_cents: 100000, parts: [{ word: "waiting", amount_cents: 100000 }] }] };
  assert.equal(pendingParts(shot).clearing, summaryFrom(shot).pending, "the card's Pending equals the header's pending amount");
  assert.equal(summaryFrom(shot).pending, 131300, "a withdrawal waiting for staff is not Pending");
  assert.equal(summaryFrom(shot).total, 231300, "but stays in Total earnings");
  // With the server's list (factory_balance().withdrawals): its words decide the lines, and the rows.
  const listed = { pending_cents: 5000, processing_cents: 284094, parts: { owed_clearing_cents: 5000, disputed_cents: 0 }, withdrawals: [
    { id: "s1", road: "stripe", word: "on_its_way", amount_cents: 184094, fee_cents: 1406, to: "Bank account ending in 0154", arrives_on: "2026-11-23", created_at: "2026-11-20T15:29:58Z" },
    { id: "s2", road: "stripe", word: "returned", amount_cents: 185500, created_at: "2026-11-20T15:29:58Z" },
    { id: "p1", road: "pool", provider: "paypal", word: "returned", amount_cents: 4500, to: "a@b.c", created_at: "2026-11-20T15:23:57Z", parts: [{ word: "returned", amount_cents: 4500 }] },
    { id: "p2", road: "pool", provider: "paypal", word: "waiting", amount_cents: 100000, to: "a@b.c", created_at: "2026-11-20T15:32:07Z", parts: [{ word: "waiting", amount_cents: 100000 }] },
    { id: "p3", road: "pool", provider: "wise", word: "on_hold", amount_cents: 4500, to: "Bank ending 0148", created_at: "2026-11-20T15:33:07Z", parts: [{ word: "on_hold", amount_cents: 4500 }] },
  ] };
  listed.processing_cents += 4500;
  assert.deepEqual(pendingParts(listed), { pending: 5000, processing: 288594, clearing: 5000, onHold: 0, waiting: 104500, onItsWay: 184094 },
    "on its way is only what the server calls on its way; a withdrawal on hold is its block, never also an on-hold line");
  // Round 36 (#2): a $250 PayPal withdrawal, $100 of it on a step the brand
  // disputed since. The server says the whole withdrawal is on hold: its block
  // says it ($250, On hold) and Transactions agrees; the card has no "$100 on
  // hold" line, which would say the same money twice.
  const disputedUnder = { pending_cents: 0, processing_cents: 25000, parts: { owed_clearing_cents: 0, disputed_cents: 0 }, withdrawals: [
    { id: "w250", road: "pool", provider: "paypal", word: "on_hold", amount_cents: 25000, to: "a@b.c", created_at: "2026-11-21T10:00:00Z",
      parts: [{ word: "waiting", amount_cents: 15000 }, { word: "on_hold", amount_cents: 10000 }] },
  ] };
  assert.deepEqual(pendingParts(disputedUnder), { pending: 0, processing: 25000, clearing: 0, onHold: 0, waiting: 25000, onItsWay: 0 }, "the withdrawal as a whole; no on-hold line");
  assert.deepEqual(serverWithdrawalRows(disputedUnder.withdrawals).map((r) => [r.id, r.status, r.amount]), [["asked-w250", "On hold", -25000]], "Transactions: one row, On hold, $250");
  // Disputed earnings no withdrawal holds are the line, beside it.
  assert.equal(pendingParts({ ...disputedUnder, pending_cents: 4000, parts: { owed_clearing_cents: 0, disputed_cents: 4000 } }).onHold, 4000);
  // The server's parts (round 11): $75 asked, $50 of it on a step refunded since.
  const withParts = { pending_cents: 0, processing_cents: 7500 + 184094, parts: { owed_clearing_cents: 0, disputed_cents: 0 }, withdrawals: [
    { id: "w75", road: "pool", word: "on_hold", amount_cents: 7500, parts: [{ word: "waiting", amount_cents: 2500 }, { word: "on_hold", amount_cents: 5000 }] },
    { id: "s1", road: "stripe", word: "on_its_way", amount_cents: 184094, parts: [{ word: "on_its_way", amount_cents: 184094 }] },
  ] };
  const p75 = pendingParts(withParts);
  assert.deepEqual(p75, { pending: 0, processing: 191594, clearing: 0, onHold: 0, waiting: 7500, onItsWay: 184094 }, "the $75 withdrawal as a whole");
  assert.equal(p75.onHold + p75.waiting + p75.onItsWay, withParts.processing_cents, "and they add up to Processing");
  // Round 16 (F1): a PayPal withdrawal staff are sending ("paying", word
  // on_its_way) is its own "Processing withdrawal" block until it is paid, so
  // it is never also inside "$X on its way" (it was counted twice: $596.52 on
  // its way = $496.52 Stripe + the $100 PayPal block). The card adds up to Total.
  const sending = { available_cents: 113950, awaiting_cents: 13000, pending_cents: 6500, processing_cents: 10000 + 49652, paid_out_cents: 0,
    parts: { owed_clearing_cents: 6500, disputed_cents: 0 }, withdrawals: [
      { id: "s1", road: "stripe", word: "on_its_way", amount_cents: 49652, parts: [{ word: "on_its_way", amount_cents: 49652 }] },
      { id: "pp", road: "pool", provider: "paypal", word: "on_its_way", amount_cents: 10000, parts: [{ word: "on_its_way", amount_cents: 10000 }] },
    ] };
  const sendingLines = pendingParts(sending);
  assert.deepEqual(sendingLines, { pending: 6500, processing: 59652, clearing: 6500, onHold: 0, waiting: 10000, onItsWay: 49652 },
    "a PayPal withdrawal being sent is its block only; on its way is the Stripe payout alone");
  const blocks = 10000; // the one "Processing withdrawal" block (factory_withdrawals paying)
  assert.equal(sending.available_cents + sending.awaiting_cents + sendingLines.clearing + sendingLines.onHold + blocks + sendingLines.onItsWay + sending.paid_out_cents,
    summaryFrom(sending).total, "Available + Awaiting + pending + on hold + blocks + on its way + Paid out = Total");
  // The word decides, parts or not.
  assert.equal(pendingParts({ ...sending, withdrawals: sending.withdrawals.map(({ parts, ...w }) => w) }).onItsWay, 49652, "also without parts");
  // Round 12: Stripe money an open withdrawal holds is on its way (Processing), not clearing.
  const held = pendingParts({ pending_cents: 0, processing_cents: 11467, parts: { owed_clearing_cents: 0, disputed_cents: 0 }, stripe: { pending_cents: 0, processing_cents: 1467, held_cents: 1467 },
    withdrawals: [{ id: "w", road: "pool", word: "on_hold", amount_cents: 10000, parts: [{ word: "waiting", amount_cents: 5000 }, { word: "on_hold", amount_cents: 5000 }] }] });
  assert.deepEqual(held, { pending: 0, processing: 11467, clearing: 0, onHold: 0, waiting: 10000, onItsWay: 1467 }, "held Stripe money reads on its way, never 'withdraw once processing finishes'");
  const listedRows = serverWithdrawalRows(listed.withdrawals, { pool: new Map([["p1", { id: "p1", status: "cancelled" }]]), stripe: new Map() });
  assert.deepEqual(listedRows.map((r) => [r.id, r.status, r.amount]), [
    ["stripe-s1", "Processing", -184094],
    ["asked-p1", "Cancelled", -4500],
    ["asked-p2", "Awaiting review", -100000],
    ["asked-p3", "On hold", -4500],
  ], "rows from the server's list: a cancelled request stays listed (round 28); a Stripe withdrawal refused before any payout is not");
  // Round 28: a cancelled or declined withdrawal stays a row: its word, its
  // amount muted (payout-amount-failed), declined with staff's reason as the
  // note, and in no figure.
  {
    const ended = { pending_cents: 0, processing_cents: 0, parts: { owed_clearing_cents: 0, disputed_cents: 0 }, withdrawals: [
      { id: "c1", road: "pool", provider: "paypal", word: "returned", amount_cents: 2500, to: "a@b.c", created_at: "2026-11-21T10:00:00Z" },
      { id: "d1", road: "pool", provider: "wise", word: "returned", amount_cents: 7000, to: "Bank ending 0148", created_at: "2026-11-21T11:00:00Z" },
    ] };
    const own = new Map([["c1", { id: "c1", status: "cancelled" }], ["d1", { id: "d1", status: "declined", reason: "The account name does not match your company." }]]);
    const rows = serverWithdrawalRows(ended.withdrawals, { pool: own, stripe: new Map() });
    assert.deepEqual(rows.map((r) => [r.id, r.status, r.failed, r.available, r.note]), [
      ["asked-c1", "Cancelled", true, false, null],
      ["asked-d1", "Declined", true, false, "The account name does not match your company."],
    ], "cancelled and declined withdrawals stay listed, muted, declined with staff's reason");
    assert.deepEqual(pendingParts(ended), { pending: 0, processing: 0, clearing: 0, onHold: 0, waiting: 0, onItsWay: 0 }, "and add nothing to any figure");
    const pageCode = (await import("node:fs")).readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
    assert.ok(pageCode.includes('row.failed ? "payout-amount-failed"'), "a failed row's amount is muted (--text-muted)");
    const zh = (await import("node:fs")).readFileSync(new URL("../src/factory-prototype/main.jsx", import.meta.url), "utf8");
    assert.ok(zh.includes('"Cancelled": "已取消"') && zh.includes('"Declined": "已拒绝"'), "both words already have their Chinese");
  }
  // Round 29: the company's own rows are its newest 200. A cancelled or
  // declined withdrawal older than that is read by id, so it never says "Failed".
  {
    const { missingPoolIds } = await import("../src/app/order/payment-summary.mjs");
    const list = [
      { id: "old-c", road: "pool", provider: "paypal", word: "returned", amount_cents: 2500, created_at: "2026-01-02T10:00:00Z" },
      { id: "old-d", road: "pool", provider: "wise", word: "returned", amount_cents: 7000, created_at: "2026-01-01T10:00:00Z" },
      { id: "new-c", road: "pool", provider: "paypal", word: "returned", amount_cents: 100, created_at: "2026-11-21T10:00:00Z" },
      { id: "wait", road: "pool", provider: "paypal", word: "waiting", amount_cents: 100, created_at: "2026-11-21T10:00:00Z" },
      { id: "s1", road: "stripe", word: "returned", amount_cents: 100, created_at: "2026-11-21T10:00:00Z" },
    ];
    const newest200 = new Map([["new-c", { id: "new-c", status: "cancelled" }], ["wait", { id: "wait", status: "requested" }]]);
    assert.equal(serverWithdrawalRows(list.slice(0, 1), { pool: newest200 })[0].status, "Failed", "before: one older than the 200 read said Failed");
    assert.deepEqual(missingPoolIds(list, newest200), ["old-c", "old-d"], "only pool rows gone back that the 200 do not hold are read by id");
    assert.deepEqual(missingPoolIds(list, new Map([...newest200, ["old-c", {}], ["old-d", {}]])), [], "nothing once they are known");
    const readById = [{ id: "old-c", status: "cancelled", reason: null, back_cents: null }, { id: "old-d", status: "declined", reason: "Wrong account.", back_cents: null }];
    const pool = new Map([...readById.map((w) => [w.id, w]), ...newest200]);
    assert.deepEqual(serverWithdrawalRows(list.slice(0, 2), { pool }).map((r) => [r.status, r.failed, r.note]),
      [["Cancelled", true, null], ["Declined", true, "Wrong account."]], "read by id: Cancelled and Declined, with staff's reason");
    const pageCode = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
    assert.ok(pageCode.includes('supabase.from("factory_withdrawals").select("id, status, reason, back_cents").eq("org_id", org.id).in("id", batch)')
      && pageCode.includes("missingPoolIds(serverList, poolById)")
      && pageCode.includes("const poolById = new Map([...olderPool, ...(fromBalance.rows ?? []).map((w) => [w.id, w])]);")
      && pageCode.includes("const fromBalance = withdrawalsFrom(answer, balanceRead.failure);"),
      "the page reads the missing ones and lists them with the rest");
  }
  assert.equal(listedRows[0].meta, "Bank account ending in 0154", "where it went, named as everywhere: ending in, no stray full stop");
  {
    // live-zh translates a meta line part by part (" · "): this part has its rule.
    const zh = readFileSync(new URL("../src/app/live-zh.js", import.meta.url), "utf8");
    assert.ok(zh.includes("[/^(Bank account|Debit card) ending in (\\d+)$/, (m) => `${m[1] === \"Bank account\" ? \"银行账户\" : \"借记卡\"}（尾号 ${m[2]}）`]"), "and in Chinese: 银行账户（尾号 0154）");
    assert.match("Bank account ending in 0154", /^(Bank account|Debit card) ending in (\d+)$/);
  }
  assert.equal(listedRows[0].arrives.getDate(), 23, "arrival from arrives_on, read as a day");
  assert.ok(cardCode.includes("{!busy && !error && !withdrawal.previous && withdrawal.amountText && amountProblem"), "one refusal message at a time");
  assert.ok(cardCode.includes("withdrawal.amount > 0 && !amountProblem"), "the fee line follows the dialog's Available");
  assert.equal(pendingParts(cases[1]).clearing, 0, "only withdrawals pending: no 'available to withdraw on' line");
  assert.equal(pendingParts(null), null);
  // A refunded earning stays listed, in no figure.
  const refunded = pay("r1", 6500, "failed", { ...APPROVED, confirmed_at: "2026-11-19T00:00:00Z", refunded_at: "2026-11-20T00:00:00Z" });
  assert.equal(earningStatus(refunded), "Refunded");
  assert.equal(earningPaid(refunded), false);
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes('|| refundedEarning(row));') && page.includes("payout_arrives_on"), "refunded rows stay on the list; Stripe's arrival is read as its day");
}

// Fix round 6b: Stripe's arrival is a day; "On its way" until that day (the
// server's word, factory_balance()), even once paid.
{
  const [row] = serverWithdrawalRows([{ id: "z", road: "stripe", word: "on_its_way", amount_cents: 1960, fee_cents: 40, arrives_on: "2026-11-23", created_at: "2026-11-20T10:00:00Z" }]);
  assert.equal(row.status, ON_ITS_WAY, "paid by Stripe, but its arrival day is tomorrow");
  assert.equal(row.arrives.getDate(), 23, "the arrival day is read as that day, not an instant");
  const [arrived] = serverWithdrawalRows([{ id: "y", road: "stripe", word: "paid", amount_cents: 1960, fee_cents: 40, arrives_on: "2026-11-23", created_at: "2026-11-20T10:00:00Z" }]);
  assert.equal(arrived.status, "Completed", "and at the bank from that day: Completed, as every method says it (W9)");
  const form = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(form.includes("returnable.get(w.id)") && form.includes("total > 0 ? `Back to your balance: ${formatMoney(total, \"USD\")}` : NOTHING_BACK"),
    "cancelling says what really comes back, or that nothing does after a refund");
}

// Round 9: a request the server marks on_hold reads "On hold" in the Pending withdrawal block, for owner and member.
{
  const form = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(form.includes('words.get(row.id) === "on_hold"') && form.includes('{onHold(row) ? "On hold" : row.status === "requested" ? "Awaiting review" : "Processing"}')
    && form.includes('data-testid="withdrawal-on-hold">On hold</span>'), "On hold for the owner and the member");
}

// Round 11: after any withdrawal answer, refusals included, the balance is read
// again at once; a method save reads the figures again.
{
  const cardCode = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(cardCode.includes("if (!signedOut) await load().catch(() => null);") && cardCode.includes("return saved && isOwner ? read.reload() : null;"),
    "a refused withdrawal re-reads the balance, Stripe part included");
  assert.ok(cardCode.includes("const reading = read.reset();"), "a withdrawal made: the read from before it never lands");
  assert.ok(page.includes("if (methodsSeen.current === payouts.accounts) return;") && page.includes("balanceRead.request();"), "any method save reads the figures again");
}

// A declined or failed withdrawal banner shows while new, not in every later visit.
{
  const form = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(form.includes("<NewOnly id={`${last.id}:declined`}>") && form.includes("tscWithdrawalNoticeSeen:"), "the declined banner is shown once per withdrawal");
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
  // (factory_balance() gives each Stripe withdrawal's amount net of its fee.)
  const own = new Map([["c", { id: "c", payout_id: "po_3", payout_status: "failed" }], ["d", { id: "d", payout_id: null }]]);
  const rows = serverWithdrawalRows([
    { id: "a", road: "stripe", word: "on_its_way", amount_cents: 968, fee_cents: 32, arrives_on: "2026-11-23", created_at: "2026-11-20T10:00:00Z" },
    { id: "b", road: "stripe", word: "paid", amount_cents: 1950, fee_cents: 50, arrives_on: "2026-11-19", created_at: "2026-11-18T10:00:00Z" },
    { id: "c", road: "stripe", word: "returned", amount_cents: 500, fee_cents: 0, created_at: "2026-11-18T10:00:00Z" },
    { id: "d", road: "stripe", word: "returned", amount_cents: 500, created_at: "2026-11-18T10:00:00Z" },
  ], { stripe: own });
  assert.equal(rows.length, 3, "only withdrawals that made a payout");
  assert.equal(rows[0].status, ON_ITS_WAY, "paid by Stripe but not at the bank until its arrival day");
  assert.equal(rows[0].note, "Fee $0.32, taken from it. Your bank is processing the payout.", "the fee from the start, and the processing sentence (W9)");
  assert.equal(rows[0].amount, -968, "what reaches the bank: the withdrawal less Stripe's fee");
  assert.equal(rows[1].status, "Completed");
  assert.equal(rows[1].note, "Fee $0.50, taken from it", "the fee in the PayPal row's words");
  assert.equal(rows[2].failed, true);
  // W9: a PayPal withdrawal shows its fee, and what arrives, from the start; the same word as Stripe's once paid.
  const paypal = serverWithdrawalRows([
    { id: "p1", road: "pool", provider: "paypal", word: "on_its_way", amount_cents: 20000, fee_cents: null, created_at: "2026-11-20T10:00:00Z" },
    { id: "p2", road: "pool", provider: "paypal", word: "paid", amount_cents: 20000, fee_cents: 393, created_at: "2026-11-20T10:00:00Z" },
  ], { feeFor: () => 393 });
  assert.deepEqual(paypal.map((row) => [row.status, row.note, row.amount]),
    [["Processing", "Fee $3.93, taken from it", -19607], ["Completed", "Fee $3.93, taken from it", -19607]], "W9: one amount and one fee, before and after");
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
assert.equal(rows.find((row) => row.id === "provider-a").status, "Processing", "R36: a per-step payout under way keeps main's word, Processing (still true)");
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
assert.match(readFileSync(new URL("../src/app/order/LiveOrderDetail.jsx", import.meta.url), "utf8"), /case "released":\s*\/\/[^\n]*\n\s*return isFactory \? factoryWord\(payment\)/, "the order page uses that word for the factory");

// Round 32 (screens review #1): the order page and Payments give a step the
// same word. Both read the same payment fields (EARNING_COLUMNS) and the
// server's figures; the order page's words come from earningWordsFor().
{
  const { EARNING_COLUMNS, earningWordsFor, figuresByPayment: placedBy } = await import("../src/app/order/payment-summary.mjs");
  const steps = [
    // All of it in a waiting PayPal withdrawal.
    pay("waiting-paypal", 500, "confirmed", { ...APPROVED, payment_takes: [{ status: "held", stripe_withdrawals: null }] }),
    // Released by a Stripe withdrawal whose payout has not landed.
    pay("stripe-on-way", 700, "released", { stripe_transfer_id: "tr_7", released_note: "Withdrawn", payment_takes: [{ status: "sent", stripe_withdrawals: { state: "paid_out", payout_status: "in_transit" } }] }),
    // Part still clearing, part available.
    pay("split", 900, "confirmed", { ...APPROVED }),
    // A per-step payout under way.
    pay("per-step", 300, "confirmed", { ...APPROVED, provider_payouts: [{ id: "x", provider: "wise", status: "processing", created_at: "2026-11-02T00:00:00Z" }] }),
  ];
  const figures = tsc({}, {}, [row("waiting-paypal", "processing", 500), { ...row("stripe-on-way", "on_its_way", 700), stripe: true },
    row("split", "pending", 400), row("split", "available", 500), row("per-step", "processing", 300)]);
  const onPayments = new Map(steps.map((step) => [step.id, earningStatus(step, null, placedBy(figures))]));
  const onOrder = earningWordsFor(steps, figures);
  assert.deepEqual([...onOrder], [...onPayments], "R32: the order page's words are Payments' words");
  assert.deepEqual([...onOrder.values()], ["Processing", "Processing", "Added to your balance", "Processing"],
    "R32: waiting withdrawal, Stripe payout on its way, a split step, a per-step payout under way");
  // Without the figures (the old order page) the first two read differently: the reason for the change.
  assert.notEqual(earningStatus(steps[0]), onOrder.get("waiting-paypal"), "R32: the payment alone said otherwise");
  const order = readFileSync(new URL("../src/app/order/LiveOrderDetail.jsx", import.meta.url), "utf8");
  assert.ok(order.includes('.select(EARNING_COLUMNS).eq("order_id", orderId)') && order.includes('supabase.rpc("factory_balance", { target_org: org.id })')
    && order.includes("earningWordsFor(earningRows.data, balance.data, row)"), "R32: the order page reads what Payments reads");
  const payouts = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(payouts.includes(".select(EARNING_COLUMNS)"), "R32: Payments selects the same columns");
  assert.ok(EARNING_COLUMNS.includes("payment_takes (status, stripe_withdrawals (state, payout_status))"), "R32: the columns the word needs");
}

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
    && page.includes("const placed = figuresByPayment(answer?.figures);"), "each row's word comes from the same reads as the figures");
}

// The same rules as the staff board's buckets. A change there must change here.
const board = readFileSync(new URL("../src/shared/payments-board-sections.mjs", import.meta.url), "utf8");
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
  const payments = columnsIn("app/order/payment-summary.mjs", /EARNING_COLUMNS = "(id, order_id, amount_cents[^"]*?), order_milestones/);
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
{
  const reader = readFileSync(new URL("../src/app/order/balance-reader.mjs", import.meta.url), "utf8");
  assert.ok(reader.includes("failure?.details?.figures ? failure.details : null"), "a 502 with figures still shows them");
}
{
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes("summaryFrom(transactionsReady ? shownFigures : null)"), "the four figures come from the one balance");
  assert.ok(page.includes('rpc("factory_balance", { target_org: org.id, target_client: client })'), "a client's figures from the same function");
  assert.ok(page.includes("figures={earningsError || balanceError ? null : allFigures}"), "the card and the figures read the same answer");
  assert.ok(!/earningsSummaryFor|handPaidFigures|inBalance/.test(page), "no figure is summed from payments in the browser");
  // Everyone reads the server's figures action (it records missing clearing
  // dates itself); the page waits for its first answer.
  const hook = readFileSync(new URL("../src/app/order/use-factory-balance.js", import.meta.url), "utf8");
  assert.ok(hook.includes('connectAction(orgId, "figures"') && page.includes("const allFigures = earningsShown && answer ? answer.figures ?? null : null;")
    && !page.includes("refreshClearingDates"), "the figures action for every reader");
  assert.ok(page.includes("if (w.destination_label) return [w.destination_label, w.destination_bank]") && page.includes("return payoutDestination(w, stripeBalance);"), "a Stripe withdrawal row says where it went, for owner and member");
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

// Refunds and lost disputes (20261121200000): the factory's part goes down
// on dated rows of their own (the step's row is never rewritten); money that
// had already been withdrawn is owed to TSC inside Available, which can read
// below zero, and nothing more can be withdrawn while it is not covered.
{
  const { DISPUTE_LOST, REFUNDED, owedToTscCause, owedToTscCents, owedToTscLine, paymentRefund, refundRows } = await import("../src/app/order/payment-summary.mjs");
  const fmt = (cents) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
  // F3's state from the pgTAP suite: $400 withdrawn by PayPal then a lost
  // dispute on the $500 deposit, $150 withdrawn by Stripe then refunded.
  const tsc = {
    awaiting_cents: 0, available_cents: -55000, pending_cents: 0, processing_cents: 0, paid_out_cents: 54000, total_cents: -1000,
    owed_to_tsc_cents: 55000, parts: { owed_cleared_cents: 0, pool_available_cents: 0 },
    rows: [
      { payment_id: "dep", figure: "paid_out", amount_cents: 40000 },
      { payment_id: "dep", figure: "refunded", amount_cents: -50000, cause: "dispute_lost", at: "2026-11-21T10:00:00Z" },
      { payment_id: "fit", figure: "paid_out", amount_cents: 15000, stripe: true },
      { payment_id: "fit", figure: "refunded", amount_cents: -15000, cause: "refund", at: "2026-11-21T11:00:00Z" },
    ],
    withdrawals: [],
  };
  const summary = summaryFrom(tsc);
  assert.deepEqual([summary.available, summary.paid, summary.total], [-55000, 54000, -1000], "Available below zero; Paid out as sent; Total adds up");
  assert.equal(owedToTscCents(tsc), 55000);
  assert.equal(owedToTscCents({ tsc }), 55000, "read through the Stripe answer's database part too");
  assert.equal(owedToTscCents(balanceFigures(tsc, null, null)), 55000, "and kept by the server's balance answer");
  assert.equal(owedToTscLine(55000, fmt), "You owe TSC $550.00. A payment was refunded after you withdrew it.");
  assert.equal(owedToTscLine(0, fmt), null, "no line without a debt");
  // Fix round 19: a lost dispute is said as one, never as a refund.
  assert.equal(owedToTscLine(50000, fmt, "dispute_lost"), "You owe TSC $500.00. The brand's bank reversed a payment after you withdrew it.");
  assert.equal(owedToTscLine(50000, fmt, "both"), "You owe TSC $500.00. Money was returned to the brand after you withdrew it.", "R32: one phrase for money going back to the brand");
  const rowsOf = (...causes) => ({ rows: causes.map((cause, i) => ({ figure: "refunded", amount_cents: -100, payment_id: `p${i}`, cause, at: "2026-11-21T10:00:00Z" })) });
  assert.deepEqual([owedToTscCause(rowsOf("dispute_lost")), owedToTscCause(rowsOf("refund")), owedToTscCause(rowsOf("refund", "dispute_lost"))],
    ["dispute_lost", "refund", "both"], "the cause comes from the dated refund rows");
  assert.doesNotMatch(owedToTscLine(55000, fmt), /next earnings/i, "never promises to take it from later earnings (not decided)");
  assert.deepEqual(refundRows(tsc), [
    { paymentId: "dep", cause: "dispute_lost", at: "2026-11-21T10:00:00Z", amount: -50000 },
    { paymentId: "fit", cause: "refund", at: "2026-11-21T11:00:00Z", amount: -15000 },
  ], "one dated row per refund or lost dispute, below zero");
  assert.equal(figuresByPayment(tsc).get("dep").has("refunded"), false, "a row below zero never decides a step's word");
  assert.deepEqual([DISPUTE_LOST, REFUNDED], ["Reversed by the brand's bank", "Refunded"]);
  // Withdraw offers nothing while the debt is not covered: the server's reach
  // is net of it (owed_reachable, pinned in pgTAP); the page has no reach of its own.
  assert.deepEqual(withdrawReach(undefined), { stripe: null, balance: null, estimated: false }, "no answer, no reach");
  // The order page's line: the brand's whole amount, the factory's part.
  assert.deepEqual(paymentRefund({ charged_cents: 99208, refunded_cents: 5000, dispute_lost_cents: 0, factory_refund_cents: 4536 }),
    { refunded: 5000, lost: 0, brand: 5000, factory: 4536, full: false });
  assert.equal(paymentRefund({ charged_cents: 99208, refunded_cents: 0, dispute_lost_cents: 99208, factory_refund_cents: 90000 }).full, true);
  // A refunded part of a waiting withdrawal is not "on hold", and not waiting.
  const parts = pendingParts({ pending_cents: 0, processing_cents: 20000, parts: {},
    withdrawals: [{ id: "w", road: "pool", word: "on_hold", amount_cents: 25000, parts: [{ word: "waiting", amount_cents: 20000 }, { word: "refunded", amount_cents: 5000 }] }] });
  assert.deepEqual([parts.onHold, parts.waiting], [0, 20000], "the block holds $200; the refunded $50 is on no line");
  // The card and the block, in the page's code.
  const card = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  assert.ok(card.includes("owedToTscLine(uncoveredDebtCents(figures), formatMoney, owedToTscCause(figures))"), "the card says what is owed to TSC, and why");
  // C1 (round 36): the line says only what earnings do not cover; once they
  // cover it, no line (Available already counts the whole debt).
  const { uncoveredDebtCents } = await import("../src/app/order/payment-summary.mjs");
  assert.equal(uncoveredDebtCents({ ...tsc, uncovered_debt_cents: 25000 }), 25000);
  assert.equal(uncoveredDebtCents({ tsc: { ...tsc, uncovered_debt_cents: 0 } }), 0, "covered: no line");
  assert.equal(uncoveredDebtCents(balanceFigures({ ...tsc, uncovered_debt_cents: 25000 }, null, null)), 25000, "kept by the server's balance answer");
  assert.ok(!card.includes("owedToTscLine(owedToTscCents("), "never the whole debt on the card's line");
  // The order page: a lost dispute is never "refunded" (fix round 19).
  const orderPage = readFileSync(new URL("../src/app/order/LiveOrderDetail.jsx", import.meta.url), "utf8");
  // Round 36 (#3): one rule for "no withdrawal method", the server's
  // (factory_balance().no_saved_method = the notices' factory_has_no_saved_method),
  // never the page counting payout rows itself; the card's line reads it too.
  assert.ok(orderPage.includes("setNoMethod(balance.data.no_saved_method === true)"), "the order page reads no_saved_method");
  assert.ok(card.includes("figures?.no_saved_method === true") || readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8").includes("figures?.no_saved_method === true"), "and so does the card");
  assert.equal(balanceFigures({ no_saved_method: true }, null, null).no_saved_method, true, "kept by the server's balance answer");
  assert.ok(!/factory_payout_accounts"\)\.select\("id", \{ count/.test(orderPage), "and no longer counts payout rows");
  const line = orderPage.slice(orderPage.indexOf("function paymentLine("), orderPage.indexOf("function paymentStateLine("));
  assert.ok(line.includes("reversed by your bank`") && line.includes("returned to the brand`") && !line.includes("} back to the brand`"),
    "a partial lost dispute and a refund plus a dispute, each in its words (R32: returned to the brand)");
  const block = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(block.includes("formatMoney(Number(row.amount_cents) - refundedOf(row), row.currency)") && block.includes("refunded`"),
    "a waiting withdrawal's block shows what it still holds, and its refunded part");
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes("refundRows(answer?.figures)"), "Transactions list each refund on its own row");
  // Chinese for the new screen words: the live patterns and the factory's dictionary.
  const zh = readFileSync(new URL("../src/app/live-zh.js", import.meta.url), "utf8");
  const literals = [...zh.matchAll(/\[(\/\^.*?\$\/)[a-z]*,/g)].map(([, literal]) => new RegExp(literal.slice(1, -1)));
  for (const text of ["You owe TSC $550.00. A payment was refunded after you withdrew it.", "$50.00 refunded", "$45.00 returned to the brand", "$50.00 reversed by your bank",
    "$50.00 returned to the brand", "$46.73 reversed by the brand's bank",
    "You owe TSC $500.00. The brand's bank reversed a payment after you withdrew it.", "You owe TSC $500.00. Money was returned to the brand after you withdrew it.", "$900.00 funded for Bulk deposit, added to your balance",
    "$963.00 funded for Bulk deposit, added to the factory's balance"]) {
    assert.ok(literals.some((re) => re.test(text)), `Chinese for "${text}"`);
  }
  const dictionary = readFileSync(new URL("../src/factory-prototype/main.jsx", import.meta.url), "utf8");
  // R32: no rule for words nothing writes any more.
  assert.ok(!dictionary.includes('"Dispute lost"') && !dictionary.includes("Nothing goes back to your balance"), "R32: dead Chinese rules removed");
  assert.ok(!literals.some((re) => re.test("$45.00 back to the brand")), "R32: the old phrase has no rule left");
  assert.ok(dictionary.includes(`"Reversed by the brand's bank": "已被品牌的银行撤回"`) && dictionary.includes('"This amount was returned to the brand.": "这笔金额已退回品牌。"')
    && dictionary.includes('"Order payment": "订单付款"') && dictionary.includes('"Only a company owner can withdraw": "只有公司所有者可以提现"')
    && dictionary.includes('"Only an owner can set up or change payouts": "只有所有者可以设置或更改收款方式"'),
    "Chinese for the round 22 words");
  // Round 32: a part the brand's bank took back reads as its row and the order page do.
  const block22 = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  assert.ok(block22.includes("? reversedByBankLine(formatMoney(refundedOf(row), row.currency))") && !block22.includes("returned to the brand`"),
    "R32: the withdrawal block says reversed by the brand's bank");
  assert.ok(!block22.includes('export const NOTHING_BACK') && block22.includes('import { NOTHING_BACK,'), "R32: NOTHING_BACK is defined once");
}

// Fix round 24: a withdrawal part of which went back to the brand shows what
// it still holds everywhere; the methods list says a switched-off method is
// unavailable and offers no Make default; the order page uses what approving
// adds; a fully refunded deposit reads Refunded; staff see the amount at risk.
{
  const { serverWithdrawalRows } = await import("../src/app/order/payment-summary.mjs");
  const rows = serverWithdrawalRows([{ id: "w", road: "pool", provider: "paypal", created_at: "2026-11-21T10:00:00Z", amount_cents: 50000, word: "on_hold",
    parts: [{ word: "on_hold", amount_cents: 6500 }, { word: "refunded", amount_cents: 43500 }] },
    { id: "s", road: "pool", provider: "paypal", created_at: "2026-11-21T10:00:00Z", amount_cents: 60000, word: "on_its_way",
      parts: [{ word: "on_its_way", amount_cents: 6500 }, { word: "refunded", amount_cents: 53500 }] }]);
  assert.deepEqual(rows.map((row) => row.amount), [-6500, -6500], "Transactions rows show what each withdrawal still holds");
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const css = read("../src/app/order/payout.css");
  assert.ok(css.includes('.payout-withdrawal-status-row .payout-pending-destination[data-testid="withdrawal-refunded"] { grid-column: 1; grid-row: 3; }'),
    "the refunded line has its own row, never on top of the method line");
  const form = read("../src/app/order/WithdrawFromBalance.jsx");
  assert.ok(form.includes("formatMoney(returnable instanceof Map && returnable.has(w.id) ? returnable.get(w.id) : w.amount_cents, w.currency)"),
    "the cancel dialog lists what each withdrawal still holds");
  const card = read("../src/app/order/StripePayoutCard.jsx");
  assert.ok(card.includes('data-testid="method-off">{METHOD_OFF}') && card.includes("&& methodProviderOn(providers, row) ? <button type=\"button\" role=\"menuitem\" onClick={() => { setMethodMenu(null); makePrimary(row); }}"),
    "a switched-off method is said unavailable, with no Make default");
  const order = read("../src/app/order/LiveOrderDetail.jsx");
  assert.ok(order.includes("Number(milestone.payment?.factory_refund_cents ?? 0)") && order.includes('if (refund.factory >= Number(payment.amount_cents)) return refund.refunded > 0 ? "Refunded" : DISPUTE_LOST;')
    && order.includes(" - wentBack))"), "Release and Funded figures net of refunds; a fully refunded deposit reads Refunded");
  const staff = read("../src/app/admin/AdminWithdrawals.jsx");
  assert.ok(staff.includes("of this payout went back to the brand after it was sent. If the payout completes, the factory owes TSC")
    && staff.includes("<strong>{moneyIn(holds, row.currency)}</strong>"), "staff see what a withdrawal still holds, and the amount at risk while it is sent");
}

// Fix round 25: a failed withdrawal's card line says what came back; staff
// keep the asked amount on a row being sent; a dispute fully lost reads the
// bank-reversal word; a held cancelled-order payment is taken off once; a
// switched-off method is never offered as the next default.
{
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const form = read("../src/app/order/WithdrawFromBalance.jsx");
  assert.ok(form.includes("did not go through.${said ? ` ${said}` : \"\"}") && form.includes("if (cents == null || !Number.isFinite(cents)) return null;")
    && !form.includes("did not go through. The amount is back in your balance.`"),
    "the failed line reads what came back, never a guess (round 26)");
  const staff = read("../src/app/admin/AdminWithdrawals.jsx");
  assert.ok(staff.includes('const holds = row.status === "requested" ? Number(row.amount_cents) - refunded : Number(row.amount_cents);'), "a row being sent keeps the amount in flight");
  const order = read("../src/app/order/LiveOrderDetail.jsx");
  assert.ok(order.includes('return refund.refunded > 0 ? "Refunded" : DISPUTE_LOST;') && order.includes("if (isFactory && refundPendingWord(payment, order)) return sum;"),
    "a fully lost dispute reads Reversed by the brand's bank; no double subtraction");
  const card = read("../src/app/order/StripePayoutCard.jsx");
  assert.ok(card.includes("const promotable = otherManual.filter((row) => methodProviderOn(providers, row));") && card.includes("{promotable.map((row) => <option"),
    "removing the default never offers a switched-off method");
}

// Fix round 27: a failed withdrawal's row says what came back (stored
// back_cents), in its notice's words; the card's line reads the withdrawal's
// own figure when the page's figures are missing; staff's at-risk line is on
// its own line; one status line under the balance.
{
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const { failedWithdrawalNote, serverWithdrawalRows: server } = await import("../src/app/order/payment-summary.mjs");
  assert.equal(failedWithdrawalNote(60000, 60000), "Back in your balance. Check your withdrawal method, then withdraw again", "R32: main's words, true when all of it came back");
  assert.equal(failedWithdrawalNote(6500, 60000), "$65.00 is back in your balance. Check your withdrawal method, then withdraw again.", "the tester's $600 / $65");
  assert.equal(failedWithdrawalNote(0, 60000), "This amount was returned to the brand.");
  assert.equal(failedWithdrawalNote(null, 60000), null, "not kept: nothing said");
  const [row] = server([{ id: "w", road: "pool", provider: "paypal", word: "returned", amount_cents: 60000, back_cents: 6500, created_at: "2026-11-21T00:00:00Z" }],
    { pool: new Map([["w", { id: "w", status: "failed" }]]) });
  assert.equal(row.note, "$65.00 is back in your balance. Check your withdrawal method, then withdraw again.", "the Transactions row says $65.00, not the $600");
  const zh = read("../src/app/live-zh.js");
  const literals = [...zh.matchAll(/\[(\/\^.*?\$\/)[a-z]*,/g)].map(([, literal]) => new RegExp(literal.slice(1, -1)));
  for (const text of [row.note, failedWithdrawalNote(60000, 60000), "This amount was returned to the brand.",
    "Withdrawal of $600.00 did not go through. $65.00 is back in your balance.", "Withdrawal of $600.00 did not go through. This amount was returned to the brand."]) {
    assert.ok(literals.some((re) => re.test(text)), `Chinese for "${text}"`);
  }
  const form = read("../src/app/order/WithdrawFromBalance.jsx");
  assert.ok(form.includes("back instanceof Map && back.has(row.id) ? back.get(row.id) : row.back_cents") && read("../api/stripe-connect.js").includes("reason, back_cents, created_at"),
    "the card's failed line falls back to the withdrawal's own stored figure");
  const staff = read("../src/app/admin/AdminWithdrawals.jsx");
  assert.ok(staff.includes('<span className="admin-sub admin-error" data-testid="withdrawal-at-risk">'), "staff's at-risk line on its own line, in red");
  const card = read("../src/app/order/StripePayoutCard.jsx");
  assert.ok(card.includes("if (manualSaved) {\n      setMethodNotice(null);\n      setWithdrawn(false);")
    && card.includes("if (methodNotice) setWithdrawn(false);")
    && card.includes("manualSaved && !withdrawn && !failedLine && !(methodNotice && methodNotice !== shownInDialogOnly.current)"), "only the latest status line under the balance (W2)");
}

// Fix round 30 (G3): a step whose only withdrawal's Stripe payout failed is
// back in the balance: "Added to your balance", never "Paid".
{
  const summary = await import("../src/app/order/payment-summary.mjs");
  const step = (withdrawal) => ({ id: "p-g3", state: "released", released_note: "Withdrawn", release_requested_at: "2026-11-20T00:00:00Z",
    amount_cents: 6500, currency: "USD", stripe_transfer_id: null, payment_takes: [{ status: "sent", stripe_withdrawals: withdrawal }] });
  for (const withdrawal of [{ state: "fee_returned", payout_status: "failed" }, { state: "paid_out", payout_status: "failed" },
    { state: "paid_out", payout_status: "canceled" }, { state: "refused", payout_status: null }]) {
    assert.equal(summary.earningStatus(step(withdrawal)), summary.ADDED_TO_BALANCE, `payout ${withdrawal.state}/${withdrawal.payout_status}: the money is back in the balance`);
    assert.equal(summary.earningStatus(step(withdrawal), null, new Map()), summary.ADDED_TO_BALANCE, "with the server's figures too");
  }
  assert.equal(summary.earningStatus(step({ state: "paid_out", payout_status: "paid" })), "Paid", "paid out: Paid");
  assert.equal(summary.earningStatus({ ...step(null), payment_takes: [{ status: "sent" }] }), "Paid", "no embed (an older read): as before");
  const twoRoads = { ...step({ state: "fee_returned", payout_status: "failed" }) };
  twoRoads.payment_takes = [...twoRoads.payment_takes, { status: "sent", stripe_withdrawals: null }];
  assert.equal(summary.earningStatus(twoRoads), "Paid", "part of it paid by PayPal or Wise: Paid");
  // Still never listed as a second "Bank transfer" withdrawal.
  assert.deepEqual(summary.withdrawalRows([step({ state: "fee_returned", payout_status: "failed" })]), [], "no second withdrawal row");
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes(".select(EARNING_COLUMNS)") && summary.EARNING_COLUMNS.includes("payment_takes (status, stripe_withdrawals (state, payout_status))"),
    "Payments reads each take's Stripe withdrawal");
}

// Fix round 30 (G8): no red "You can withdraw up to …" while a withdrawal is
// being made (a read mid-request already counts the money as gone).
{
  const card = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  assert.ok(card.includes("if (busy || modal !== \"withdraw\" || !withdrawal || withdrawal.previous || liveStripeMax == null"), "the dialog's Available is not moved mid-request");
  assert.ok(card.includes("{!busy && !error && !withdrawal.previous && withdrawal.amountText && amountProblem ?"), "the over-balance line is not drawn mid-request");
  assert.ok(card.includes("{!busy && !error && stripeMinimumProblem ?"), "nor the minimum line");
}

// Fix round 31b (2): EUR and GBP in the Stripe account. The card names both
// in its existing line (it named only the first found), and the Chinese
// reads it; one withdrawal pays out in one currency (stripeMoneyUsd).
{
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const card = read("../src/app/order/StripePayoutCard.jsx");
  const start = card.indexOf("const heldElsewhere = stripeCounted");
  const heldOf = new Function("stripeCounted", "balance", card.slice(start, card.indexOf("// Someone who reads no Stripe balance", start)) + "return heldCurrency;");
  const balance = { available: [{ currency: "eur", amount: 9000 }, { currency: "gbp", amount: 8000 }, { currency: "usd", amount: 100 }], pending: [{ currency: "eur", amount: 10 }] };
  assert.equal(heldOf(1, balance), "EUR and GBP", "both currencies are named");
  assert.equal(heldOf(1, { available: [{ currency: "eur", amount: 9000 }], pending: [] }), "EUR");
  assert.equal(heldOf(1, { available: [{ currency: "eur", amount: 1 }, { currency: "gbp", amount: 1 }, { currency: "chf", amount: 1 }], pending: [] }), "EUR, GBP and CHF");
  assert.equal(heldOf(0, balance), null, "none when the figures count no Stripe money");
  const zh = read("../src/app/live-zh.js");
  const literals = [...zh.matchAll(/\[(\/\^.*?\$\/)[a-z]*,/g)].map(([, literal]) => new RegExp(literal.slice(1, -1)));
  for (const text of ["Part of your balance is held in EUR and GBP, so USD amounts are estimates.", "Part of your balance is held in EUR, GBP and CHF, so USD amounts are estimates."]) {
    assert.ok(literals.some((re) => re.test(text)), `Chinese for "${text}"`);
  }
  assert.ok(zh.includes('m[1].split(/, | and /).join("、")'), "the currencies listed with 、");
}

// Round 32 (screens review #2, #3, #14): one word for money on its way, one
// spelling of Cancelled, a colour for every status a Payments row can show,
// and the card's "pending" in main's Chinese.
{
  const summary = await import("../src/app/order/payment-summary.mjs");
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  const statusMap = page.slice(page.indexOf("const PAYOUT_STATUS = {"), page.indexOf("};", page.indexOf("const PAYOUT_STATUS = {")));
  assert.ok(/pending: "Processing"/.test(statusMap) && /in_transit: "Processing"/.test(statusMap) && /canceled: "Cancelled"/.test(statusMap),
    "an older Stripe payout on its way reads Processing; cancelled is spelled Cancelled");
  const cancelled = summary.serverWithdrawalRows([{ id: "s1", road: "stripe", word: "returned", amount_cents: 1000, created_at: "2026-11-02T00:00:00Z" }],
    { stripe: new Map([["s1", { payout_status: "canceled", payout_id: "po_1" }]]) });
  assert.equal(cancelled[0]?.status, "Cancelled", "R32: a Stripe payout cancelled reads Cancelled");
  const css = readFileSync(new URL("../src/app/order/payout.css", import.meta.url), "utf8");
  const words = ["Completed", "Paid", "Added to your balance", "Failed", "Cancelled", "Declined", "Refunded",
    summary.DISPUTE_LOST, "Order cancelled", "Processing", summary.ON_ITS_WAY, "Pending", summary.ON_HOLD, "Waiting", "Awaiting approval"];
  for (const word of words) {
    const slug = word.toLowerCase().replaceAll(" ", "-").replaceAll("'", "\\'");
    assert.ok(css.includes(`.payout-status-${slug}`), `R32: the "${word}" pill has a colour`);
  }
  assert.ok(!/#[0-9a-f]{6}/i.test(css.slice(css.indexOf("/* Every word a Payments row can show"), css.indexOf(".brand-transaction-view")).replace(/#fff0ed|#b93824|#eaf2ff/gi, "")),
    "R32: no new colours, only the existing red and blue");
  const zh = readFileSync(new URL("../src/app/live-zh.js", import.meta.url), "utf8");
  // The card's "$X pending." sentence went on Nov 23; no other Chinese for pending crept in.
  assert.ok(!zh.includes("待处理") && !zh.includes("已回到你的余额"), "R32: one Chinese for pending and for back in your balance");
  const bell = readFileSync(new URL("../src/shared/notification-zh.mjs", import.meta.url), "utf8");
  assert.ok(!bell.includes("已回到你的余额"), "R32: the bell says back in your balance as main does (已退回你的余额)");
  const hook = readFileSync(new URL("../src/app/order/WithdrawFromBalance.jsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../src/app/order/balance-reader.mjs", import.meta.url), "utf8");
  const balanceSide = reader.slice(reader.indexOf("export function withdrawalsFrom"));
  assert.ok(balanceSide.length > 0 && !/withdrawn|stripeFees|pool:|stripe_withdrawals|supabase/.test(balanceSide), "R32: no unread state, query or listener for the PayPal / Wise side");
  const { withdrawalsFrom } = await import("../src/app/order/balance-reader.mjs");
  const side = withdrawalsFrom({ reach: { pool_cents: 4500 }, returnable: { w1: "3000" }, withdrawals: [{ id: "w1", status: "requested" }, { id: "w0", status: "paid" }] });
  assert.deepEqual([side.available, side.opens.map((w) => w.id), side.last.id, side.returnable.get("w1"), side.error], [4500, ["w1"], "w1", 3000, null],
    "PayPal / Wise reach reach.pool_cents (what my_withdrawal_balance said: owed_reachable.any_cents, never below zero)");
  assert.equal(withdrawalsFrom(null, Object.assign(new Error("x"), { status: 401 })).error, "Your sign-in expired. Sign in again.");
  assert.equal(withdrawalsFrom(null, new Error("x")).error, "That didn't go through. Reload the page and try again.");
  assert.equal(withdrawalsFrom({ figures: {} }, new Error("x")).error, null, "a kept answer: no error line");
}

// Fix round 40 (final tester): the tester's own figures (factory_balance()
// rows as the database returned them on the stack).
{
  const summary = await import("../src/app/order/payment-summary.mjs");
  const words = await import("../src/app/order/stripe-card-words.mjs");
  const clears = "2099-11-25T00:00:00Z";
  const step = (id, amount) => pay(id, amount, "confirmed", { ...APPROVED, confirmed_at: "2026-11-21T00:00:00Z", funds_available_at: clears });
  const fullRefund = step("e1fd", 6500);   // TSC-000010: refunded in full after approval, still clearing
  const lostDispute = step("0df1", 5000);  // TSC-000005: dispute lost after approval, still clearing
  const partRefund = step("3acd", 6500);   // TSC-000006: $20 of $71.94 refunded, $46.93 left
  const figures = tsc({ pending_cents: 4693 }, {}, [
    { payment_id: "e1fd", figure: "refunded", amount_cents: -6500, stripe: false, cause: "refund" },
    { payment_id: "3acd", figure: "refunded", amount_cents: -1807, stripe: false, cause: "refund" },
    { payment_id: "3acd", figure: "pending", amount_cents: 4693, stripe: false, clears_at: clears },
    { payment_id: "0df1", figure: "refunded", amount_cents: -5000, stripe: false, cause: "dispute_lost" },
  ]);
  const perPayment = summary.paymentFigureCents(figures);
  // F1: no "Pending · Available <day>" row for money that went back to the brand.
  assert.equal(summary.stepRowCents(fullRefund, perPayment), null, "F1: refunded in full: no step row; the Refunded row says it");
  assert.equal(summary.stepRowCents(lostDispute, perPayment), null, "F1: dispute lost: no step row; the Reversed row says it");
  assert.equal(summary.stepRowCents(partRefund, perPayment), 4693, "F1: refunded in part: Pending only for what is left");
  assert.equal(earningStatus(partRefund, null, figuresByPayment(figures)), "Pending", "F1: what is left is still clearing");
  assert.equal(summary.refundRows(figures).length, 3, "F1: each refund keeps its own dated row");
  // What a page draws is the sum of the server's rows for those three steps.
  const drawn = [fullRefund, lostDispute, partRefund].map((row) => summary.stepRowCents(row, perPayment)).filter((cents) => cents !== null)
    .reduce((sum, cents) => sum + cents, 0);
  assert.equal(drawn, Number(figures.pending_cents), "F1: the rows' Pending equals the Pending figure");
  // Unchanged elsewhere: no refund, a released step (refund owed to TSC), no figures.
  assert.equal(summary.stepRowCents(step("plain", 6500), perPayment), 6500);
  assert.equal(summary.stepRowCents(pay("e1fd", 6500, "released", { stripe_transfer_id: "tr_1" }), perPayment), 6500, "a step already paid out keeps what was sent");
  assert.equal(summary.stepRowCents(fullRefund, new Map()), 6500, "figures not read: as before");
  const page = readFileSync(new URL("../src/app/order/PayoutDetails.jsx", import.meta.url), "utf8");
  assert.ok(page.includes(".filter((row) => stepRowCents(row, perPayment) !== null)") && page.includes("amount: stepRowCents(row, perPayment),"),
    "F1: Transactions draws the step rows from the server's figures");

  // F3, then Nov 23: the card no longer says "$X pending. Available to withdraw on …"
  // (each row says its own day); the disabled Withdraw's tooltip still follows the debt.
  const card = readFileSync(new URL("../src/app/order/StripePayoutCard.jsx", import.meta.url), "utf8");
  assert.ok(card.includes("arrivesOn && clearingAfterDebt(pendingLines.clearing, uncoveredDebtCents(figures)) > 0 ? availableOnWords(arrivesOn)")
    && !card.includes("pendingSentence(") && !/pending\. Available to withdraw on/.test(card), "F3: the disabled Withdraw's tooltip follows the debt; no pending sentence on the card");
  const zhSource = readFileSync(new URL("../src/app/live-zh.js", import.meta.url), "utf8");
  assert.ok(zhSource.includes("^Available to withdraw on ${MON}") && !zhSource.includes("on its way$/"), "the tooltip in Chinese; no \"$X on its way\" left");

  // F2: a Stripe bank with PayPal saved is not "your only withdrawal method".
  const bank = { id: "ba_1", currency: "eur", default: true, standard: true, last4: "0154" };
  assert.equal(words.stripeRemovalRefusal(bank, [bank], [], true, 1), "Stripe needs one bank account or debit card on file. Replace it instead.", "F2: PayPal saved too");
  assert.equal(words.stripeRemovalRefusal(bank, [bank], [], true, 0), "This is your only withdrawal method. Replace it instead.", "F2: truly the only one: main's sentence");
  assert.equal(words.stripeRemovalRefusal(bank, [bank], [], false, 1), "Stripe needs one bank account or debit card on file.");
  const usd = { id: "ba_2", currency: "usd", default: true, standard: true };
  assert.equal(words.stripeRemovalRefusal(bank, [bank, usd], [], true, 1), "Stripe needs one bank account or debit card in this currency. Replace it instead.");
  assert.equal(words.stripeRemovalRefusal(bank, [bank, usd], [], true, 0), "This is your only method in its currency. Replace it instead.", "main's sentence");
  assert.equal(words.stripeRemovalRefusal(bank, [bank, usd], [], false, 1), "This is your default Stripe method. Make another one the default first.");
  assert.equal(words.stripeRemovalRefusal({ ...bank, default: false }, [bank, { ...bank, id: "ba_3", default: false }], [], true, 1), null, "a second bank in its currency can go");
  assert.ok(card.includes("managed, manualAccounts.length)"), "F2: the dialog counts the company's other methods");
  const proto = readFileSync(new URL("../src/factory-prototype/main.jsx", import.meta.url), "utf8");
  for (const sentence of ["Stripe needs one bank account or debit card on file. Replace it instead.", "Stripe needs one bank account or debit card on file.",
    "Stripe needs one bank account or debit card in this currency. Replace it instead.", "This is your default Stripe method. Make another one the default first."]) {
    assert.ok(proto.includes(`"${sentence}": "`), `F2: Chinese for "${sentence}"`);
  }
}

console.log("earnings figures: every state in one place, adding up, same rules as the board; refunds on their own rows, owed to TSC inside Available");
