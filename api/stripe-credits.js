import { callerClient, failureReason, jsonBody, methodLabel, reply, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";

/**
 * A factory buys a pack of credits by card (migration 20261023000100).
 *
 *   { action: "start", orgId, credits }
 *       An owner of the factory picks a pack. The database prices it
 *       (credit_packs(), never the figure the page sent), makes the purchase
 *       row, and this makes a card PaymentIntent on TSC's own account for it.
 *       Returns the client secret and the company's saved cards, so a card
 *       saved under Billing is offered.
 *   { action: "sync", purchaseId }
 *       Reads the purchase's PaymentIntent back from Stripe and records what
 *       it says, for the page that just paid and for a preview the webhook
 *       cannot reach. The webhook does the same as it happens.
 *
 * The credits are written only by applyCreditPurchaseIntent, from what Stripe
 * says: the browser never decides a purchase went through.
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
  if (body.action === "start") return start({ stripe, db, caller, body, response });
  if (body.action === "sync") return sync({ stripe, db, caller, body, response });
  return reply(response, 400, { error: "unknown action" });
}

async function start({ stripe, db, caller, body, response }) {
  const { orgId, credits } = body;
  const [owner, orgRead, auth] = await Promise.all([
    caller.rpc("is_org_owner", { target_org: orgId }),
    caller.from("orgs").select("id, name").eq("id", orgId).maybeSingle(),
    caller.auth.getUser(),
  ]);
  if (tokenRefused(owner) || tokenRefused(orgRead) || !auth.data?.user) return reply(response, 401, { error: "sign in is required" });
  const org = orgRead.data;
  if (!owner.data || !org) return reply(response, 403, { error: "only an owner of the company can buy credits" });

  // The owner test again, in the database, against the caller's own id:
  // create_credit_purchase is the guard, the check above only a quick answer.
  const { data: purchase, error } = await db.rpc("create_credit_purchase", {
    target_org: orgId, pack_credits: Number(credits), buyer: auth.data.user.id,
  });
  if (error) return reply(response, error.code === "42501" ? 403 : 409, { error: error.message });

  try {
    const customer = await customerFor({ stripe, db, org, email: auth.data.user.email });
    const savedMethods = await stripe.paymentMethods.list({ customer, type: "card", limit: 20 });
    const savedCards = savedMethods.data.map((method) => ({
      id: method.id,
      brand: (method.card?.display_brand ?? method.card?.brand ?? "Card")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      last4: method.card?.last4 ?? "",
      expMonth: method.card?.exp_month ?? null,
      expYear: method.card?.exp_year ?? null,
    }));

    const intent = await stripe.paymentIntents.create(
      {
        amount: Number(purchase.amount_cents),
        currency: purchase.currency.toLowerCase(),
        customer,
        payment_method_types: ["card"],
        // A new card is kept for the next pack, as the Fund step keeps one.
        setup_future_usage: "on_session",
        description: `TSC credits: ${purchase.credits.toLocaleString("en-US")} credits`,
        metadata: { kind: "credit_purchase", purchase_id: purchase.id, org_id: orgId },
      },
      // Keyed on the purchase, which is new on every Continue: Stripe's own
      // retries inside this call reuse it, and a refusal is never replayed to
      // a later attempt, because a later attempt is a new purchase.
      { idempotencyKey: `credit-purchase-${purchase.id}` },
    );
    const { error: attachError } = await db.rpc("attach_credit_purchase_intent", {
      target_purchase: purchase.id, payment_intent: intent.id,
    });
    if (attachError) {
      await stripe.paymentIntents.cancel(intent.id).catch(() => null);
      throw new Error(attachError.message);
    }

    return reply(response, 200, {
      purchaseId: purchase.id,
      clientSecret: intent.client_secret,
      credits: purchase.credits,
      amountCents: Number(purchase.amount_cents),
      currency: purchase.currency,
      savedCards,
    });
  } catch (failure) {
    return reply(response, 502, { error: failure.message });
  }
}

async function sync({ stripe, db, caller, body, response }) {
  const { purchaseId } = body;
  // Anyone in the company may ask (RLS decides); what is recorded is only
  // ever what Stripe says.
  const read = await caller.from("credit_purchases").select("id, stripe_payment_intent_id").eq("id", purchaseId).maybeSingle();
  if (tokenRefused(read)) return reply(response, 401, { error: "sign in is required" });
  if (!read.data) return reply(response, 404, { error: "that purchase is not available to you" });

  try {
    if (read.data.stripe_payment_intent_id) {
      const intent = await stripe.paymentIntents.retrieve(read.data.stripe_payment_intent_id, { expand: ["payment_method"] });
      await applyCreditPurchaseIntent({ stripe, db, intent });
    }
    const { data: purchase } = await db
      .from("credit_purchases")
      .select("id, state, credits, amount_cents, currency, failure_reason, payment_method_label")
      .eq("id", purchaseId)
      .single();
    return reply(response, 200, purchase);
  } catch (failure) {
    return reply(response, 502, { error: failure.message });
  }
}

/**
 * Record what a credit purchase's PaymentIntent says. Shared by the webhook
 * and the sync above, so both reach the same answer; each database step is a
 * no-op once the purchase has succeeded, so running it twice, or late,
 * grants nothing more. Returns the purchase row, or null when the intent is
 * not a credit purchase.
 */
export async function applyCreditPurchaseIntent({ stripe, db, intent }) {
  const purchaseId = intent.metadata?.purchase_id;
  if (intent.metadata?.kind !== "credit_purchase" || !purchaseId) return null;

  const full = typeof intent.payment_method === "object" && intent.payment_method
    ? intent
    : await stripe.paymentIntents.retrieve(intent.id, { expand: ["payment_method"] });
  const method = typeof full.payment_method === "object" ? full.payment_method : null;

  if (full.status === "succeeded") {
    return rpc(db, "record_credit_purchase_succeeded", {
      target_purchase: purchaseId,
      payment_intent: full.id,
      received: full.amount_received ?? full.amount,
      method_label: methodLabel(method),
    });
  }
  if ((full.status === "requires_payment_method" && full.last_payment_error) || full.status === "canceled") {
    const reason = full.status === "canceled" ? "The payment was cancelled." : failureReason(full);
    return rpc(db, "record_credit_purchase_failed", { target_purchase: purchaseId, payment_intent: full.id, reason });
  }
  const { data } = await db.from("credit_purchases").select("*").eq("id", purchaseId).maybeSingle();
  return data;
}

/**
 * A refund of a credit purchase, made in Stripe: take back the refunded share
 * of its credits. `amount_refunded` is the charge's running total, and the
 * database writes only what is not yet taken back, so a repeat is a no-op.
 * Returns the purchase, or null when the charge is not a credit purchase.
 */
export async function applyCreditPurchaseRefund({ db, charge }) {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  if (!intentId || !(Number(charge.amount_refunded) > 0)) return null;
  const { data: purchase } = await db.from("credit_purchases").select("id").eq("stripe_payment_intent_id", intentId).maybeSingle();
  if (!purchase) return null;
  return rpc(db, "record_credit_purchase_refunded", {
    payment_intent: intentId,
    refunded_cents: Number(charge.amount_refunded),
  });
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    // The code travels with the message: the webhook tells a purchase that
    // does not exist (P0002) from a failure worth retrying.
    const failure = new Error(`${name}: ${error.message}`);
    failure.code = error.code;
    throw failure;
  }
  return data;
}

/**
 * The company's Stripe customer, made once: the same one Billing saves cards
 * to (api/stripe-billing-setup.js), so a card saved there is offered here.
 */
async function customerFor({ stripe, db, org, email }) {
  const { data: existing } = await db.from("stripe_customers").select("stripe_customer_id").eq("org_id", org.id).maybeSingle();
  if (existing) return existing.stripe_customer_id;

  // Saved with "first one wins"; a spare customer from a race is unused.
  const customer = await stripe.customers.create({ name: org.name ?? undefined, email: email ?? undefined, metadata: { org_id: org.id } });
  await db.from("stripe_customers").upsert({ org_id: org.id, stripe_customer_id: customer.id }, { onConflict: "org_id", ignoreDuplicates: true });
  const { data: saved } = await db.from("stripe_customers").select("stripe_customer_id").eq("org_id", org.id).single();
  return saved.stripe_customer_id;
}
