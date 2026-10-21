import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

/**
 * Payments held by TSC, through Stripe Connect: the parts every payment route
 * shares. The leading underscore keeps Vercel from serving this file.
 *
 * The money path (migration 20261012000200):
 *   a step opens            -> its payment is due; the brand funds it
 *   /api/stripe-checkout    -> a PaymentIntent on TSC's own account (separate
 *                              charges and transfers): card or US bank account
 *   Stripe says so          -> processing / failed / confirmed (TSC holds it),
 *                              by webhook or by /api/stripe-sync reading the
 *                              PaymentIntent back; both go through
 *                              applyPaymentIntent below. Money the payment no
 *                              longer wants (a changed amount, a cancelled
 *                              order) is refunded, and a refund made in
 *                              Stripe is recorded (applyChargeRefund)
 *   the brand approves      -> the database asks for the payout
 *                              (release_requested_at); releasePayment() sends
 *                              a Transfer to the factory's Express account
 *
 * Only this code, holding the service key, can move a payment through those
 * states; the database refuses everyone else. The browser never decides a
 * payment arrived.
 */

/**
 * Where a US platform can pay out through Connect: the US, Canada, the UK,
 * Switzerland and the EEA (Stripe, "Cross-border payouts", checked
 * 2026-10-11). A factory elsewhere (mainland China, Hong Kong, Vietnam…) is
 * paid by bank transfer by staff from the money TSC holds.
 *
 * Kept here, not imported from src/: Vercel builds api/ on its own and a
 * function that loads a file from outside it fails to start. The factory's
 * Payments page has the same list (src/shared/stripe-payout-countries.mjs);
 * the smoke test fails if the two differ.
 */
export const PAYOUT_COUNTRIES = new Set([
  "US", "CA", "GB", "CH",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);

/**
 * The Stripe client, or null when payments are not set up here. A live key is
 * refused anywhere but a production deploy, so a preview or a laptop can
 * never charge a real card.
 */
export function stripeFrom(env = process.env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key) && env.VERCEL_ENV !== "production") {
    throw new Error("a live Stripe key is only allowed on the production site");
  }
  return new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "The Sourcing Club" } });
}

/** The service-key client: server code only, never anything bundled. */
export function serviceClient(env = process.env) {
  const { supabaseUrl, serviceKey } = supabaseServerEnv(env);
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * A client that acts as the person who called, from their own session token,
 * so the database's own rules decide what they may do. Null when the request
 * carries no session.
 */
export function callerClient(request, env = process.env) {
  const { supabaseUrl, anonKey } = supabaseServerEnv(env);
  const authorization = request.headers.authorization;
  if (!supabaseUrl || !anonKey || !authorization?.startsWith("Bearer ")) return null;
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}

/**
 * True when the database refused the caller's token itself (malformed,
 * expired, empty): the answer is "sign in", not a refusal of what was asked.
 * Takes the { status } of any query made with callerClient.
 */
export const tokenRefused = (result) => result?.status === 401;

/** The parsed JSON body, whether the runtime parsed it already or not. */
export function jsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body || "{}");
  } catch {
    return {};
  }
}

/** The raw body, byte for byte: Stripe signs it, not the parsed JSON. */
export async function rawBody(request) {
  // The dev server (vite.config.js) has already read the stream and keeps it.
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  const chunks = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  if (chunks.length) return Buffer.concat(chunks);
  if (Buffer.isBuffer(request.body)) return request.body;
  return Buffer.from(typeof request.body === "string" ? request.body : "");
}

/** Where the app is served from, for the links Stripe sends people back to. */
export function appOrigin(request) {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const proto = request.headers["x-forwarded-proto"] ?? (/^(localhost|127\.)/.test(host ?? "") ? "http" : "https");
  return `${proto}://${host}`;
}

/** "Visa ···4242", "STRIPE TEST BANK ···6789": never more than that. */
export function methodLabel(method) {
  if (!method) return null;
  if (method.type === "card" && method.card) {
    const brand = method.card.display_brand ?? method.card.brand ?? "Card";
    const name = brand.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return `${name} ···${method.card.last4}`;
  }
  if (method.type === "us_bank_account" && method.us_bank_account) {
    return `${method.us_bank_account.bank_name ?? "Bank account"} ···${method.us_bank_account.last4}`;
  }
  return method.type;
}

/** The reason a person can act on, from Stripe's error on the PaymentIntent. */
function failureReason(intent) {
  const error = intent.last_payment_error;
  return error?.message ?? (error?.code ? error.code.replace(/_/g, " ") : "The payment did not go through.");
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    // The database's code travels with the message: the webhook tells a
    // payment that does not exist (P0002) from a failure worth retrying.
    const failure = new Error(`${name}: ${error.message}`);
    failure.code = error.code;
    throw failure;
  }
  return data;
}

