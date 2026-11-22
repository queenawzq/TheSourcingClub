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
 * is the server's figures added up, never worked out on its own: the four,
 * plus withdrawals in progress (processing_cents), which are in no card.
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
  return { total: approval + available + pending + processing + paid, approval, available, pending, processing, paid };
}

const FIGURE_KEYS = ["awaiting_cents", "available_cents", "pending_cents", "processing_cents", "paid_out_cents"];

/**
 * Whether a newer factory_balance() read knows of a Stripe withdrawal the
 * server's answer (`viaStripe.tsc`) did not know in that state: a new one, or
 * one since closed, refused, given its fee back or whose payout failed. Each
 * moves money in or out of the factory's Stripe account, which only the
 * server can read, so the Stripe part of that answer can no longer be patched
 * (withStripePart): the page asks the server again. A payout that was on its
 * way and has arrived moves nothing in Stripe.
 */
export function stripePartStale(database, viaStripe) {
  if (!viaStripe?.tsc || !database) return false;
  const known = new Map((viaStripe.tsc.withdrawals ?? []).filter((w) => w?.road === "stripe").map((w) => [w.id, w.word]));
  return (database.withdrawals ?? []).some((w) => {
    if (w?.road !== "stripe") return false;
    if (!known.has(w.id)) return true;
    const before = known.get(w.id);
    return before !== w.word && !(before === "on_its_way" && w.word === "paid");
  });
}

/**
 * The server's balance answer, asked again (at most `tries` times in all,
 * `waitMs` apart) while it says its reads were not of one moment
 * (`figures.consistent === false`: a withdrawal moved money while it read).
 * The last answer is returned either way; a later ask that fails keeps the
 * one before it.
 */
export async function askUntilConsistent(ask, { tries = 3, waitMs = 1500, wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) } = {}) {
  let answer = await ask();
  for (let attempt = 1; attempt < tries && answer?.figures?.consistent === false; attempt += 1) {
    await wait(waitMs);
    try {
      answer = await ask();
    } catch {
      break;
    }
  }
  return answer;
}

/**
 * The fields of a Stripe withdrawal that move money or change what it says.
 * Not `lease_until` or `updated_at`: a call claiming or giving up its lease
 * on a withdrawal changes only those, and asking the server again on that
 * made a page and a withdrawal that would not settle feed each other.
 */
export const STRIPE_WITHDRAWAL_MONEY_FIELDS = ["state", "transfers_done_at", "payout_id", "payout_status", "fee_cents", "refusal_cause", "reversals"];

/**
 * Whether a `stripe_withdrawals` realtime event changed a money field, by the
 * last row seen per id (`seen`, a Map this updates): the table has no full
 * replica identity, so `payload.old` holds the id only. A row not seen before
 * (inserted, or first heard of) and a delete count as changes.
 */
export function stripeWithdrawalMoved(seen, payload, { anyField = false } = {}) {
  const row = payload?.new && Object.keys(payload.new).length ? payload.new : null;
  const id = row?.id ?? payload?.old?.id ?? null;
  if (!id) return false;
  if (!row) { seen.delete(id); return true; }
  // anyField: every column but the lease's two (what the list shows, too).
  const pick = (value) => JSON.stringify(anyField
    ? Object.keys(value).filter((field) => field !== "lease_until" && field !== "updated_at").sort().map((field) => [field, value[field]])
    : STRIPE_WITHDRAWAL_MONEY_FIELDS.map((field) => value?.[field] ?? null));
  const before = seen.get(id);
  const now = pick(row);
  seen.set(id, now);
  return before !== now;
}

/**
 * A cap on asks made because a withdrawal changed: at most `perId` per
 * withdrawal and `total` in all within `windowMs`. `allow(id, now)` records
 * the ask when it says yes.
 */
export function realtimeAskCap({ perId = 2, total = 4, windowMs = 60_000 } = {}) {
  let asks = [];
  return {
    allow(id, now = Date.now()) {
      asks = asks.filter((ask) => now - ask.at < windowMs);
      if (asks.length >= total || asks.filter((ask) => ask.id === id).length >= perId) return false;
      asks.push({ id, at: now });
      return true;
    },
  };
}

/**
 * When a pending ask of the figures action should run: null when an ask that
 * started after it was requested already answers it; otherwise in how many
 * ms. A member's page (nobody there reads Stripe) asks at most once every
 * `minGapMs`, whatever asked; an owner's only waits out the debounce.
 */
