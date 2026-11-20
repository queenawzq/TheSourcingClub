import { payoutFailureSentence } from "../../shared/payout-failure-words.mjs";
import { dateFrom } from "../../lib/dates.js";

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
 * Whether this factory has had money paid through Stripe: its withdrawals
 * from Stripe are then listed from Stripe's answer, which only an owner reads.
 */
export const stripeRelevant = (earnings) => Boolean(earnings?.some((row) => row.state === "released" && row.stripe_transfer_id));

/**
 * The card's "$X pending" amount, in US$ cents: the Pending figure (all
 * clients) less what the card already lists on its own rows (withdrawals
 * waiting or being sent), so no amount is said twice on the card. Null until
 * the figure is known; never below 0.
 */
export function cardPendingCents(pendingTotal, shownElsewhere = 0) {
  if (pendingTotal == null) return null;
  return Math.max(0, Number(pendingTotal) - Math.max(0, Number(shownElsewhere) || 0));
}

/**
 * The one balance (D3), from the server only: factory_balance() for every
 * factory, or the `figures` of /api/stripe-connect `balance` for an owner
 * with a Stripe account (its own Stripe money added). The page never sums
 * payments into a figure.
 *
 * The four figures over the Transactions list, in US$ cents. Total earnings
 * is the four added up, never worked out on its own. Undefined (each) until
 * the figures answer.
 */
export function summaryFrom(figures) {
  if (!figures) return { total: undefined, approval: undefined, pending: undefined, paid: undefined };
  const n = (value) => Number(value) || 0;
  const approval = n(figures.awaiting_cents);
  const available = n(figures.available_cents);
  const pending = n(figures.pending_cents);
  const paid = n(figures.paid_out_cents);
  return { total: approval + available + pending + paid, approval, available, pending, paid };
}

const FIGURE_KEYS = ["awaiting_cents", "available_cents", "pending_cents", "paid_out_cents"];

/**
 * The Stripe answer's figures kept up to date with the database's: the
 * database part (`viaStripe.tsc`) replaced by a newer factory_balance() read,
 * the factory's own Stripe money (the difference) kept. So a step a brand
 * approves while the page is open moves the figures without asking Stripe
 * again. Either alone is used as it is.
 */
export function withStripePart(database, viaStripe) {
  if (!viaStripe?.tsc || !database) return viaStripe ?? database ?? null;
  // The server's own answer (api/_balance-figures.js), with its database part
  // swapped for a newer read: what the Stripe account adds is kept exactly as
  // the server worked it out, so an owner (balance) and a member (figures)
  // read the same figures.
  const merged = { ...viaStripe, has_method: Boolean(database.has_method), next_cleared_at: database.next_cleared_at ?? null, tsc: database };
  for (const key of FIGURE_KEYS) merged[key] = Number(database[key] ?? 0) + Number(viaStripe[key] ?? 0) - Number(viaStripe.tsc[key] ?? 0);
  merged.total_cents = FIGURE_KEYS.reduce((sum, key) => sum + merged[key], 0);
  return merged;
}

/**
 * payment id → the figures its money is in (factory_balance()'s `rows`): one
 * payment can be split, part available and part in a withdrawal.
 */
export function figuresByPayment(figures) {
  const map = new Map();
  for (const row of figures?.tsc?.rows ?? figures?.rows ?? []) {
    if (!row?.payment_id || !(Number(row.amount_cents) > 0)) continue;
    if (!map.has(row.payment_id)) map.set(row.payment_id, new Set());
    map.get(row.payment_id).add(row.figure);
  }
  return map;
}

/**
 * What each method can withdraw, in US$ cents (D5): the factory's Stripe
 * account reaches the cleared money TSC owes it and the money already in its
 * Stripe account; PayPal and Wise reach the same cleared money and what is
 * left in the balance kept for them, never the Stripe account's.
 *
 * The server's own answers come first: `server` is the balance action's
 * top-level `reach` ({ stripe_cents, pool_cents, estimated }), for an owner
 * with a Stripe account; `poolCents` is my_withdrawal_balance()'s
 * available_cents, the same number as reach.pool_cents, for everyone else.
 * Without them it is worked out from the figures' parts. Null until known.
 */