/**
 * What the brand reads when money it paid is sent back, by the problem
 * record_payment_succeeded found (migration 20261022000300).
 */
const REFUND_REASONS = {
  amount_changed: "The amount changed while you were paying. You were refunded; please pay again.",
  order_cancelled: "The order was cancelled before your payment went through. You were refunded.",
  not_payable: "This step was not open for payment. You were refunded.",
  step_unpaid: "This step no longer takes a payment. You were refunded.",
  payment_gone: "This step no longer takes a payment. You were refunded.",
  other_intent: "This step was already being paid another way. You were refunded.",
};
const REFUNDED = "The payment was refunded.";

/**
 * Send back a PaymentIntent that was paid when its payment no longer wanted
 * it: the step's amount changed while the brand's Fund page was open, the
 * order was cancelled, or the step became Approval only. Then record it, so
 * the next checkout makes a new intent at the right amount.
 *
 * Only an intent this site made is ever refunded: other apps share TSC's
 * Stripe account, so the intent must name our payment AND the same order
 * (or, when the payment is gone, an order that exists here).
 *
 * Refund first, record after: if the refund fails, the intent is still the
 * payment's own and the webhook's retry finds the same problem and tries
 * again. Returns the payment row as it now stands, or null.
 */
async function refundIntent({ stripe, db, intent, charge, result }) {
  const paymentId = intent.metadata?.payment_id;
  const orderId = intent.metadata?.order_id;
  if (!paymentId || !orderId) return result.payment ?? null;
  if (result.payment) {
    if (result.payment.order_id !== orderId) return result.payment;
  } else {
    const { data: order } = await db.from("production_orders").select("id").eq("id", orderId).maybeSingle();
    if (!order) return null;
  }

  const problem = result.problem;
  const reason = REFUND_REASONS[problem] ?? "This payment was not needed any more. You were refunded.";
  if (!charge?.refunded) {
    // One refund per intent, however many times this runs. The webhook and
    // the brand's page can get here at the same moment: Stripe then answers
    // the second with an idempotency error (or "already refunded"), which
    // means the refund is done, so record it rather than fail.
    try {
      await stripe.refunds.create(
        { payment_intent: intent.id, metadata: { payment_id: paymentId, order_id: orderId, tsc_problem: problem } },
        { idempotencyKey: `refund-${intent.id}` },
      );
    } catch (failure) {
      const done = failure?.type === "StripeIdempotencyError" || failure?.code === "charge_already_refunded";
      if (!done) throw failure;
    }
  }
  console.warn("stripe: refunded a PaymentIntent its payment did not want", intent.id, paymentId, problem);
  return rpc(db, "record_payment_refunded", { target_payment: paymentId, payment_intent: intent.id, reason });
}

/**
 * Record that Stripe refunded a charge (charge.refunded, or a payout that
 * found its charge refunded). Only a charge that is a payment's own counts
 * (its recorded charge, or its attached intent); anything else is another
 * app's, or a stray intent of ours already recorded by refundIntent.
 *
 *   held (or clearing)  back to failed so the brand pays again, or
 *                       cancelled on a cancelled order
 *   paid out            stays paid out, with a line in its history and a
 *                       row on the staff board: TSC already paid the factory
 *
 * Any refund of held money counts, a partial one too. TSC must not pay the
 * factory more than it holds, and the payout is drawn on this charge
 * (source_transaction), which Stripe refuses once it is short. So the brand
 * pays the step again in full, and the rest of this charge is refunded too
 * so it is never charged twice for one step.
 *
 * Returns the payment row as it now stands, or null when it is not ours.
 */
export async function applyChargeRefund({ stripe, db, charge }) {
  if (!(Number(charge.amount_refunded) > 0)) return null;
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  const columns = "id, state, order_id, stripe_payment_intent_id, stripe_charge_id";
  let { data: payment } = await db.from("order_payments").select(columns).eq("stripe_charge_id", charge.id).maybeSingle();
  if (!payment && intentId) {
    ({ data: payment } = await db.from("order_payments").select(columns).eq("stripe_payment_intent_id", intentId).maybeSingle());
  }
  if (!payment || !intentId) return payment ?? null;

  // Our own refund of a stray intent (refundIntent) can get here before it
  // was recorded, or after recording it failed: record it with the reason
  // it was made for. Recording twice writes nothing the second time.
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  const ours = refunds.data.length > 0 && refunds.data.every((refund) => refund.metadata?.tsc_problem);
  const reason = ours ? REFUND_REASONS[refunds.data[0].metadata.tsc_problem] ?? REFUNDED : REFUNDED;

  if (!ours && payment.state !== "released" && !charge.refunded) {
    await stripe.refunds.create(
      { payment_intent: intentId, metadata: { payment_id: payment.id, order_id: payment.order_id } },
      { idempotencyKey: `refund-${intentId}` },
    );
  }
  return rpc(db, "record_payment_refunded", { target_payment: payment.id, payment_intent: intentId, reason });
}

