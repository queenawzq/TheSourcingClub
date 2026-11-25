import { logStripeFailure, payoutSentenceForStaff } from "./_stripe-errors.js";
import { pausedPayoutRefusal } from "./_paused.js";
import { callerClient, jsonBody, reply, serviceClient, settleRelease, stripeFrom, tokenRefused } from "./_stripe.js";

/**
 * Settle a payout an earlier version started when a step was approved. Called
 * by staff's "Retry payout" (and, while it is still live, by the old brand
 * page right after approving).
 *
 * Approving no longer sends anything: the money waits in the factory's
 * balance until the factory withdraws. So this never creates a transfer. It
 * only finds out what a release already started did: a transfer that went is
 * recorded, and one that did not is unpinned (settleRelease). Anyone who can
 * read the payment may ask.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

  // A paused factory: said first, before whether Stripe is set up here (20261125100000).
  {
    const early = serviceClient();
    const caller0 = callerClient(request);
    const { paymentId: askedPayment } = jsonBody(request);
    if (early && caller0 && askedPayment) {
      const staff0 = await caller0.rpc("is_platform_admin");
      if (!staff0.error && staff0.data === true) {
        const paused = await pausedPayoutRefusal(early, { paymentId: askedPayment });
        if (paused) return reply(response, 409, { released: false, reason: paused, kind: "payment_under_review" });
      }
    }
  }

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
    return reply(response, 200, await settleRelease({ stripe, db, paymentId }));
  } catch (failure) {
    logStripeFailure("stripe-release", failure, { paymentId });
    // Staff get what to do next. Anyone else who can read the payment asked for
    // a payout they can do nothing more about, and it stays owed.
    const { data: staff } = await caller.rpc("is_platform_admin");
    return reply(response, 502, {
      released: false,
      reason: staff ? payoutSentenceForStaff(failure) : "The payout could not be sent yet. It stays owed, and TSC retries it.",
    });
  }
}