export function figuresAskDelay({ now, requestedAt, lastAskAt = 0, limited = false, debounceMs = 1500, minGapMs = 60_000 }) {
  if (limited && lastAskAt >= requestedAt) return null;
  const debounce = Math.max(0, requestedAt + debounceMs - now);
  return limited ? Math.max(debounce, lastAskAt + minGapMs - now, 0) : debounce;
}

/**
 * Answers applied in the order they were asked: `start()` numbers an ask,
 * `accept(n)` is true only when no later ask has been applied, so an older
 * answer that lands last never wins. `skip()` numbers and applies a reset
 * at once (what was asked before it is then older).
 */
export function answerOrder() {
  let asked = 0;
  let applied = 0;
  return {
    start: () => { asked += 1; return asked; },
    accept: (n) => { if (n <= applied) return false; applied = n; return true; },
    skip: () => { asked += 1; applied = asked; return asked; },
  };
}

/**
 * What a member's page keeps when asking the figures action fails. A first
 * ask: the database's figures as the server sent them (marked Stripe
 * unavailable), else nothing. A later ask: the last answer stays, its time
 * too (`dated` false), as the owner's card keeps its last balance.
 */
export function figuresAfterFailedAsk(previous, failure) {
  if (previous) return { figures: previous, dated: false };
  return { figures: failure?.details?.figures ?? null, dated: true };
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
  const merged = { ...viaStripe, has_method: Boolean(database.has_method), no_saved_method: database.no_saved_method === true, next_cleared_at: database.next_cleared_at ?? null, tsc: database };
  const part = {};
  for (const key of FIGURE_KEYS) part[key] = Number(viaStripe[key] ?? 0) - Number(viaStripe.tsc[key] ?? 0);
  // A Stripe withdrawal the newer read has recorded (its payout made, or
  // refused) is in the database's figures now: the Stripe money it held when
  // the server read is not counted again.
  const recorded = new Set((database.withdrawals ?? []).filter((w) => w?.road === "stripe").map((w) => w.id));
  const heldBy = viaStripe.stripe?.held_by ?? [];
  const gone = heldBy.filter((row) => recorded.has(row.id)).reduce((sum, row) => sum + (Number(row.cents) || 0), 0);
  const drop = Math.min(gone, Math.max(0, part.processing_cents));
  part.processing_cents -= drop;
  part.paid_out_cents += drop;
  // Never more in the Stripe account than the newer read counts as sent:
  // Paid out never goes below zero (the same order as the server's). Which
  // Stripe figure the excess came from cannot be known without reading
  // Stripe, so this is only what shows until the server is asked again
  // (`stripe_part_stale`), never the answer.
  let over = Math.max(0, -(Number(database.paid_out_cents ?? 0) + part.paid_out_cents));
  const clamped = over > 0;
  for (const key of ["available_cents", "pending_cents", "processing_cents"]) {
    const take = Math.min(over, Math.max(0, part[key]));
    part[key] -= take;
    part.paid_out_cents += take;
    over -= take;
  }
  for (const key of FIGURE_KEYS) merged[key] = Number(database[key] ?? 0) + part[key];
  merged.total_cents = FIGURE_KEYS.reduce((sum, key) => sum + merged[key], 0);
  // The Stripe part is a bridge here, not known: the page asks the server again.
  if (clamped || stripePartStale(database, viaStripe)) merged.stripe_part_stale = true;
  if (viaStripe.stripe) {
    merged.stripe = { ...viaStripe.stripe, available_cents: part.available_cents, pending_cents: part.pending_cents,
      processing_cents: part.processing_cents, held_cents: part.processing_cents,
      held_by: heldBy.filter((row) => !recorded.has(row.id)) };
    // Converted only while some Stripe money is still counted.
    merged.estimated = Boolean(viaStripe.estimated) && part.available_cents + part.pending_cents + part.processing_cents > 0;
  }
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
 * What each method can withdraw, in US$ cents (D5): the factory's Stripe
 * account reaches the cleared money TSC owes it and the money already in its
 * Stripe account; PayPal and Wise reach the same cleared money, never the
 * Stripe account's.
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
  const ownStripe = figures?.stripe ? Math.max(0, Number(figures.stripe.available_cents) || 0) : 0;
  const known = (value) => value != null && Number.isFinite(Number(value));
  // Refunded after it was withdrawn: owed to TSC, taken off what can be withdrawn.
  const debt = Math.max(0, Number(owedToTscCents(figures)) || 0);
  return {
    stripe: known(server?.stripe_cents) ? Number(server.stripe_cents) : figures ? Math.max(0, owed + ownStripe - debt) : null,
    balance: known(server?.pool_cents) ? Number(server.pool_cents) : known(poolCents) ? Number(poolCents) : figures ? Math.max(0, owed - debt) : null,
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

/** "To bank account ending in 0154.": a Stripe destination label mid-sentence, lower case. */
export const toDestination = (label) => `To ${String(label).replace(/^(Bank account|Debit card)\b/, (named) => named.toLowerCase())}.`;

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
const ASKED_STATUS = { requested: "Processing", paying: "Processing", paid: "Completed", failed: "Failed", declined: "Declined", cancelled: "Cancelled" };
/**
 * A withdrawal that ended without the money leaving the balance (failed,
 * declined by staff, or cancelled by the factory): listed, its amount muted
 * and struck through, in no figure.
 */
const ENDED_UNSENT = ["failed", "declined", "cancelled"];
const ASKED_TITLE = { wise: "Bank transfer (Wise)", paypal: "PayPal", bank: "Bank transfer", tazapay: "Bank transfer" };

/** A withdrawal the factory asked for, as a Transactions row; a cancelled or declined one stays listed. */
export function askedWithdrawalRows(withdrawals = []) {
  return withdrawals.map((w) => ({
    brandOrgId: null,
    currency: w.currency,
    id: `asked-${w.id}`,
    date: w.paid_at || w.created_at,
    title: ASKED_TITLE[w.provider] ?? "Bank transfer",
    meta: w.paid_to,
    // A failed one took no fee: its amount is back in the balance (record_withdrawal).
    note: w.status === "declined" ? w.reason
      : w.status === "failed" ? failedWithdrawalNote(w.back_cents, w.amount_cents, w.currency)
      : w.fee_cents != null && w.receives_minor != null ? `Fee ${(Number(w.fee_cents) / 100).toLocaleString("en-US", { style: "currency", currency: w.currency })}, taken from it`
      : null,
    status: ASKED_STATUS[w.status] ?? w.status,
    failed: ENDED_UNSENT.includes(w.status),
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
  // "Paid out to your bank" only on its withdrawal row, once Stripe's payout lands.
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
const STRIPE_PAYOUT_WORD = { paid: "Paid out to your bank", failed: "Failed", canceled: "Cancelled" };

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
export function serverWithdrawalRows(list = [], { pool = new Map(), stripe = new Map(), methodName = () => null } = {}) {
  const money = (cents) => (Number(cents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (list ?? []).flatMap((w) => {
    const fee = Math.max(0, Number(w.fee_cents) || 0);
    const base = { brandOrgId: null, currency: "USD", date: w.created_at, type: "withdrawal" };
    if (w.road === "pool") {
      const own = pool.get(w.id);
      const paid = w.word === "paid";
      return [{
        ...base,
        id: `asked-${w.id}`,
        title: ASKED_TITLE[w.provider] ?? "Bank transfer",
        meta: w.to ?? own?.paid_to ?? null,
        note: own?.status === "declined" ? own.reason
          : own?.status === "failed" ? failedWithdrawalNote(w.back_cents ?? own.back_cents, w.amount_cents)
          : paid && w.fee_cents != null ? `Fee ${money(fee)}, taken from it`
          : null,
        status: w.word === "waiting" ? "Processing" : w.word === "on_hold" ? ON_HOLD : w.word === "on_its_way" ? "Processing"
          : paid ? "Completed" : ASKED_STATUS[own?.status] ?? "Failed",
        failed: w.word === "returned",
        // What it still holds: less the part that went back to the brand since (its "refunded" part).
        amount: -(Number(w.amount_cents) - (w.parts ?? []).filter((part) => part.word === "refunded").reduce((sum, part) => sum + (Number(part.amount_cents) || 0), 0) - (paid ? fee : 0)),
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
      meta: w.to ? [toDestination(w.to), own?.destination_bank].filter(Boolean).join(" · ") : own ? methodName(own) : null,
      arrives: w.word === "returned" ? null : arrives,
      note: w.word === "on_its_way" ? BANK_PROCESSING : w.word === "paid" && fee ? `Fee ${money(fee)}, taken from it` : null,
      status: w.word === "on_its_way" ? ON_ITS_WAY : w.word === "paid" ? STRIPE_PAYOUT_WORD.paid : STRIPE_PAYOUT_WORD[String(own?.payout_status ?? "").toLowerCase()] ?? "Failed",
      failed: w.word === "returned",
      amount: -Number(w.amount_cents),
      available: w.word !== "returned",
    }];
  });
}
