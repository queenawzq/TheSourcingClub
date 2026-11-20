import { applyPaymentIntent, callerClient, ensureFundsAvailable, jsonBody, reply, serviceClient, settleRelease, stripeFrom, tokenRefused } from "./_stripe.js";
import { logStripeFailure, sentenceFor } from "./_stripe-errors.js";

/**
 * Read a payment's PaymentIntent back from Stripe and record what it says.
 * The webhook does the same thing as it happens; this is for the page that
 * just confirmed a payment and wants the answer now, and for a test site the
 * webhook cannot reach (a preview behind Vercel's login).
 *
 * Anyone who can read the payment may ask (the order's two companies and
 * staff); what gets recorded is only ever what Stripe says.
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
  const read = await caller.from("order_payments").select("id, stripe_payment_intent_id").eq("id", paymentId).maybeSingle();
  if (tokenRefused(read)) return reply(response, 401, { error: "sign in is required" });
  const { data: visible } = read;
  if (!visible) return reply(response, 404, { error: "that payment is not available to you" });

  try {
    if (visible.stripe_payment_intent_id) {
      const intent = await stripe.paymentIntents.retrieve(visible.stripe_payment_intent_id, {
        expand: ["payment_method", "latest_charge"],
      });
      await applyPaymentIntent({ stripe, db, intent });
    }
    // A release an earlier version started on approval is settled; nothing
    // new is sent; approved money waits in the factory's balance.
    await settleRelease({ stripe, db, paymentId }).catch(() => null);
    // When the brand's money clears, if recording it failed before.
    await ensureFundsAvailable({ stripe, db, paymentId })
      .catch((failure) => logStripeFailure("stripe-sync funds-available", failure, { paymentId }));

    const { data: payment } = await db
      .from("order_payments")
      .select("id, state, charged_cents, payment_method_type, payment_method_label, failure_reason, release_requested_at, released_at")
      .eq("id", paymentId)
      .single();
    return reply(response, 200, payment);
  } catch (failure) {
    logStripeFailure("stripe-sync", failure);
    return reply(response, 502, { error: sentenceFor(failure, "This payment could not be checked just now. Reload the page in a few minutes.") });
  }
}
