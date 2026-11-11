import { callerClient, jsonBody, refundCancelledOrders, reply, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";
import { logStripeFailure } from "./_stripe-errors.js";

/**
 * Refund a cancelled order's held money to the brand, now. The page that
 * accepted the cancellation calls this; the daily job does the same for every
 * order, so a closed tab or a Stripe outage only delays it.
 *
 * Anyone who can read the order may ask (its two companies and staff): what is
 * refunded is decided by the database (cancellation_refunds_due), never by the
 * caller.
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

  const { orderId } = jsonBody(request);
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
