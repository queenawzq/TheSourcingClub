import { applyPaymentIntent, callerClient, jsonBody, reply, serviceClient, stripeFrom } from "./_stripe.js";

/**
 * The brand starts paying for a step: returns the client secret the Stripe
 * Payment Element needs. Project funding is card-only.
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
    const details = {
      title: checkout.milestone_title,
      orderNumber: checkout.order_number,
      amountCents: checkout.amount_cents,
      feeCents: checkout.fee_cents,
      feeBps: checkout.fee_bps,
      chargedCents: checkout.charged_cents,
      currency: checkout.currency,
      savedCards,
    };

    let intent = checkout.stripe_payment_intent_id
      ? await stripe.paymentIntents.retrieve(checkout.stripe_payment_intent_id)
      : null;

    if (intent && !OPEN.has(intent.status)) {
      // Already paid, or on its way: bring the database up to date instead.
      const payment = await applyPaymentIntent({ stripe, db, intent });
      return reply(response, 409, { error: "this payment is already under way", state: payment?.state ?? null });
    }

    // Whether the open intent's amount already matches what is owed, read
    // before any update so a changed amount is still recorded below.
    const charged = Number(checkout.charged_cents);
    const amountChanged = Boolean(intent) && intent.amount !== charged;

    // Older open intents may still advertise ACH, or carry an amount the
    // brand has since changed: bring them into line, but only when something
    // differs, so opening the page is not a write to Stripe every time. Never
    // mid-authentication (requires_action): an update there would throw away
    // the brand's 3-D Secure step, so the intent goes back as it is.
    if (intent && intent.status !== "requires_action" && (
      amountChanged
      || intent.payment_method_types?.length !== 1 || intent.payment_method_types[0] !== "card"
      || intent.setup_future_usage !== "on_session"
    )) {
      intent = await stripe.paymentIntents.update(intent.id, {
        amount: charged,
        payment_method_types: ["card"],
        setup_future_usage: "on_session",
      });
    }

    if (!intent) {
      intent = await stripe.paymentIntents.create(
        {
          amount: charged,
          currency: checkout.currency.toLowerCase(),
          customer,
          payment_method_types: ["card"],
          setup_future_usage: "on_session",
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
        target_payment: checkout.payment_id, payment_intent: intent.id, charged,
      });
      if (attachError?.code === "22023") {
        // Another request (a double click) attached its intent first: cancel
        // this spare one and hand back the attached intent instead.
        await stripe.paymentIntents.cancel(intent.id).catch(() => null);
        const { data: attached } = await db.from("order_payments")
          .select("stripe_payment_intent_id").eq("id", checkout.payment_id).single();
        intent = await stripe.paymentIntents.retrieve(attached.stripe_payment_intent_id);
      } else if (attachError) {
        throw new Error(attachError.message);
      }
    } else if (amountChanged && intent.amount === charged) {
      // The intent now asks for the new amount: record it as what is charged.
      await db.rpc("attach_payment_intent", {
        target_payment: checkout.payment_id, payment_intent: intent.id, charged,
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
