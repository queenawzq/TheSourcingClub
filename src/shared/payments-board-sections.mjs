/**
 * Which queue of the staff payments board a payment row is in, one rule for
 * the board (src/app/admin/AdminPayments.jsx) and for the overview's
 * "Payments owed" link (src/lib/domain/admin.js paymentsQueueHref), so the two
 * never disagree. Pure: rows from admin_payment_board(), attempts from
 * admin_provider_attempts() by payment id, pool from
 * admin_withdrawals().pool_payment_ids.
 */

/** Includes a payout Stripe was asked for and may have made: only Retry finds out, so no other rail is offered. */
export const paidByStripe = (row) => (row.factory_stripe_ready || row.stripe_release_started) && row.stripe_payment_intent_id;
export const paidByPaypal = (row) => !paidByStripe(row) && row.payout_method === "paypal";
export const paidByBank = (row) => !paidByStripe(row) && !paidByPaypal(row);
export const paidByWise = (row) => paidByBank(row) && Boolean(row.wise_recipient_type);
/**
 * Which provider the server pays this row through, if any. A payout already
 * under way stays with the provider paying it, whatever the factory's method
 * is now, so staff can still check it.
 */
export const providerUnderway = (row) => (row.provider_status === "processing" && ["wise", "paypal"].includes(row.provider) ? row.provider : null);
export const providerFor = (row) => providerUnderway(row) ?? (paidByWise(row) ? "wise" : paidByPaypal(row) ? "paypal" : null);
/** A payout Wise or PayPal is paying now: it waits under Processing, not Payout owed. */
export const underway = (row, attempt) => Boolean(providerFor(row)) && attempt?.status === "processing";
/**
 * Wise or PayPal's last attempt failed (returned, refused) and the factory has
 * not changed its details since: listed under Failed, with Pay again.
 */
export const providerFailed = (row, attempt) => Boolean(providerFor(row)) && attempt?.status === "failed"
  && !(row.payout_changed_at && attempt.updated_at && new Date(row.payout_changed_at) > new Date(attempt.updated_at));

/**
 * Splits the board's rows into its sections. A payout Wise or PayPal is
 * paying now (its attempt `processing`) is under Processing, not Payout owed.
 * The board no longer shows bank-wire claims (`sent`) or payments refunded
 * after payout (`released`): John, Nov 7.
 */
export function boardSections(rows, attempts = new Map(), pool = new Set()) {
  const cancelled = (row) => row.order_status === "cancelled";
  const owed = rows.filter((row) => row.state === "confirmed" && row.release_requested_at);
  // Approved money waits in the factory's balance and is paid when the
  // factory withdraws (the Withdrawals tab). Still staff's, whatever the
  // factory's method or details are now (the overview counts the same rows):
  // a Stripe release an earlier version started (Retry checks Stripe), and a
  // Wise or PayPal payout per step whose latest attempt is under way or failed.
  const staffs = (row) => Boolean(row.stripe_release_started)
    || ["processing", "failed"].includes(attempts.get(row.payment_id)?.status ?? row.provider_status);
  const inBalance = (row) => pool.has(row.payment_id) || !staffs(row);
  const moving = (row) => underway(row, attempts.get(row.payment_id));
  const refused = (row) => providerFailed(row, attempts.get(row.payment_id));
  return {
    payout: owed.filter((row) => !moving(row) && !refused(row) && !inBalance(row)),
    // A cancelled order's held money is refunded automatically; only a refund
    // Stripe refused (20261108300000) needs a person.
    failed: rows.filter((row) => (row.state === "failed" && !cancelled(row))
      || (["confirmed", "processing"].includes(row.state) && cancelled(row) && row.refund_failed_at))
      .concat(owed.filter(refused)),
    clearing: [...rows.filter((row) => row.state === "processing" && !cancelled(row)), ...owed.filter(moving)],
    held: rows.filter((row) => row.state === "confirmed" && !row.release_requested_at && !cancelled(row)),
  };
}

/**
 * Whether the overview's "Payments owed" counts a row (admin_overview_metrics'
 * own rule): an owed step not in a factory's balance whose Stripe release an
 * earlier version started, or whose latest Wise / PayPal attempt is under way
 * or failed; or a refund Stripe refused on a cancelled order.
 */
export function countedByOverview(row, attempts = new Map(), pool = new Set()) {
  if (["confirmed", "processing"].includes(row.state) && row.order_status === "cancelled" && row.refund_failed_at) return true;
  if (row.state !== "confirmed" || !row.release_requested_at || pool.has(row.payment_id)) return false;
  const latest = attempts.get(row.payment_id)?.status ?? row.provider_status;
  return Boolean(row.stripe_release_started) || ["processing", "failed"].includes(latest);
}

/**
 * The first board queue, in the board's tab order, holding a row the
 * overview counts: "payout" | "failed" | "clearing", or null when none does.
 */
export function countedQueue(rows, attempts = new Map(), pool = new Set()) {
  const sections = boardSections(rows, attempts, pool);
  for (const id of ["payout", "failed", "clearing"]) {
    if (sections[id].some((row) => countedByOverview(row, attempts, pool))) return id;
  }
  return null;
}