/**
 * Record what a PaymentIntent says about its payment. Shared by the webhook,
 * /api/stripe-sync and the checkout, so all reach the same answer; every
 * database step is a no-op when the payment is already past it, so running
 * this twice, or late, changes nothing.
 *
 * Money that arrives is recorded only if the payment still wants exactly
 * that: record_payment_succeeded checks it under the order's lock, and
 * anything else is refunded (refundIntent).
 *
 * Returns the payment row as it now stands.
 */
export async function applyPaymentIntent({ stripe, db, intent }) {
  const paymentId = intent.metadata?.payment_id;
  if (!paymentId) return null;

  // The payment method and charge, expanded once.
  const full = typeof intent.payment_method === "object" && intent.latest_charge && typeof intent.latest_charge === "object"
    ? intent
    : await stripe.paymentIntents.retrieve(intent.id, { expand: ["payment_method", "latest_charge"] });
  const method = typeof full.payment_method === "object" ? full.payment_method : null;
  const charge = typeof full.latest_charge === "object" ? full.latest_charge : null;
  const label = methodLabel(method);

  if (full.status === "processing") {
    return rpc(db, "record_payment_processing", {
      target_payment: paymentId, method_type: method?.type ?? null, method_label: label,
    });
  }
  if (full.status === "succeeded") {
    // Already refunded in Stripe (that event can arrive before this one):
    // record the refund, never the money.
    if (charge && Number(charge.amount_refunded) > 0) {
      const refunded = await applyChargeRefund({ stripe, db, charge });
      if (refunded) return refunded;
      const { data } = await db.from("order_payments").select("*").eq("id", paymentId).maybeSingle();
      return data;
    }
    const result = await rpc(db, "record_payment_succeeded", {
      target_payment: paymentId,
      payment_intent: full.id,
      charge: charge?.id ?? null,
      method_type: method?.type ?? null,
      method_label: label,
      received: full.amount_received ?? full.amount,
    });
    if (!result.funded) return refundIntent({ stripe, db, intent: full, charge, result });
    const funded = result.payment;
    // A payment-only step (or one approved under the old rules) is owed to
    // the factory the moment it is funded.
    if (funded?.release_requested_at && funded.state === "confirmed") {
      await releasePayment({ stripe, db, paymentId }).catch(() => null);
    }
    return funded;
  }
  if (full.status === "requires_payment_method" && full.last_payment_error) {
    return rpc(db, "record_payment_failed", { target_payment: paymentId, reason: failureReason(full) });
  }
  const { data } = await db.from("order_payments").select("*").eq("id", paymentId).maybeSingle();
  return data;
}

/**
 * Pay a held payment out to its factory, if the database has asked for it
 * and the factory can be paid through Stripe. Safe to call any number of
 * times, from any number of places at once: the payment is claimed in the
 * database before anything is sent, so only one caller pays it, and a
 * released payment is left alone.
 *
 * Returns { released, reason }.
 */
