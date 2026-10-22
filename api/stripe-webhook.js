import { applyChargeRefund, applyPaymentIntent, rawBody, releaseOwedTo, reply, saveConnectAccount, serviceClient, stripeFrom } from "./_stripe.js";
import { applyCreditPurchaseIntent } from "./stripe-credits.js";

/**
 * Stripe tells us what happened to a payment, or to a factory's account.
 *
 * Two endpoints point here in Stripe's dashboard, each with its own signing
 * secret: one for TSC's own account (payment_intent.processing / succeeded /
 * payment_failed, charge.refunded) and one for connected accounts
 * (account.updated). Locally,
 * `stripe listen` forwards both with one secret.
 *
 * A PaymentIntent is either an order payment (metadata payment_id) or a
 * factory buying credits (metadata kind "credit_purchase", purchase_id); the
 * second is recorded by applyCreditPurchaseIntent and never reaches the
 * order-payment code.
 *
 * Signature: anyone can POST to this URL, so nothing is read before the
 * signature over the raw body checks out against one of the secrets.
 * Idempotency: Stripe delivers at least once. Each event is claimed in
 * stripe_events first (claim_stripe_event) and marked processed once
 * handled; a second delivery of a processed event, or of one claimed in the
 * last 5 minutes, does nothing. If handling fails, the row is removed again
 * so Stripe's retry runs it; if the function timed out before it could, the
 * claim lapses after 5 minutes and the retry runs it then. And every
 * database step refuses to move a payment backwards anyway.
 *
 * An event about a payment this database does not have (a PaymentIntent
 * from another site on the same Stripe account, or a payment deleted since)
 * is logged and answered 200: it will never succeed, and an endpoint that
 * keeps failing is disabled by Stripe, taking every real payment with it.
 */

// The database's "no such row" (P0002) and "not an id" (22P02, a payment_id
// in metadata that is not a uuid): retrying cannot fix either.
const ORPHANED = new Set(["P0002", "22P02"]);
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

  let stripe;
  try {
    stripe = stripeFrom();
  } catch (failure) {
    return reply(response, 503, { error: failure.message });
  }
  const db = serviceClient();
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
  if (!stripe || !db || !secrets.length) return reply(response, 503, { error: "payments are not set up on this site yet" });

  const body = await rawBody(request);
  const signature = request.headers["stripe-signature"];
  let event = null;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      // try the next secret
    }
  }
  if (!event) return reply(response, 400, { error: "bad signature" });

  const { data: claimed, error: claimError } = await db.rpc("claim_stripe_event", {
    event_id: event.id, event_type: event.type,
  });
  if (claimError) return reply(response, 500, { error: claimError.message });
  if (!claimed) return reply(response, 200, { received: true, duplicate: true });

  try {
    switch (event.type) {
      case "payment_intent.processing":
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        if (intent.metadata?.kind === "credit_purchase") {
          try {
            const purchase = await applyCreditPurchaseIntent({ stripe, db, intent });
            if (!purchase) console.error("stripe-webhook: no credit purchase for this PaymentIntent", event.id, intent.id);
          } catch (failure) {
            // A purchase that is gone, or an intent that is not its own
            // (22023): retrying cannot fix either.
            if (!ORPHANED.has(failure.code) && failure.code !== "22023") throw failure;
            console.error("stripe-webhook: credit purchase not recorded", event.id, intent.id, failure.code, failure.message);
          }
          break;
        }
        try {
          const payment = await applyPaymentIntent({ stripe, db, intent });
          if (!payment) console.error("stripe-webhook: no payment for this PaymentIntent", event.id, intent.id);
        } catch (failure) {
          if (!ORPHANED.has(failure.code)) throw failure;
          console.error("stripe-webhook: no payment for this PaymentIntent", event.id, intent.id, failure.code);
        }
        break;
      }
      case "charge.refunded": {
        // A refund made in Stripe (staff by hand, a dispute, or our own of a
        // stray intent). Another app's charge matches no payment and is left.
        const payment = await applyChargeRefund({ stripe, db, charge: event.data.object });
        if (!payment) console.error("stripe-webhook: no payment for this refunded charge", event.id, event.data.object.id);
        break;
      }
      case "account.updated": {
        const account = event.data.object;
        const { data: known } = await db
          .from("stripe_connect_accounts")
          .select("org_id")
          .eq("stripe_account_id", account.id)
          .maybeSingle();
        const orgId = known?.org_id ?? account.metadata?.org_id;
        if (orgId) {
          const saved = await saveConnectAccount(db, orgId, account);
          if (saved.transfers_active) await releaseOwedTo({ stripe, db, factoryOrgId: orgId });
        }
        break;
      }
      default:
        break;
    }
    // Done: a later delivery of this event is a repeat. If this write fails
    // the event is simply handled again after 5 minutes, which changes
    // nothing.
    await db.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", event.id);
    return reply(response, 200, { received: true });
  } catch (failure) {
    await db.from("stripe_events").delete().eq("id", event.id);
    return reply(response, 500, { error: failure.message });
  }
}
