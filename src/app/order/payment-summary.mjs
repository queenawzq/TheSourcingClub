import { payoutFailureSentence } from "../../shared/payout-failure-words.mjs";

/** The step as earned, before any payout fee. */
export const grossAmount = (row) => row.charged_cents ? row.amount_cents : row.amount_received_cents ?? row.amount_cents;
/** The provider's payout fee the factory paid on it (src/shared/withdrawal-fees.mjs), recorded before the money moved. */
export const payoutFee = (row) => Math.max(0, Number(row?.payout_fee_cents) || 0);
/**
 * What the factory receives for a payment: the step less the payout fee. The
 * one figure for the row, the balance, the card and the summary tiles.
 */
export const factoryAmount = (row) => Number(grossAmount(row)) - payoutFee(row);

/** Keep currencies separate: a converted bank withdrawal is not a USD total. */
export function currencyTotals(rows) {
  const totals = new Map();
  for (const { amount, currency } of rows) {
    const code = currency.toUpperCase();
    totals.set(code, (totals.get(code) || 0) + Number(amount));
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

/**
 * Where money with TSC stands, by the same rules as the staff board's buckets
 * (AdminPayments, `check:earnings`). Held on a cancelled order is on its way
 * back to the brand, so it is nobody's earnings; approved before the
 * cancellation is still owed.
 */
export const awaitingApproval = (row) => row.state === "confirmed" && !row.release_requested_at && row.order?.status !== "cancelled";
export const toBeSent = (row) => row.state === "confirmed" && Boolean(row.release_requested_at);
/** Provider attempts, as the embed gives them: a list, or nothing for a brand. */
const attempts = (row) => row.provider_payouts ?? [];
/**
 * Money that has left TSC and is moving. A Wise transfer nobody has funded has
 * not left, and PayPal holding a payment for an address with no account is not
 * moving: both are still the factory's balance.
 */
const moving = (attempt) => attempt.status === "processing" && Boolean(attempt.money_left_at) && !attempt.details_asked_at;
export const onItsWay = (row) => toBeSent(row) && attempts(row).some(moving);
export const heldOnCancelledOrder = (row) => row.state === "confirmed" && !row.release_requested_at && row.order?.status === "cancelled";
/** The brand's one wording for that money, until it is back with them; null for any other payment. */
export const refundPendingWord = (payment, order) => (heldOnCancelledOrder({ ...payment, order }) ? "Refund pending" : null);

/**
 * Whether Stripe's answer changes this factory's figures: only once TSC has
 * paid one of its earnings through Stripe. A bank-paid factory, or one paid
 * nothing through Stripe yet, never waits for it.
 */
export const stripeRelevant = (earnings) => Boolean(earnings?.some((row) => row.state === "released" && row.stripe_transfer_id));

/**
 * Not paid through Stripe (Wise, PayPal, by hand, or no method yet): no Stripe account that can
 * take transfers, and nothing paid through Stripe so far. The factory's money
 * is then wherever its payments say, and Stripe has nothing to add.
 */
export const isHandPaid = (account, earnings) => !account?.transfers_active && !stripeRelevant(earnings);

/**
 * The card's figures for a factory paid by hand, across all clients. Balance is
 * approved and not moving yet; on its way has left TSC; pending is waiting for
 * the brand. Balance + on its way is the strip's Pending.
 * Null until the earnings answer.
 */
export function handPaidFigures(earnings) {
  if (!earnings) return { balance: null, onItsWay: null, pending: null };
  const amounts = (rows) => currencyTotals(rows.map((row) => ({ amount: factoryAmount(row), currency: row.currency })));
  return {
    balance: amounts(earnings.filter((row) => toBeSent(row) && !onItsWay(row))),
    onItsWay: amounts(earnings.filter(onItsWay)),
    pending: amounts(earnings.filter(awaitingApproval)),
  };
}

/**
 * The four figures over the Transactions list: each earning in exactly one of
 * Awaiting approval, Pending and Paid out, by the word on its own row, so they
 * add up to Total earnings for whoever reads them. All from the payments, in the
 * orders' currency, never from Stripe: what a factory later moved from its
 * Stripe balance to its bank is a withdrawal, not a second kind of paid. Each is
 * undefined until the earnings answer.
 */
export function earningsSummaryFor(earnings, client, withdrawn = new Map(), withdrawalFees = 0) {
  if (!earnings) return { total: undefined, approval: undefined, pending: undefined, paid: undefined };
  const all = client === "All clients";
  const selected = (row) => all || row?.order?.brand_org_id === client;
  const funded = earnings.filter((row) => ["confirmed", "released"].includes(row.state) && !heldOnCancelledOrder(row) && selected(row));
  const amounts = (rows) => currencyTotals(rows.map((row) => ({ amount: factoryAmount(row), currency: row.currency })));
  // A step still owed that paid withdrawals have taken part of: that part is
  // Paid out, not Pending (withdrawn_by_payment(), the balance's own source).
  const taken = funded.filter((row) => toBeSent(row) && withdrawn.get(row.id) > 0)
    .map((row) => ({ amount: Math.min(Number(withdrawn.get(row.id)), factoryAmount(row)), currency: row.currency }));
  return {
    total: currencyTotals([...funded.map((row) => ({ amount: factoryAmount(row), currency: row.currency })),
      ...(all && withdrawalFees ? [{ amount: -withdrawalFees, currency: "USD" }] : [])]),
    approval: amounts(funded.filter(awaitingApproval)),
    pending: currencyTotals([...funded.filter(toBeSent).map((row) => ({ amount: factoryAmount(row), currency: row.currency })),
      ...taken.map((part) => ({ ...part, amount: -part.amount }))]),
    // Net, like factoryAmount(): the fee a paid withdrawal took never reached the
    // factory. Withdrawals span clients, so only All clients carries their fees.
    paid: currencyTotals([...funded.filter((row) => row.state === "released").map((row) => ({ amount: factoryAmount(row), currency: row.currency })), ...taken,
      ...(all && withdrawalFees ? [{ amount: -withdrawalFees, currency: "USD" }] : [])]),
  };
}

/** The bell's words for a failed withdrawal, as a row's note. No trailing full stop, like the short asks. */
export const WITHDRAWAL_FAILED_NOTE = "Back in your balance. Check your withdrawal method, then withdraw again";
const ASKED_STATUS = { requested: "Waiting", paying: "Processing", paid: "Completed", failed: "Failed", declined: "Declined" };
const ASKED_TITLE = { wise: "Bank transfer (Wise)", paypal: "PayPal", bank: "Bank transfer", tazapay: "Bank transfer" };

/** A withdrawal the factory asked for, as a Transactions row. A cancelled one never happened. */
export function askedWithdrawalRows(withdrawals = []) {
  return withdrawals.filter((w) => w.status !== "cancelled").map((w) => ({
    brandOrgId: null,
    currency: w.currency,
    id: `asked-${w.id}`,
    date: w.paid_at || w.created_at,
    title: ASKED_TITLE[w.provider] ?? "Bank transfer",
    meta: w.paid_to,
    // A failed one took no fee: its amount is back in the balance (record_withdrawal).
    note: w.status === "declined" ? w.reason
      : w.status === "failed" ? WITHDRAWAL_FAILED_NOTE
      : w.fee_cents != null && w.receives_minor != null ? `Fee ${(Number(w.fee_cents) / 100).toLocaleString("en-US", { style: "currency", currency: w.currency })}, taken from it`
      : null,
    status: ASKED_STATUS[w.status] ?? w.status,
    failed: ["failed", "declined"].includes(w.status),
    // What reached the factory, like the provider rows: the amount less its fee once paid.
    amount: -(Number(w.amount_cents) - (w.status === "paid" ? Number(w.fee_cents ?? 0) : 0)),
  }));
}

export const ADDED_TO_BALANCE = "Added to your balance";
/** Earned and the factory's to withdraw or already sent: "Paid", or in its Stripe balance. */
export const earningPaid = (row) => [ADDED_TO_BALANCE, "Paid"].includes(earningStatus(row));

/**
 * Where one earning stands: Awaiting approval, Pending, Paid. The one word for
 * this money, on Payments and the factory's order page, whoever reads it: it
 * comes from the payment alone, never from Stripe's answer, which only an owner
 * can read. Money Stripe is still clearing is Paid here and on the strip; the
 * card says when it can be withdrawn. How it was sent is on its withdrawal row.
 */
export function earningStatus(row) {
  if (heldOnCancelledOrder(row)) return "Order cancelled";
  // A Stripe transfer reaches the factory's Stripe balance, not its bank: it is
  // "Paid out to your bank" only on its withdrawal row, once Stripe's payout lands.
  if (row.state === "released") return row.stripe_transfer_id ? ADDED_TO_BALANCE : "Paid";
  return row.release_requested_at ? "Pending" : "Awaiting approval";
}

const WITHDRAWAL_STATUS = { processing: "Processing", paid: "Completed", failed: "Failed" };
const FAILURE_NOTE = {
  details_rejected: { wise: "Check your bank details", paypal: "Check your PayPal address" },
};

/** Sent, but the provider is holding it until the factory corrects its details. */
export const waitingOnDetails = (attempt) => attempt.status === "processing" && Boolean(attempt.details_asked_at);
const askFor = (attempt) => FAILURE_NOTE.details_rejected[attempt.provider];

/**
 * What a failed attempt asks of this person: what staff asked it to check, else
 * why the provider says it failed (src/shared/payout-failure-words.mjs), in a
 * sentence the bell repeats. No trailing full stop, like the short asks.
 */
export const failureNote = (attempt) => attempt.asked_to_check
  ?? (attempt.failure_detail ? null : FAILURE_NOTE[attempt.failure_code]?.[attempt.provider])
  ?? payoutFailureSentence(attempt.provider, attempt.failure_detail).replace(/\.$/, "");

/**
 * PayPal holds this payment for the address it was sent to, and the factory has
 * since moved on from that address: the money does not follow it. Asking again
 * would be wrong, and so would saying it is on its way. Staff take it back and
 * pay again (the board says so).
 */
const sentToOldAddress = (attempt, method) => waitingOnDetails(attempt) && Boolean(method)
  && (method.paypal_email ?? "").toLowerCase() !== (attempt.paid_to ?? "").toLowerCase();
const WILL_RESEND = "TSC will send it again";

/** A failure that asked for a correction, and the details have changed since. */
const detailsChangedSince = (attempt, method) => (Boolean(attempt.asked_to_check) || attempt.failure_code === "details_rejected")
  && Boolean(method?.details_changed_at) && new Date(method.details_changed_at) > new Date(attempt.updated_at ?? attempt.created_at);

const when = (row) => row.released_at || row.confirmed_at || row.created_at;

/**
 * A payment sent by anything but Stripe, as rows of its own: one per Wise or
 * PayPal attempt, or one for what staff marked paid by hand. Stripe's own
 * withdrawals come from Stripe. A failed one is drawn struck through: that money
 * never left. An attempt that has not left TSC yet is no withdrawal: that money
 * is on the row of its earning, and staff may still take it back.
 */
export function withdrawalRows(earnings, method = null) {
  return (earnings ?? []).flatMap((row) => {
    const owner = { brandOrgId: row.order?.brand_org_id, currency: row.currency };
    const tried = attempts(row).filter((attempt) => attempt.status !== "processing" || attempt.money_left_at).map((attempt) => ({
      ...owner,
      id: `provider-${attempt.id}`,
      date: attempt.paid_at || attempt.created_at,
      title: attempt.provider === "paypal" ? "PayPal" : "Bank transfer",
      meta: attempt.paid_to,
      note: attempt.status === "failed" ? (detailsChangedSince(attempt, method) ? null : failureNote(attempt)) : sentToOldAddress(attempt, method) ? WILL_RESEND : waitingOnDetails(attempt) ? askFor(attempt) : null,
      status: waitingOnDetails(attempt) ? "Waiting" : WITHDRAWAL_STATUS[attempt.status],
      failed: attempt.status === "failed",
      // What left for the factory: the attempt less the payout fee taken from it.
      amount: -(Number(attempt.amount_cents) - payoutFee(row)),
    }));
    // A balance step is paid by the withdrawal it was in, listed on its own.
    if (row.state !== "released" || row.withdrawal_pool || row.stripe_transfer_id || attempts(row).some((attempt) => attempt.status === "paid")) return tried;
    const bank = row.bank_payouts;
    const payoneer = row.payoneer_payouts;
    return [...tried, {
      ...owner,
      id: `sent-${row.id}`,
      date: when(row),
      title: payoneer ? "Payoneer" : "Bank transfer",
      meta: payoneer ? payoneer.paid_to_email
        : bank?.paid_to_bank ? `${bank.paid_to_bank}${bank.paid_to_last4 ? ` ending ${bank.paid_to_last4}` : ""}` : "",
      note: payoneer ? `Reference ${payoneer.payoneer_payment_id}` : staffBankNote(row) ? `Reference ${staffBankNote(row)}` : null,
      status: "Completed",
      failed: false,
      amount: -factoryAmount(row),
    }];
  });
}

/**
 * What the card must raise, in the bell's words: the newest attempt on a payment
 * still owed, if it failed or is waiting on the factory's details. A failed one
 * stops asking once the details change; nothing was sent, so nothing is left to
 * say. A waiting one still has the money at the old address.
 */
export function withdrawalProblem(earnings, method) {
  const attempt = (earnings ?? []).filter(toBeSent)
    .map((row) => [...attempts(row)].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0])
    .find((latest) => latest?.status === "failed" || (latest && waitingOnDetails(latest)));
  if (!attempt) return null;
  const amount = (Number(attempt.amount_cents) / 100).toLocaleString("en-US", { style: "currency", currency: attempt.currency ?? "USD" });
  if (sentToOldAddress(attempt, method)) return { fixable: false, line: `Your payment of ${amount} is waiting. ${WILL_RESEND}.` };
  if (waitingOnDetails(attempt)) return { fixable: true, line: `Your payment of ${amount} is waiting. ${askFor(attempt)}.` };
  if (detailsChangedSince(attempt, method)) return null;
  const fixable = Boolean(attempt.asked_to_check) || attempt.failure_code === "details_rejected";
  return { fixable, line: `A withdrawal failed. ${failureNote(attempt)}.` };
}

/**
 * What staff typed when they marked this paid by bank, for the factory to find
 * the transfer by. A person's note only: Stripe's own payouts write a sentence
 * of their own into the same column, with nobody in released_by.
 */
export function staffBankNote(row) {
  if (row.state !== "released" || row.stripe_transfer_id || row.payoneer_payouts || !row.released_by) return null;
  return row.released_note?.trim() || null;
}
