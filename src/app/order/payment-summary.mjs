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
/**
 * What earningStatus() reads of a payment: Payments and the factory's order
 * page select exactly this, so a step reads the same word on both.
 */
export const EARNING_COLUMNS = "id, order_id, amount_cents, amount_received_cents, charged_cents, payout_fee_cents, stripe_transfer_id, release_requested_at, funds_available_at, disputed_at, refunded_at, released_by, released_note, currency, state, due_at, sent_at, confirmed_at, released_at, created_at, order_milestones (title), payoneer_payouts (paid_to_email, payoneer_payment_id), bank_payouts (paid_to_bank, paid_to_last4), provider_payouts (id, provider, status, paid_to, amount_cents, currency, failure_code, failure_detail, details_asked_at, money_left_at, asked_to_check, created_at, updated_at, paid_at), payment_takes (status, stripe_withdrawals (state, payout_status))";

/**
 * The factory's word for each payment on one order, worked out as Payments
 * does: the same payment fields, the server's figures (factory_balance()),
 * and the order. payment id → word.
 */
export function earningWordsFor(rows, figures, order = null) {
  const placed = figuresByPayment(figures);
  return new Map((rows ?? []).map((row) => [row.id, earningStatus({ ...row, order: row.order ?? order }, null, placed)]));
}

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
 * The one balance (D3), from the server only: factory_balance() for every
 * factory, or the `figures` of /api/stripe-connect `balance` for an owner
 * with a Stripe account (its own Stripe money added). The page never sums
 * payments into a figure.
 *
 * The four figures over the Transactions list, in US$ cents. Total earnings
 * is the server's figures added up, never worked out on its own: the four,
 * plus withdrawals in progress (processing_cents), which are in no card,
 * plus the withdrawal fees taken from what was paid out: Paid out is what
 * arrived, but a fee does not make the factory's earnings smaller.
 * Undefined (each) until the figures answer.
 */
export function summaryFrom(figures) {
  if (!figures) return { total: undefined, approval: undefined, pending: undefined, processing: undefined, paid: undefined };
  const n = (value) => Number(value) || 0;
  const approval = n(figures.awaiting_cents);
  const available = n(figures.available_cents);
  const pending = n(figures.pending_cents);
  const processing = n(figures.processing_cents);
  const paid = n(figures.paid_out_cents);
  const parts = (figures.tsc ?? figures).parts ?? {};
  const fees = n(parts.withdrawal_fees_cents) + n(parts.stripe_withdrawal_fees_cents);
  return { total: approval + available + pending + processing + paid + fees, approval, available, pending, processing, paid, fees };
}

/**
 * Whether a `stripe_withdrawals` realtime event changed more than its lease
 * (`lease_until`, `updated_at`), by the last row seen per id (`seen`, a Map
 * this updates): the table has no full replica identity, so `payload.old`
 * holds the id only. A row not seen before (inserted, or first heard of) and
 * a delete count as changes.
 */
export function stripeWithdrawalMoved(seen, payload) {
  const row = payload?.new && Object.keys(payload.new).length ? payload.new : null;
  const id = row?.id ?? payload?.old?.id ?? null;
  if (!id) return false;
  if (!row) { seen.delete(id); return true; }
  const now = JSON.stringify(Object.keys(row).filter((field) => field !== "lease_until" && field !== "updated_at").sort().map((field) => [field, row[field]]));
  const before = seen.get(id);
  seen.set(id, now);
  return before !== now;
}

/**
 * When a pending ask of the figures action should run: null when an ask that
 * started after it was requested already answers it; otherwise in how many
 * ms. Where the read asks Stripe (`limited`), at most once every `minGapMs`
 * (figuresAskGap), whatever asked; otherwise it only waits out the debounce.
 */
export function figuresAskDelay({ now, requestedAt, lastAskAt = 0, limited = false, debounceMs = 1500, minGapMs = 60_000 }) {
  if (limited && lastAskAt >= requestedAt) return null;
  const debounce = Math.max(0, requestedAt + debounceMs - now);
  return limited ? Math.max(debounce, lastAskAt + minGapMs - now, 0) : debounce;
}

