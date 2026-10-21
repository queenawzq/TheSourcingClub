import { callerClient, jsonBody, releasePayment, reply, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";

/**
 * Pay a held payment out to its factory now. Called by the brand's page right
 * after it approves a step, and by staff's "Retry payout".
 *
 * Whether the money is owed is the database's call (the approval set
 * release_requested_at); this only carries it out, once: releasePayment
 * claims the payment first, and a second caller is told it is already being
 * paid. Anyone who can read the payment may ask.
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

  const { paymentId } = jsonBody(request);
  const read = await caller.from("order_payments").select("id").eq("id", paymentId).maybeSingle();
  if (tokenRefused(read)) return reply(response, 401, { error: "sign in is required" });
  const { data: visible } = read;
  if (!visible) return reply(response, 404, { error: "that payment is not available to you" });

  try {
    return reply(response, 200, await releasePayment({ stripe, db, paymentId }));
  } catch (failure) {
    return reply(response, 502, { released: false, reason: failure.message });
  }
}