export function withdrawReach(figures, server = null, poolCents = null) {
  const parts = figures?.tsc?.parts ?? figures?.parts ?? null;
  const owed = Math.max(0, Number(parts?.owed_cleared_cents) || 0);
  const pool = Math.max(0, Number(parts?.pool_available_cents) || 0);
  const ownStripe = figures?.stripe ? Math.max(0, Number(figures.stripe.available_cents) || 0) : 0;
  const known = (value) => value != null && Number.isFinite(Number(value));
  return {
    stripe: known(server?.stripe_cents) ? Number(server.stripe_cents) : figures ? owed + ownStripe : null,
    balance: known(server?.pool_cents) ? Number(server.pool_cents) : known(poolCents) ? Number(poolCents) : figures ? owed + pool : null,
    // The Stripe amount was converted from the account's currency.
    estimated: Boolean(server?.estimated),
  };
}

/**
 * Stripe earnings still clearing: payment id → the day Stripe makes them
 * available (its available_on, a day at midnight UTC, in seconds). From the
 * owner's balance read (stripe-connect `balance`, pendingEarnings). Empty
 * when Stripe was not read: only an owner can.
 */
export const clearingFor = (stripeBalance) => new Map((stripeBalance?.pendingEarnings ?? [])
  .filter((entry) => entry?.paymentId).map((entry) => [entry.paymentId, Number(entry.available_on) || null]));
