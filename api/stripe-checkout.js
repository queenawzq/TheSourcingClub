import { applyPaymentIntent, callerClient, jsonBody, reply, serviceClient, stripeFrom } from "./_stripe.js";

/**
 * The brand starts paying for a step: returns the client secret the Stripe
 * Payment Element needs. Card and US bank account, in one form.
 *
 * Who may pay, and for what, is decided by the database as the CALLER
 * (begin_payment_checkout: a brand owner, an active order, a payment that is
 * due or failed). One PaymentIntent per payment: a payment that failed is
 * paid again on the same intent with a new method, and a due step whose
 * amount the brand changed has its intent's amount brought into line.
 */
const OPEN = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

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
  const { data: checkout, error } = await caller.rpc("begin_payment_checkout", { target_payment: paymentId });
  if (error) {
    return reply(response, error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409, { error: error.message });
  }

  try {
    const customer = await customerFor({ stripe, db, orgId: checkout.brand_org_id });
    const details = {
      title: checkout.milestone_title,
      orderNumber: checkout.order_number,
      amountCents: checkout.amount_cents,
      feeCents: checkout.fee_cents,
      feeBps: checkout.fee_bps,
      chargedCents: checkout.charged_cents,
      currency: checkout.currency,
    };

    let intent = checkout.stripe_payment_intent_id
      ? await stripe.paymentIntents.retrieve(checkout.stripe_payment_intent_id)
      : null;

    if (intent && !OPEN.has(intent.status)) {
      // Already paid, or on its way: bring the database up to date instead.
      const payment = await applyPaymentIntent({ stripe, db, intent });
      return reply(response, 409, { error: "this payment is already under way", state: payment?.state ?? null });
    }

    if (intent && intent.amount !== Number(checkout.charged_cents)) {
      intent = await stripe.paymentIntents.update(intent.id, { amount: Number(checkout.charged_cents) });
    }

    if (!intent) {
      intent = await stripe.paymentIntents.create(
        {
          amount: Number(checkout.charged_cents),
          currency: checkout.currency.toLowerCase(),
          customer,
          payment_method_types: ["card", "us_bank_account"],
          payment_method_options: {
            us_bank_account: {
              verification_method: "automatic",
              financial_connections: { permissions: ["payment_method"] },
            },
          },
          // Separate charges and transfers: the money stays in TSC's balance
          // until the step is approved, then goes to the factory.
          transfer_group: checkout.order_id,
          description: `${checkout.order_number}: ${checkout.milestone_title}`,
          statement_descriptor_suffix: checkout.order_number.replace(/[^A-Za-z0-9 ]/g, "").slice(0, 22) || undefined,
          metadata: { payment_id: checkout.payment_id, order_id: checkout.order_id, brand_org_id: checkout.brand_org_id },
        },
        // No idempotency key: Stripe would replay a failed first attempt for
        // 24 hours. attach_payment_intent keeps one intent per payment; a
        // second intent from a double click is refused there and never paid.
      );
      const { error: attachError } = await db.rpc("attach_payment_intent", {
        target_payment: checkout.payment_id, payment_intent: intent.id, charged: Number(checkout.charged_cents),
      });
      if (attachError) throw new Error(attachError.message);
    } else if (!checkout.stripe_payment_intent_id || intent.amount !== Number(checkout.charged_cents)) {
      await db.rpc("attach_payment_intent", {
        target_payment: checkout.payment_id, payment_intent: intent.id, charged: Number(checkout.charged_cents),
      });
    }

    return reply(response, 200, { clientSecret: intent.client_secret, ...details });
  } catch (failure) {
    return reply(response, 502, { error: failure.message });
  }
}

/** The brand company's Stripe customer, made once. */
async function customerFor({ stripe, db, orgId }) {
  const { data: existing } = await db.from("stripe_customers").select("stripe_customer_id").eq("org_id", orgId).maybeSingle();
  if (existing) return existing.stripe_customer_id;

  const { data: org } = await db.from("orgs").select("name").eq("id", orgId).single();
  // Saved below with "first one wins"; a spare customer from a race is unused.
  const customer = await stripe.customers.create({ name: org?.name ?? undefined, metadata: { org_id: orgId } });
  await db.from("stripe_customers").upsert({ org_id: orgId, stripe_customer_id: customer.id }, { onConflict: "org_id", ignoreDuplicates: true });
  const { data: saved } = await db.from("stripe_customers").select("stripe_customer_id").eq("org_id", orgId).single();
  return saved.stripe_customer_id;
}