/**
 * The least time between two asks of the figures action, in ms, where the
 * read asks Stripe (`readsStripe`): a member's at most once a minute, an
 * owner's (about six Stripe reads) at most every 12 s; 0 (the debounce only)
 * where it does not.
 */
export const OWNER_ASK_GAP_MS = 12_000;
export const MEMBER_ASK_GAP_MS = 60_000;
export function figuresAskGap({ isOwner = false, readsStripe = false } = {}) {
  if (!readsStripe) return 0;
  return isOwner ? OWNER_ASK_GAP_MS : MEMBER_ASK_GAP_MS;
}

/**
 * Pool withdrawals the server lists as gone back (`returned`) that the
 * company's own rows (newest 200) do not hold: read by id, so a cancelled or
 * declined one never reads "Failed".
 */
export function missingPoolIds(serverList, known) {
  return [...new Set((serverList ?? [])
    .filter((w) => w?.road === "pool" && w.word === "returned" && w.id && !known.has(w.id))
    .map((w) => w.id))];
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
 * Per payment, from factory_balance()'s `rows`: what the server still counts
 * of it (its rows above zero) and what went back to the brand (its "refunded"
 * rows), in US$ cents.
 */
export function paymentFigureCents(figures) {
  const map = new Map();
  for (const row of figures?.tsc?.rows ?? figures?.rows ?? []) {
    if (!row?.payment_id) continue;
    const cents = Number(row.amount_cents) || 0;
    const entry = map.get(row.payment_id) ?? { left: 0, back: 0 };
    if (row.figure === "refunded" && cents < 0) entry.back -= cents;
    else if (cents > 0) entry.left += cents;
    map.set(row.payment_id, entry);
  }
  return map;
}

/**
 * The amount on a step's own Transactions row, from the server's figures
 * (paymentFigureCents()). A funded step refunded in part, or reversed by the
 * brand's bank, since lists only what the factory still earns from it, beside
 * the dated row that says what went back; with nothing left it has no row of
 * its own (null), since that dated row says it. A released step keeps what
 * was sent: a later refund of it is owed to TSC.
 */
export function stepRowCents(row, perPayment) {
  const own = factoryAmount(row);
  const entry = perPayment instanceof Map ? perPayment.get(row?.id) : null;
  if (row?.state !== "confirmed" || !entry || !(entry.back > 0)) return own;
  return entry.left > 0 ? Math.min(own, entry.left) : null;
}

/**
 * Money refunded to the brand (or a dispute lost) after the factory had
 * withdrawn it, in US$ cents: owed to TSC, already taken off Available
 * (factory_balance().owed_to_tsc_cents). 0 when none or not known.
 */
export const owedToTscCents = (figures) => Math.max(0, Number(figures?.tsc?.owed_to_tsc_cents ?? figures?.owed_to_tsc_cents) || 0);
/**
 * The part of it the factory's earnings do not cover
 * (factory_balance().uncovered_debt_cents): the card's line says only this,
 * and none once they cover it (Available is already net of it).
 */
export const uncoveredDebtCents = (figures) => Math.max(0, Number(figures?.tsc?.uncovered_debt_cents ?? figures?.uncovered_debt_cents) || 0);
/**
 * What of the money clearing (`clearing`, US$ cents) will be withdrawable once
 * it clears: a debt its cleared earnings do not cover (`debt`,
 * uncoveredDebtCents()) is paid from it first, as Available is net of it.
 */
export const clearingAfterDebt = (clearing, debt) => Math.max(0, (Number(clearing) || 0) - Math.max(0, Number(debt) || 0));
/**
 * The card's line for it (Available already counts it), in the words of what
 * sent the money back: a refund, a dispute lost, or both.
 */
export const owedToTscLine = (cents, formatMoney, cause = "refund") => {
  if (!(cents > 0)) return null;
  const owed = `You owe TSC ${formatMoney(cents, "USD")}.`;
  if (cause === "dispute_lost") return `${owed} The brand's bank reversed a payment after you withdrew it.`;
  if (cause === "both") return `${owed} Money was returned to the brand after you withdrew it.`;
  return `${owed} A payment was refunded after you withdrew it.`;
};
/** What sent it back, from the dated refund rows: "refund", "dispute_lost" or "both". */
export function owedToTscCause(figures) {
  const causes = new Set(refundRows(figures).map((row) => (row.cause === "dispute_lost" ? "dispute_lost" : "refund")));
  return causes.size > 1 ? "both" : causes.has("dispute_lost") ? "dispute_lost" : "refund";
}

/**
 * The dated rows a refund or a lost dispute adds to an earning (factory_balance()
 * rows with figure "refunded" below zero): the factory's part, on the day it
 * went back. The step's own row is never rewritten. `cause` "refund" or
 * "dispute_lost".
 */
export function refundRows(figures) {
  return (figures?.tsc?.rows ?? figures?.rows ?? [])
    .filter((row) => row?.figure === "refunded" && Number(row.amount_cents) < 0 && row.payment_id)
    .map((row) => ({ paymentId: row.payment_id, cause: row.cause === "dispute_lost" ? "dispute_lost" : "refund", at: row.at ?? null, amount: Number(row.amount_cents) }));
}
/** A lost dispute's word on a Transactions row (the amount is beside it), and its order-page line. */
export const DISPUTE_LOST = "Reversed by the brand's bank";
export const reversedByBankLine = (amount) => `${amount} reversed by the brand's bank`;

/**
 * What a refund or a lost dispute took from one payment, for its order-page
 * line: the brand's whole amount (refunded_cents, dispute_lost_cents) and the
 * factory's part (factory_refund_cents, the database's proportional split).
 */
export function paymentRefund(payment) {
  const n = (value) => Math.max(0, Number(value) || 0);
  const refunded = n(payment?.refunded_cents);
  const lost = n(payment?.dispute_lost_cents);
  const charged = n(payment?.charged_cents ?? payment?.amount_received_cents);
  return { refunded, lost, brand: refunded + lost, factory: n(payment?.factory_refund_cents), full: charged > 0 && refunded + lost >= charged };
}

/**
 * What each method can withdraw, in US$ cents (D5), as the server worked it
 * out (the balance read's `reach`): the factory's Stripe account reaches the
 * cleared money TSC owes it and the money already in its Stripe account;
 * PayPal and Wise reach the same cleared money, never the Stripe account's.
 * Null until known.
 */
export function withdrawReach(reach) {
  const known = (value) => value != null && Number.isFinite(Number(value));
  return {
    stripe: known(reach?.stripe_cents) ? Number(reach.stripe_cents) : null,
    balance: known(reach?.pool_cents) ? Number(reach.pool_cents) : null,
    // The Stripe amount was converted from the account's currency.
    estimated: Boolean(reach?.estimated),
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


/** A failed withdrawal that came back whole, as a row's note (main's words). */
export const WITHDRAWAL_FAILED_NOTE = "Back in your balance. Check your withdrawal method, then withdraw again";
/** Nothing of a withdrawal came back: all of it went to the brand while it was sent (withdrawal_back_sentence). */
export const NOTHING_BACK = "This amount was returned to the brand.";
/**
 * A failed withdrawal's row note: what came back (its stored back_cents), in
 * its notice's words (withdrawal_back_sentence). Nothing when it was not
 * kept: never a guess.
 */
export function failedWithdrawalNote(back, amount, currency = "USD") {
  if (back == null || !Number.isFinite(Number(back))) return null;
  const cents = Number(back);
  if (cents >= Number(amount)) return WITHDRAWAL_FAILED_NOTE;
  if (!(cents > 0)) return NOTHING_BACK;
  return `${(cents / 100).toLocaleString("en-US", { style: "currency", currency })} is back in your balance. Check your withdrawal method, then withdraw again.`;
}
/** A PayPal or Wise withdrawal waiting for TSC to approve it (before it is sent). */
export const AWAITING_REVIEW = "Awaiting review";
/** A withdrawal that reached the factory, whatever the method: one word on every row. */
export const WITHDRAWAL_DONE = "Completed";
const ASKED_STATUS = { requested: "Processing", paying: "Processing", paid: WITHDRAWAL_DONE, failed: "Failed", declined: "Declined", cancelled: "Cancelled" };
const ASKED_TITLE = { wise: "Bank transfer (Wise)", paypal: "PayPal", bank: "Bank transfer", tazapay: "Bank transfer" };

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
 * still under way (an attempt processing), and which the server counts in
 * Pending. That money is being sent,
 * not processed for withdrawal: the card says "$X on its way", as before, and
 * leaves it out of "$X pending". US$ cents.
 */
export function legacyOnItsWayCents(earnings, figures) {
  return (earnings ?? []).filter((row) => {
    if (!toBeSent(row)) return false;
    const where = figures instanceof Map ? figures.get(row.id) : null;
    if (!where || where.size !== 1 || !(where.has("processing") || where.has("pending"))) return false;
    return legacyPayoutUnderWay(row);
  }).reduce((sum, row) => sum + factoryAmount(row), 0);
}

/**
 * Its latest per-step payout is under way. One that failed is not: its money
 * reads where the server puts it, as its attempt's own row says "Failed".
 */
function legacyPayoutUnderWay(row) {
  const latest = [...attempts(row)].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  return latest?.status === "processing";
}

/**
 * Where one earning stands: Awaiting approval, Added to your balance, Pending,
 * Paid. The one word for this money, on Payments and the factory's order page,
 * whoever reads it. Approved money is in the factory's balance whatever its
 * withdrawal method, or none (D3, D6): "Added to your balance", never
 * "Pending".
 *
 * On Payments, `figures` (figuresByPayment()) is where the server put it: an
 * approved step whose money is all in Pending (still clearing) reads
 * "Pending", and one all in a withdrawal waiting or being sent (or sent the
 * old way, step by step, still under way) reads "Processing", as its figure
 * does. `clearing`
 * (clearingFor()) does the same for a Stripe earning still clearing in the
 * factory's Stripe account. Without them (the order page), the payment alone
 * decides. How it was sent is on its withdrawal row.
 */
export function earningStatus(row, clearing = null, figures = null) {
  if (refundedEarning(row)) return REFUNDED;
  if (heldOnCancelledOrder(row)) return "Order cancelled";
  if (isClearing(row, clearing)) return "Pending";
  // A Stripe transfer reaches the factory's Stripe balance, not its bank: it is
  // "Completed" only on its withdrawal row, once Stripe's payout lands.
  // Taken by one-balance withdrawals and sent: paid, whichever road took it.
  const where = figures instanceof Map ? figures.get(row.id) : null;
  // Part of it went in a Stripe withdrawal whose payout has not reached the
  // bank yet: on its way until it lands, like that withdrawal's own row.
  if (row.state === "released" && where?.has("on_its_way")) return ON_ITS_WAY;
  if (row.state === "released") return (row.stripe_transfer_id && !withdrawnByTakes(row)) || backInStripeBalance(row) ? ADDED_TO_BALANCE : "Paid";
  if (!toBeSent(row)) return "Awaiting approval";
  // The brand disputed its card charge: held until the dispute is settled,
  // never "available on" a day (the factory is told by its notification).
  if (row.disputed_at) return ON_HOLD;
  // The brand's card payment is still clearing: the same word on the order
  // page and on Payments, from the payment's own date.
  if (stillClearing(row)) return "Pending";
  if (where && where.size === 1 && where.has("pending")) return "Pending";
  // A payout sent step by step, under way: on its way, as the card counts it
  // (legacyOnItsWayCents).
  if (where && where.size === 1 && where.has("processing") && legacyPayoutUnderWay(row)) return ON_ITS_WAY;
  // All of it in a withdrawal waiting or being sent.
  if (where && where.size === 1 && where.has("processing")) return "Processing";
  return ADDED_TO_BALANCE;
}

/** The brand's charge for this step is not yet available to TSC (funds_available_at, an instant). */
export function stillClearing(row, now = new Date()) {
  if (!row?.funds_available_at) return false;
  const when = new Date(row.funds_available_at);
  return !Number.isNaN(when.getTime()) && when > now;
}

// A payout sent step by step that is under way: main's word, still true (the
// card's line counts it on its way: legacyOnItsWayCents).
const WITHDRAWAL_STATUS = { processing: "Processing", paid: WITHDRAWAL_DONE, failed: "Failed" };
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
 * A one-balance Stripe withdrawal's part that came back: transferred to the
 * factory's Stripe account, and its payout failed, was cancelled or was
 * refused, so the money is in that account's balance again (the take's
 * `stripe_withdrawals` embed: state and payout_status).
 */
const takeCameBack = (take) => take.status === "sent" && Boolean(take.stripe_withdrawals)
  && (["refused", "fee_returned"].includes(take.stripe_withdrawals.state)
    || ["failed", "canceled"].includes(take.stripe_withdrawals.payout_status));
/** Every part withdrawals sent of it came back to the balance: it is in the balance, not paid. */
export const backInStripeBalance = (row) => {
  const sent = (row.payment_takes ?? []).filter((take) => take.status === "sent");
  return sent.length > 0 && sent.every(takeCameBack);
};

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
    // A balance step is paid by the withdrawals that took it, listed on their
    // own (payment_takes `sent`, by PayPal, Wise or both roads; the old pool
    // became takes, 20261121350000). Never a second "Bank transfer".
    if (row.state !== "released" || row.stripe_transfer_id || attempts(row).some((attempt) => attempt.status === "paid")
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
      status: WITHDRAWAL_DONE,
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

/**
 * The Withdraw dialog's line for a bank in another currency (R2m10), in the
 * words of the paid notice's "Your bank receives EUR 1,811.69."
 * (api/_stripe-payout-events.js), with "about": the dialog converts at the
 * display rate, Stripe at its own when it pays.
 */
export function bankReceivesAboutLine(localMinor, currency) {
  const code = String(currency ?? "").toUpperCase();
  if (!code || code === "USD" || !(Number(localMinor) > 0)) return null;
  const figure = (Number(localMinor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Your bank receives about ${code} ${figure}.`;
}

/** A Stripe payout that has left and not yet reached the bank (until its arrival day): "Processing", like every withdrawal under way. */
export const ON_ITS_WAY = "Processing";
export const BANK_PROCESSING = "Your bank is processing the payout.";
const STRIPE_PAYOUT_WORD = { paid: WITHDRAWAL_DONE, failed: "Failed", canceled: "Cancelled" };

/**
 * The card's lines under the balance, in US$ cents, from the Pending figure
 * (earnings not yet available) and the Processing one (withdrawals in
 * progress), adding up to the two exactly:
 *   clearing  card payments not yet cleared (TSC's, and the factory's own
 *             Stripe pending balance): "$X pending. Available to withdraw on …"
 *             Pending is clearing plus onHold.
 *   onHold    earnings whose card charge is disputed and that no withdrawal
 *             holds (factory_balance().parts.disputed_cents): "$Z on hold"
 *   waiting   PayPal / Wise withdrawals waiting for staff, on hold, or being
 *             sent, each as a whole (its server word): its own "Processing
 *             withdrawal" block says it, so no line. A part that went back to
 *             the brand since is in no figure.
 *   onItsWay  the rest of Processing: Stripe withdrawals on their way to the
 *             bank and old step-by-step payouts being sent: "$Y on its way"
 * Null until the figures answer.
 */
export function pendingParts(figures) {
  if (!figures) return null;
  const n = (value) => Math.max(0, Number(value) || 0);
  const base = figures.tsc ?? figures;
  const parts = base.parts ?? {};
  const pending = n(figures.pending_cents);
  const processing = n(figures.processing_cents);
  const list = base.withdrawals ?? figures.withdrawals ?? [];
  const asked = list
    .filter((w) => w?.road === "pool" && ["waiting", "on_hold", "on_its_way"].includes(w.word))
    .reduce((sum, w) => sum + Math.max(0, n(w.amount_cents)
      - (w.parts ?? []).filter((part) => part?.word === "refunded").reduce((total, part) => total + n(part.amount_cents), 0)), 0);
  const onHold = Math.min(pending, n(parts.disputed_cents));
  const waiting = Math.min(processing, asked);
  return { pending, processing, clearing: pending - onHold, onHold, waiting, onItsWay: processing - waiting };
}

/**
 * Every withdrawal as a Transactions row, from the server's own list
 * (factory_balance().withdrawals: one entry per PayPal / Wise / bank and
 * Stripe withdrawal, amounts already in US$, `word` its state). The card's
 * lines and these rows are one source, so they never disagree.
 *
 * `pool` and `stripe` are the company's own rows by id (factory_withdrawals,
 * stripe_withdrawals), for what only they say: a cancelled request, the
 * reason staff declined, where a Stripe payout went. A cancelled or declined
 * request stays listed, muted, in no figure; a Stripe withdrawal that ended
 * with nothing sent and no payout made is not listed.
 */
export function serverWithdrawalRows(list = [], { pool = new Map(), stripe = new Map(), methodName = () => null, feeFor = () => null } = {}) {
  const money = (cents) => (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (list ?? []).flatMap((w) => {
    const fee = Math.max(0, Number(w.fee_cents) || 0);
    const base = { brandOrgId: null, currency: "USD", date: w.created_at, type: "withdrawal" };
    if (w.road === "pool") {
      const own = pool.get(w.id);
      const paid = w.word === "paid";
      // The fee from the start, as the Withdraw dialog said it: recorded once
      // paid, worked out the same way (feeFor) while it is waiting or being sent.
      const moving = ["waiting", "on_hold", "on_its_way"].includes(w.word);
      const poolFee = paid ? (w.fee_cents == null ? null : fee) : moving ? feeFor(w) : null;
      return [{
        ...base,
        id: `asked-${w.id}`,
        title: ASKED_TITLE[w.provider] ?? "Bank transfer",
        meta: w.to ?? own?.paid_to ?? null,
        note: own?.status === "declined" ? own.reason
          : own?.status === "failed" ? failedWithdrawalNote(w.back_cents ?? own.back_cents, w.amount_cents)
          : poolFee != null ? `Fee ${money(poolFee)}, taken from it`
          : null,
        status: w.word === "waiting" ? AWAITING_REVIEW : w.word === "on_hold" ? ON_HOLD : w.word === "on_its_way" ? "Processing"
          : paid ? WITHDRAWAL_DONE : ASKED_STATUS[own?.status] ?? "Failed",
        failed: w.word === "returned",
        // What it still holds: less the part that went back to the brand since (its "refunded" part).
        amount: -(Number(w.amount_cents) - (w.parts ?? []).filter((part) => part.word === "refunded").reduce((sum, part) => sum + (Number(part.amount_cents) || 0), 0) - (poolFee ?? 0)),
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
      meta: w.to ? [w.to, own?.destination_bank].filter(Boolean).join(" · ") : own ? methodName(own) : null,
      arrives: w.word === "returned" ? null : arrives,
      // The fee from the start (recorded with the withdrawal), then where the payout is.
      note: w.word === "on_its_way" ? (fee ? `Fee ${money(fee)}, taken from it. ${BANK_PROCESSING}` : BANK_PROCESSING)
        : w.word === "paid" && fee ? `Fee ${money(fee)}, taken from it` : null,
      status: w.word === "on_its_way" ? ON_ITS_WAY : w.word === "paid" ? STRIPE_PAYOUT_WORD.paid : STRIPE_PAYOUT_WORD[String(own?.payout_status ?? "").toLowerCase()] ?? "Failed",
      failed: w.word === "returned",
      amount: -Number(w.amount_cents),
      available: w.word !== "returned",
    }];
  });
}