/** Paid through Stripe and not yet withdrawable there. */
export const isClearing = (row, clearing) => clearing instanceof Map && row?.state === "released" && Boolean(row.stripe_transfer_id) && clearing.has(row.id);
/** "Available Nov 19": Stripe's day, read in UTC (in New York it would be the day before). */
export function clearingNote(row, clearing) {
  const day = isClearing(row, clearing) ? clearing.get(row.id) : null;
  return day ? `Available ${new Date(day * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : null;
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
export const ON_HOLD = "On hold";
export const REFUNDED = "Refunded";
/**
 * Funded, then refunded to the brand (a refund or a lost dispute): it stays on
 * the list as "Refunded", in no figure, so an earning never vanishes silently.
 */
export const refundedEarning = (row) => Boolean(row?.refunded_at && !["confirmed", "released"].includes(row.state));
/** Earned and the factory's to withdraw or already sent: "Paid", or in its balance. */
export const earningPaid = (row, clearing = null, figures = null) => [ADDED_TO_BALANCE, "Paid"].includes(earningStatus(row, clearing, figures));

/**
 * "Available Nov 22" on an approved step whose card payment is still
 * clearing (its money is in Pending): the day it becomes withdrawable, in the
 * reader's zone (funds_available_at is an instant).
 */
export function owedClearingNote(row, figures) {
  if (earningStatus(row, null, figures) !== "Pending" || !stillClearing(row)) return null;
  return `Available ${new Date(row.funds_available_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * N4: an approved step paid the old way, one step at a time, whose payout is
 * still under way (an attempt processing, or one that failed and waits for
 * staff), and which the server counts in Pending. That money is being sent,
 * not processed for withdrawal: the card says "$X on its way", as before, and
 * leaves it out of "$X pending". US$ cents.
 */
export function legacyOnItsWayCents(earnings, figures) {
  return (earnings ?? []).filter((row) => {
    if (!toBeSent(row) || row.withdrawal_pool) return false;
    const where = figures instanceof Map ? figures.get(row.id) : null;
    if (!where || where.size !== 1 || !where.has("pending")) return false;
    const latest = [...attempts(row)].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return latest?.status === "processing" || latest?.status === "failed";
  }).reduce((sum, row) => sum + factoryAmount(row), 0);
}

/**
 * Where one earning stands: Awaiting approval, Added to your balance, Pending,
 * Paid. The one word for this money, on Payments and the factory's order page,
 * whoever reads it. Approved money is in the factory's balance whatever its
 * withdrawal method, or none (D3, D6): "Added to your balance", never
 * "Pending".
 *
 * On Payments, `figures` (figuresByPayment()) is where the server put it: an
 * approved step whose money is all in Pending (still clearing, or being sent
 * the old way, step by step) reads "Pending", as its figure does. `clearing`
 * (clearingFor()) does the same for a Stripe earning still clearing in the
 * factory's Stripe account. Without them (the order page), the payment alone
 * decides. How it was sent is on its withdrawal row.
 */
export function earningStatus(row, clearing = null, figures = null) {
  if (refundedEarning(row)) return REFUNDED;
  if (heldOnCancelledOrder(row)) return "Order cancelled";
  if (isClearing(row, clearing)) return "Pending";
  // A Stripe transfer reaches the factory's Stripe balance, not its bank: it is
  // "Paid out to your bank" only on its withdrawal row, once Stripe's payout lands.
  // Taken by one-balance withdrawals and sent: paid, whichever road took it.
  if (row.state === "released") return row.stripe_transfer_id && !withdrawnByTakes(row) ? ADDED_TO_BALANCE : "Paid";
  if (!toBeSent(row)) return "Awaiting approval";
  // The brand disputed its card charge: held until the dispute is settled,
  // never "available on" a day (the factory is told by its notification).
  if (row.disputed_at) return ON_HOLD;
  // The brand's card payment is still clearing: the same word on the order
  // page and on Payments, from the payment's own date.
  if (!row.withdrawal_pool && stillClearing(row)) return "Pending";
  const where = figures instanceof Map ? figures.get(row.id) : null;
  if (where && !row.withdrawal_pool && where.size === 1 && where.has("pending")) return "Pending";
  return ADDED_TO_BALANCE;
}

/** The brand's charge for this step is not yet available to TSC (funds_available_at, an instant). */
export function stillClearing(row, now = new Date()) {
  if (!row?.funds_available_at) return false;
  const when = new Date(row.funds_available_at);
  return !Number.isNaN(when.getTime()) && when > now;
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

/** Released by one-balance withdrawals: its takes were sent (released_note "Withdrawn"). */
const withdrawnByTakes = (row) => (row.payment_takes ?? []).some((take) => take.status === "sent")
  || (row.released_note === "Withdrawn" && !row.bank_payouts && !row.payoneer_payouts);

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
    // A balance step is paid by the withdrawal it was in, listed on its own:
    // the old pool, or one-balance withdrawals that took it (payment_takes
    // `sent`, by PayPal, Wise or both roads). Never a second "Bank transfer".
    if (row.state !== "released" || row.withdrawal_pool || row.stripe_transfer_id || attempts(row).some((attempt) => attempt.status === "paid")
      || withdrawnByTakes(row)) return tried;
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
  if (row.state !== "released" || row.stripe_transfer_id || row.payoneer_payouts || !row.released_by || withdrawnByTakes(row)) return null;
  return row.released_note?.trim() || null;
}

export const ENTER_AMOUNT = "Enter an amount to withdraw.";
export const DOLLARS_AND_CENTS = "Enter the amount in dollars and cents, like 45.50.";

/**
 * A withdrawal amount as typed, in cents, and what is wrong with it, if
 * anything. "1,000" and "$45" are read as meant; a negative, a word or a
 * third decimal place are not guessed at. More than `maxCents` is said, never
 * quietly changed. `format` writes the most for the sentence.
 */
export function parseWithdrawAmount(text, maxCents, format = (cents) => `$${(cents / 100).toFixed(2)}`) {
  const typed = String(text ?? "").trim().replace(/^\$/, "").replace(/[,\s]/g, "");
  if (!typed) return { cents: NaN, problem: ENTER_AMOUNT };
  if (/^\d*\.\d{3,}$/.test(typed)) return { cents: NaN, problem: DOLLARS_AND_CENTS };
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(typed)) return { cents: NaN, problem: ENTER_AMOUNT };
  const cents = Math.round(Number(typed) * 100);
  if (!(cents > 0)) return { cents, problem: ENTER_AMOUNT };
  if (maxCents != null && cents > maxCents) return { cents, problem: `You can withdraw up to ${format(maxCents)}.` };
  return { cents, problem: null };
}

/**
 * Payout fee and what arrives, in the factory's existing sentence
 * (payoutFeeSentence's words): the receive amount may be in the provider's
 * currency (Wise quotes a CNY amount).
 */
export function withdrawFeeLine(feeCents, receivesMinor, receivesCurrency = "USD") {
  if (!(Number(feeCents) >= 0) || !(Number(receivesMinor) > 0)) return null;
  const money = (cents, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  return `Payout fee ${money(Number(feeCents), "USD")} is taken from this payment: you receive ${money(Number(receivesMinor), String(receivesCurrency || "USD").toUpperCase())}.`;
}

/** A Stripe payout that has left and not yet reached the bank (until its arrival day). */
export const ON_ITS_WAY = "On its way";
export const BANK_PROCESSING = "Your bank is processing the payout.";
const STRIPE_PAYOUT_WORD = { paid: "Paid out to your bank", failed: "Failed", canceled: "Canceled" };

/**
 * The company's withdrawals to its Stripe bank, from stripe_withdrawals (any
 * member reads them), as Transactions rows: what reached the bank, the
 * withdrawal less Stripe's fee, in US$. "On its way" until its arrival day,
 * then "Paid out to your bank". `methodName(w)` names the bank where the
 * reader knows it (an owner's Stripe read), else nothing.
 */
export function companyStripeRows(withdrawals = [], methodName = () => null, now = new Date()) {
  return (withdrawals ?? []).filter((w) => w?.payout_id && w.usd_cents != null).map((w) => {
    const status = String(w.payout_status ?? "").toLowerCase();
    // Stripe's arrival is a day (payout_arrives_on), read as that day where
    // the reader is; older rows kept the instant, midnight UTC of that day.
    const arrives = w.payout_arrives_on ? dateFrom(w.payout_arrives_on)
      : w.payout_arrives_at ? dateFrom(String(w.payout_arrives_at).slice(0, 10)) : null;
    // A payout that failed or was cancelled, or a withdrawal that ended without one, didn't go.
    const failed = status === "failed" || status === "canceled" || ["refused", "fee_returned"].includes(w.state);
    // On its way until its arrival day, even once Stripe calls it paid.
    const arrived = status === "paid" && !(arrives && arrives > now);
    const fee = Math.max(0, Number(w.fee_cents) || 0);
    return {
      id: `stripe-${w.id}`,
      brandOrgId: null,
      currency: "USD",
      date: w.created_at,
      arrives: failed ? null : arrives,
      title: "Bank transfer",
      meta: methodName(w),
      status: failed ? STRIPE_PAYOUT_WORD[status] ?? "Failed" : arrived ? STRIPE_PAYOUT_WORD.paid : ON_ITS_WAY,
      note: failed ? null
        : arrived ? (fee ? `Fee ${(fee / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}, taken from it` : null)
        : BANK_PROCESSING,
      failed,
      amount: -(Number(w.usd_cents) - fee),
      type: "withdrawal",
      available: !failed,
    };
  });
}

/**
 * The card's lines under the balance, from the Pending figure, in US$ cents,
 * adding up to it exactly:
 *   clearing  card payments not yet cleared (TSC's, and the factory's own
 *             Stripe pending balance): "$X pending. Available to withdraw on …"
 *   onHold    steps whose card charge is disputed, and parts of a waiting
 *             withdrawal whose step was refunded: "$Z on hold"
 *   waiting   PayPal / Wise withdrawals asked for and waiting for staff:
 *             "$W waiting"
 *   onItsWay  the rest: withdrawals sent and on their way to the bank, and
 *             old step-by-step payouts being sent: "$Y on its way"
 * `opens` are the open PayPal / Wise withdrawals (factory_withdrawals).
 * Null until the figures answer.
 */
export function pendingParts(figures, opens = []) {
  if (!figures) return null;
  const n = (value) => Math.max(0, Number(value) || 0);
  const base = figures.tsc ?? figures;
  const parts = base.parts ?? {};
  const pending = n(figures.pending_cents);
  const list = base.withdrawals ?? figures.withdrawals ?? null;
  // A withdrawal partly held (a step under it refunded) may come as two entries
  // (on_hold and waiting) or as one carrying its held part (held_cents): either
  // way the held part is on hold and the rest keeps its word.
  const heldOf = (w) => (w?.word === "on_hold" ? n(w.amount_cents) : Math.min(n(w?.amount_cents), n(w?.held_cents ?? w?.on_hold_cents)));
  const sumOf = (word) => (list ?? []).reduce((sum, w) => sum + (word === "on_hold" ? heldOf(w)
    : w?.word === word ? n(w.amount_cents) - heldOf(w) : 0), 0);
  // The server's list says which withdrawals wait for staff and which are held;
  // without it (an older server), the open requests and the refunded rows do.
  const refundedHeld = list ? sumOf("on_hold") : (base.rows ?? []).filter((row) => row?.refunded && row.figure === "pending")
    .reduce((sum, row) => sum + n(row.amount_cents), 0);
  const onHold = Math.min(pending, n(parts.disputed_cents) + refundedHeld);
  const clearing = Math.min(pending - onHold, n(parts.owed_clearing_cents) + n(figures.stripe?.pending_cents));
  const asked = list ? sumOf("waiting")
    : Math.max(0, (opens ?? []).filter((w) => w?.status === "requested").reduce((sum, w) => sum + n(w.amount_cents), 0) - refundedHeld);
  const waiting = Math.min(pending - onHold - clearing, asked);
  // The rest: withdrawals the server calls on their way, and old step-by-step payouts being sent.
  return { pending, clearing, onHold, waiting, onItsWay: pending - onHold - clearing - waiting };
}

/**
 * Every withdrawal as a Transactions row, from the server's own list
 * (factory_balance().withdrawals: one entry per PayPal / Wise / bank and
 * Stripe withdrawal, amounts already in US$, `word` its state). The card's
 * lines and these rows are one source, so they never disagree.
 *
 * `pool` and `stripe` are the company's own rows by id (factory_withdrawals,
 * stripe_withdrawals), for what only they say: a cancelled request (never
 * listed), the reason staff declined, where a Stripe payout went. A
 * withdrawal that ended with nothing sent and no payout made is not listed.
 */
export function serverWithdrawalRows(list = [], { pool = new Map(), stripe = new Map(), methodName = () => null } = {}) {
  const money = (cents) => (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (list ?? []).flatMap((w) => {
    const fee = Math.max(0, Number(w.fee_cents) || 0);
    const base = { brandOrgId: null, currency: "USD", date: w.created_at, type: "withdrawal" };
    if (w.road === "pool") {
      const own = pool.get(w.id);
      if (own?.status === "cancelled") return [];
      const paid = w.word === "paid";
      return [{
        ...base,
        // A partly held withdrawal can come as two entries: one row each.
        id: `asked-${w.id}${w.word === "on_hold" ? "-held" : ""}`,
        title: ASKED_TITLE[w.provider] ?? "Bank transfer",
        meta: w.to ?? own?.paid_to ?? null,
        note: own?.status === "declined" ? own.reason
          : own?.status === "failed" ? WITHDRAWAL_FAILED_NOTE
          : paid && w.fee_cents != null ? `Fee ${money(fee)}, taken from it`
          : null,
        status: w.word === "waiting" ? "Waiting" : w.word === "on_hold" ? ON_HOLD : w.word === "on_its_way" ? "Processing"
          : paid ? "Completed" : ASKED_STATUS[own?.status] ?? "Failed",
        failed: w.word === "returned",
        amount: -(Number(w.amount_cents) - (paid ? fee : 0)),
        available: w.word !== "returned",
      }];
    }
    const own = stripe.get(w.id);
    // A Stripe withdrawal refused before any payout never happened.
    if (w.word === "returned" && !own?.payout_id) return [];
    const arrives = w.arrives_on ? dateFrom(w.arrives_on) : null;
    return [{
      ...base,
      id: `stripe-${w.id}`,
      title: "Bank transfer",
      meta: w.to ? [`To ${w.to}.`, own?.destination_bank].filter(Boolean).join(" · ") : own ? methodName(own) : null,
      arrives: w.word === "returned" ? null : arrives,
      note: w.word === "on_its_way" ? BANK_PROCESSING : w.word === "paid" && fee ? `Fee ${money(fee)}, taken from it` : null,
      status: w.word === "on_its_way" ? ON_ITS_WAY : w.word === "paid" ? STRIPE_PAYOUT_WORD.paid : STRIPE_PAYOUT_WORD[String(own?.payout_status ?? "").toLowerCase()] ?? "Failed",
      failed: w.word === "returned",
      amount: -Number(w.amount_cents),
      available: w.word !== "returned",
    }];
  });
}
