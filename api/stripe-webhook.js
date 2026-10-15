import { applyPaymentIntent, rawBody, releaseOwedTo, reply, saveConnectAccount, serviceClient, stripeFrom } from "./_stripe.js";

/**
 * Stripe tells us what happened to a payment, or to a factory's account.
 *
 * Two endpoints point here in Stripe's dashboard, each with its own signing
 * secret: one for TSC's own account (payment_intent.processing / succeeded /
 * payment_failed) and one for connected accounts (account.updated). Locally,
 * `stripe listen` forwards both with one secret.
 *
 * Signature: anyone can POST to this URL, so nothing is read before the
 * signature over the raw body checks out against one of the secrets.
 * Idempotency: Stripe delivers at least once. Each event id is written to
 * stripe_events first; a second delivery finds it there and does nothing.
 * If handling fails, the id is removed again so Stripe's retry runs it. And
 * every database step refuses to move a payment backwards anyway.
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

  const { data: fresh, error: claimError } = await db
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (claimError) return reply(response, 500, { error: claimError.message });
  if (!fresh?.length) return reply(response, 200, { received: true, duplicate: true });

  try {
    switch (event.type) {
      case "payment_intent.processing":
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
        await applyPaymentIntent({ stripe, db, intent: event.data.object });
        break;
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
    return reply(response, 200, { received: true });
  } catch (failure) {
    await db.from("stripe_events").delete().eq("id", event.id);
    return reply(response, 500, { error: failure.message });
  }
}
