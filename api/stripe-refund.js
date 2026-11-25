import { callerClient, jsonBody, makeStaffRefund, refundCancelledOrders, reply, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";
import { logStripeFailure } from "./_stripe-errors.js";

/**
 * Two modes.
 *
 * { orderId }: refund a cancelled order's held money to the brand, now. The
 * page that accepted the cancellation calls this; the daily job does the same
 * for every order, so a closed tab or a Stripe outage only delays it. Anyone
 * who can read the order may ask (its two companies and staff): what is
 * refunded is decided by the database (cancellation_refunds_due).
 *
 * { paymentId, amountCents, payer, note } or { staffRefundId }: staff refund
 * a brand from the admin board (20261125100000). The claim runs with the
 * staff member's own token (claim_staff_refund: staff only, never staff in
 * either company, the factory's part taken from its balance in the same
 * transaction); the server then makes it in Stripe once (makeStaffRefund).
 */
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

  let stripe;
  try {
    stripe = stripeFrom();
  } catch (failure) {
    return reply(response, 503, { error: failure.message });
  }
  const db = serviceClient();
  if (!stripe || !db) return reply(response, 503, { error: "payments are not set up on this site yet" });

  const caller = callerClient(request);
  if (!caller) return reply(response, 401, { error: "sign in is required" });

  const body = jsonBody(request);
  if (body.paymentId || body.staffRefundId) return staffRefund({ stripe, db, caller, body, response });

  const { orderId } = body;
  if (typeof orderId !== "string" || !orderId) return reply(response, 400, { error: "which order?" });
  const read = await caller.from("production_orders").select("id, status").eq("id", orderId).maybeSingle();
  if (tokenRefused(read)) return reply(response, 401, { error: "sign in is required" });
  if (!read.data) return reply(response, 404, { error: "that order is not available to you" });
  if (read.data.status !== "cancelled") return reply(response, 409, { error: "this order is not cancelled" });

  try {
    const counts = await refundCancelledOrders({ stripe, db, orderId });
    return reply(response, 200, counts);
  } catch (failure) {
    logStripeFailure("stripe-refund", failure, { orderId });
    return reply(response, 502, { error: "The refund could not be started just now. It is tried again automatically." });
  }
}

/** The claim's refusals, by the database's hint, in the words staff read. */
const REFUSALS = {
  staff_refund_amount: () => "Enter an amount above $0.00.",
  staff_refund_over: (detail) => (detail ? `You can refund up to ${detail}.` : "That is more than can be refunded."),
  staff_refund_not_charged: () => "This payment hasn't been charged.",
  staff_refund_processing: () => "This payment is still processing. Try again once it's funded.",
  staff_refund_disputed: () => "The bank is deciding this payment.",
  staff_refund_cancelled_order: () => "This order was cancelled. Its payments are refunded automatically.",
  staff_refund_payer: () => "Choose who pays for this refund.",
  staff_refund_payer_not_approved: () => "This step isn't approved, so the factory's balance isn't involved.",
  staff_refund_note: () => "Add a reason for the brand.",
  staff_refund_claimed: () => "This payment is being refunded. Reload in a minute.",
  staff_refund_balance_changed: () => "The factory's balance changed. Reload and try again.",
  review_own_company: () => "You belong to this brand, so someone else on the staff must refund it.",
  payout_own_company: () => "You belong to this factory, so someone else on the staff must refund it.",
  reveal_brand_side: () => "Your company has an order with this factory, so someone else on the staff must refund it.",
};
export const staffRefundRefusal = (hint, detail) => REFUSALS[hint]?.(detail) ?? null;
const NOT_ALLOWED = "That couldn't be done. Reload the page and try again.";

async function staffRefund({ stripe, db, caller, body, response }) {
  const { paymentId, amountCents, payer, note, staffRefundId } = body;
  let read;
  if (staffRefundId) {
    if (typeof staffRefundId !== "string") return reply(response, 400, { error: NOT_ALLOWED });
    read = await caller.rpc("staff_refund_retry", { target_refund: staffRefundId });
  } else {
    if (typeof paymentId !== "string" || !Number.isSafeInteger(amountCents)) {
      return reply(response, 409, { error: REFUSALS.staff_refund_amount(), hint: "staff_refund_amount" });
    }
    read = await caller.rpc("claim_staff_refund", {
      target_payment: paymentId, amount_cents: amountCents, payer: payer ?? null, note: typeof note === "string" ? note : null,
    });
  }
  if (tokenRefused(read)) return reply(response, 401, { error: "sign in is required" });
  if (read.error) {
    const hint = read.error.hint ?? null;
    const sentence = staffRefundRefusal(hint, read.error.details ?? null);
    if (sentence) return reply(response, read.error.code === "42501" ? 403 : 409, { error: sentence, hint });
    if (read.error.code === "42501" || read.error.code === "P0002") return reply(response, 403, { error: NOT_ALLOWED });
    logStripeFailure("staff-refund-claim", read.error, { paymentId, staffRefundId });
    return reply(response, 502, { error: NOT_ALLOWED });
  }
  const claim = read.data;
  let outcome;
  try {
    outcome = await makeStaffRefund({ stripe, db, claim, renew: Boolean(staffRefundId) });
  } catch (failure) {
    // Recording failed after Stripe answered: the claim stays, Check again finishes it.
    logStripeFailure("staff-refund-record", failure, { staffRefundId: claim.staff_refund_id });
    return reply(response, 503, {
      error: "Stripe can't be reached. Press Check again in a minute; nothing will be refunded twice.",
      hint: "stripe_unreachable", staffRefundId: claim.staff_refund_id,
    });
  }
  if (outcome.status) return reply(response, 200, outcome);
  if (outcome.refused) {
    return reply(response, 409, { error: staffRefundRefusal(outcome.refused, outcome.detail), hint: outcome.refused });
  }
  if (outcome.retry) {
    return reply(response, 503, {
      error: "Stripe can't be reached. Press Check again in a minute; nothing will be refunded twice.",
      hint: "stripe_unreachable", staffRefundId: claim.staff_refund_id,
    });
  }
  return reply(response, 502, { error: outcome.failed, hint: "stripe_refused" });
}