export async function releasePayment({ stripe, db, paymentId }) {
  const { data: payment, error } = await db
    .from("order_payments")
    .select("id, state, amount_cents, currency, order_id, stripe_charge_id, stripe_transfer_id, release_requested_at, production_orders (factory_org_id, order_number)")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!payment) return { released: false, reason: "no such payment" };
  if (payment.state === "released") return { released: true, reason: "already paid out" };
  // Owed means the brand asked for it: it approved the step (or funded a
  // payment-only one) while the order was active. That stays owed if the
  // order is cancelled afterwards, since the work it paid for was done;
  // money merely held on a cancelled order has no release_requested_at and
  // is refunded by staff instead.
  if (payment.state !== "confirmed" || !payment.release_requested_at) {
    return { released: false, reason: "not owed to the factory yet" };
  }
  if (!payment.stripe_charge_id) {
    return { released: false, reason: "not paid through Stripe: staff pay this out by bank" };
  }

  // Refunded in Stripe since it was held (staff by hand, or a dispute):
  // there is nothing to pay the factory from, and Stripe would refuse the
  // transfer on every retry. Record it instead, which asks the brand to pay
  // again (or closes it on a cancelled order).
  const charge = await stripe.charges.retrieve(payment.stripe_charge_id);
  if (Number(charge.amount_refunded) > 0) {
    await applyChargeRefund({ stripe, db, charge });
    return { released: false, reason: "the brand's payment was refunded in Stripe, so there is nothing to pay out" };
  }

  const { data: account } = await db
    .from("stripe_connect_accounts")
    .select("stripe_account_id, transfers_active")
    .eq("org_id", payment.production_orders.factory_org_id)
    .maybeSingle();
  if (!account?.transfers_active) {
    return { released: false, reason: "the factory cannot be paid through Stripe yet" };
  }

  // Never pay twice. The webhook, the brand's page, the factory's refresh and
  // staff's Retry can all get here at the same moment; the database lets one
  // of them claim the payment and tells the rest it is taken. A claim left by
  // a call that died mid-way lapses after 10 minutes.
  const claimedAt = await rpc(db, "claim_payment_release", { target_payment: payment.id });
  if (!claimedAt) return { released: false, reason: "already being paid" };

  try {
    // A transfer for this payment that reached Stripe but not our database
    // (a crash in between, or a claim that lapsed) is found here and
    // recorded instead.
    const sent = await stripe.transfers.list({ transfer_group: payment.order_id, limit: 100 });
    const already = sent.data.find((transfer) => transfer.metadata?.payment_id === payment.id && !transfer.reversed);
    if (already) {
      await rpc(db, "record_payment_released", { target_payment: payment.id, transfer: already.id });
      return { released: true, reason: already.id };
    }

    // One key per claim: Stripe's own retries inside this call reuse it, and
    // the next claim gets a new one, because Stripe replays a key's first
    // answer for 24 hours and a refusal from before the factory's account
    // could take transfers must not outlive it.
    const transfer = await stripe.transfers.create(
      {
        amount: Number(payment.amount_cents),
        currency: payment.currency.toLowerCase(),
        destination: account.stripe_account_id,
        // Tied to the brand's charge: the transfer waits for that money to be
        // available rather than drawing on anything else in TSC's balance.
        source_transaction: payment.stripe_charge_id,
        transfer_group: payment.order_id,
        description: `${payment.production_orders.order_number}: payout`,
        metadata: { payment_id: payment.id, order_id: payment.order_id },
      },
      { idempotencyKey: `release-${payment.id}-${Date.parse(claimedAt)}` },
    );

    await rpc(db, "record_payment_released", { target_payment: payment.id, transfer: transfer.id });
    return { released: true, reason: transfer.id };
  } catch (failure) {
    // Hand the claim back so the next try (a webhook retry, staff's Retry)
    // need not wait for it to lapse. The exact time string goes back, so a
    // newer claim is never cleared by mistake.
    try {
      await db.rpc("release_payment_claim", { target_payment: payment.id, claimed: claimedAt });
    } catch {
      // the claim lapses on its own after 10 minutes
    }
    throw failure;
  }
}

/** Save what Stripe says about a factory's account. */
export async function saveConnectAccount(db, orgId, account) {
  const row = {
    org_id: orgId,
    stripe_account_id: account.id,
    country: account.country,
    details_submitted: Boolean(account.details_submitted),
    payouts_enabled: Boolean(account.payouts_enabled),
    transfers_active: account.capabilities?.transfers === "active",
    requirements_due: account.requirements?.currently_due ?? [],
  };
  const { error } = await db.from("stripe_connect_accounts").upsert(row, { onConflict: "org_id" });
  if (error) throw new Error(error.message);
  return row;
}

/** Answer with a status and a JSON body, the same shape on Vercel and in dev. */
export function reply(response, status, body) {
  response.status(status).json(body);
}

/**
 * Pay out everything a factory is owed that is still waiting: run when its
 * Stripe account starts accepting transfers, or when staff press Retry.
 */
export async function releaseOwedTo({ stripe, db, factoryOrgId }) {
  const { data: owed, error } = await db
    .from("order_payments")
    .select("id, production_orders!inner (factory_org_id)")
    .eq("state", "confirmed")
    .not("release_requested_at", "is", null)
    .eq("production_orders.factory_org_id", factoryOrgId);
  if (error) throw new Error(error.message);
  const results = [];
  for (const payment of owed ?? []) {
    results.push({ id: payment.id, ...(await releasePayment({ stripe, db, paymentId: payment.id }).catch((failure) => ({ released: false, reason: failure.message }))) });
  }
  return results;
}
