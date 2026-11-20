import { applyChargeRefund, applyChargeUpdated, applyPaymentIntent, paymentForDispute, applyRefundUpdate, ensureFundsAvailable, rawBody, reply, saveConnectAccount, serviceClient, stripeFrom } from "./_stripe.js";
import { logStripeFailure } from "./_stripe-errors.js";
import { connectNeedsNotice } from "./_connect-needs.js";
import { tellExternalAccountEvent } from "./_stripe-payouts.js";
import { tellPayoutEvent } from "./_stripe-payout-events.js";
import { returnFeeOnFailedPayout } from "./_stripe-withdrawals.js";
import { emailTransport, sendDueNotificationEmails } from "./_notification-sender.js";
import { applyCreditPurchaseIntent, applyCreditPurchaseRefund } from "./stripe-credits.js";

/**
 * Stripe tells us what happened to a payment, or to a factory's account.
 *
 * Two endpoints point here in Stripe's dashboard, each with its own signing
 * secret: one for TSC's own account (payment_intent.processing / succeeded /
 * payment_failed, charge.refunded, refund.updated / refund.failed /
 * charge.refund.updated for a cancelled order's refund that failed) and one for connected accounts
 * (account.updated, account.external_account.*, payout.paid, payout.failed, payout.canceled). Locally,
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
/** A withdrawal may make several Stripe calls in a row (claim, transfers, fee, payout): room for all of them. */
export const config = { maxDuration: 60 };

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
  if (claimError) {
    logStripeFailure("stripe-webhook", claimError, { eventId: event.id });
    return reply(response, 500, { error: "this event could not be claimed; send it again" });
  }
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
          // When the brand's money clears decides Available or Pending.
          // applyPaymentIntent already waited a few seconds for Stripe's
          // balance transaction; if there is still no date (or recording it
          // failed), this delivery fails so Stripe sends it again. The
          // payment itself is recorded either way.
          else if (event.type === "payment_intent.succeeded") {
            const at = await ensureFundsAvailable({ stripe, db, paymentId: payment.id });
            if (!at && ["confirmed", "released"].includes(payment.state) && payment.stripe_charge_id) {
              throw new Error("the charge has no clearing date from Stripe yet");
            }
          }
        } catch (failure) {
          if (!ORPHANED.has(failure.code)) throw failure;
          console.error("stripe-webhook: no payment for this PaymentIntent", event.id, intent.id, failure.code);
        }
        break;
      }
      case "charge.updated": {
        // Stripe adds the balance transaction a few seconds after the charge:
        // its clearing date is recorded here if nothing recorded it yet.
        await applyChargeUpdated({ stripe, db, charge: event.data.object });
        break;
      }
      case "charge.refunded": {
        // A refund made in Stripe (staff by hand, a dispute, or our own of a
        // stray intent). Another app's charge matches no payment and is left.
        const payment = await applyChargeRefund({ stripe, db, charge: event.data.object });
        if (payment) break;
        // Not an order payment: a refunded credit pack takes its credits back.
        const purchase = await applyCreditPurchaseRefund({ db, charge: event.data.object });
        if (!purchase) console.error("stripe-webhook: no payment for this refunded charge", event.id, event.data.object.id);
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        // A disputed charge's step is never withdrawn while the dispute is
        // open; one the brand lost stays out (its money went back). Read back
        // from Stripe, never from the event: "closed" can arrive before
        // "created", and the dispute as it is now decides.
        const dispute = await stripe.disputes.retrieve(event.data.object.id);
        // Found by its charge, else its PaymentIntent; an order payment not
        // recorded yet throws, so Stripe sends the event again.
        const payment = await paymentForDispute({ stripe, db, dispute });
        if (payment) {
          const disputed = !["won", "warning_closed"].includes(dispute.status);
          const recorded = await db.rpc("record_payment_disputed", { target_payment: payment.id, disputed });
          if (recorded.error) throw new Error(recorded.error.message);
        }
        break;
      }
      case "refund.updated":
      case "refund.failed":
      case "charge.refund.updated": {
        // Our refund of a cancelled order's held money, failed after Stripe
        // accepted it: the money is held again and staff see why.
        await applyRefundUpdate({ db, refund: event.data.object });
        break;
      }
      case "account.external_account.created":
      case "account.external_account.updated":
      case "account.external_account.deleted": {
        if (await tellExternalAccountEvent(db, event) && emailTransport()) {
          await sendDueNotificationEmails(db, request).catch((failure) => console.error("stripe-webhook: email queue", failure?.message));
        }
        break;
      }
      case "payout.canceled": {
        // Cancelled before it reached the bank: the money is back in the
        // balance, and the fee with it. No bell: nothing failed at the bank.
        await returnFeeOnFailedPayout({ stripe, db, payout: event.data.object });
        break;
      }
      case "payout.paid":
      case "payout.failed": {
        // A failed payout puts the money back in the balance, and the fee with
        // it. First: it is safe to repeat, the bell below is not.
        if (event.type === "payout.failed") await returnFeeOnFailedPayout({ stripe, db, payout: event.data.object });
        if (await tellPayoutEvent(db, event) && emailTransport()) {
          await sendDueNotificationEmails(db, request).catch((failure) => console.error("stripe-webhook: email queue", failure?.message));
        }
        break;
      }
      case "account.updated": {
        const account = event.data.object;
        const { data: known, error: knownError } = await db
          .from("stripe_connect_accounts")
          .select("org_id, details_submitted, payouts_enabled, transfers_active, requirements_due")
          .eq("stripe_account_id", account.id)
          .maybeSingle();
        if (knownError) throw new Error(knownError.message);
        const orgId = known?.org_id ?? account.metadata?.org_id;
        if (orgId) {
          const saved = await saveConnectAccount(db, orgId, account);
          // Said after the save, and only for the account TSC pays (saved is
          // null for a retired or still-onboarding replacement). A repeat of
          // this event is refused by claim_stripe_event; a later event with
          // the same state finds nothing new against the saved row.
          const notice = saved ? connectNeedsNotice(known, account) : null;
          if (notice) {
            const { error: noticeError } = await db.from("notifications").insert({ org_id: orgId, ...notice });
            if (noticeError) throw new Error(noticeError.message);
            // Nobody signed in wrote anything, so nothing else sends the
            // queue until the daily job: send it now. A failure here is left
            // to that job, never a reason to handle the event again.
            if (emailTransport()) {
              await sendDueNotificationEmails(db, request).catch((failure) => console.error("stripe-webhook: email queue", failure?.message));
            }
          }
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
    logStripeFailure("stripe-webhook", failure, { eventId: event.id });
    return reply(response, 500, { error: "this event could not be handled; send it again" });
  }
}
