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
 *                              applyPaymentIntent below
 *   the brand approves      -> the database asks for the payout
 *                              (release_requested_at); releasePayment() sends
 *                              a Transfer to the factory's Express account
 *
 * Only this code, holding the service key, can move a payment through those
 * states; the database refuses everyone else. The browser never decides a
 * payment arrived.
 */

// Where a US platform can pay out through Connect; see the shared module.
export { PAYOUT_COUNTRIES } from "../src/shared/stripe-payout-countries.mjs";

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
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

/**
 * Record what a PaymentIntent says about its payment. Shared by the webhook
 * and /api/stripe-sync, so both reach the same answer; every database step is
 * a no-op when the payment is already past it, so running this twice, or
 * late, changes nothing.
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
    const funded = await rpc(db, "record_payment_funded", {
      target_payment: paymentId,
      charge: charge?.id ?? null,
      method_type: method?.type ?? null,
      method_label: label,
      received: full.amount_received ?? full.amount,
    });
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
 * times: the transfer's idempotency key is the payment, and a released
 * payment is left alone.
 *
 * Returns { released, reason }.
 */
export async function releasePayment({ stripe, db, paymentId }) {
  const { data: payment, error } = await db
    .from("order_payments")
    .select("id, state, amount_cents, currency, order_id, stripe_charge_id, stripe_transfer_id, release_requested_at, production_orders (factory_org_id, order_number, status)")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!payment) return { released: false, reason: "no such payment" };
  if (payment.state === "released") return { released: true, reason: "already paid out" };
  if (payment.state !== "confirmed" || !payment.release_requested_at) {
    return { released: false, reason: "not owed to the factory yet" };
  }
  if (payment.production_orders?.status === "cancelled") {
    return { released: false, reason: "the order was cancelled: staff refund or pay this by hand" };
  }
  if (!payment.stripe_charge_id) {
    return { released: false, reason: "not paid through Stripe: staff pay this out by bank" };
  }

  const { data: account } = await db
    .from("stripe_connect_accounts")
    .select("stripe_account_id, transfers_active, updated_at")
    .eq("org_id", payment.production_orders.factory_org_id)
    .maybeSingle();
  if (!account?.transfers_active) {
    return { released: false, reason: "the factory cannot be paid through Stripe yet" };
  }

  // Never pay twice. A transfer for this payment that reached Stripe but not
  // our database (a crash in between) is found here and recorded instead.
  const sent = await stripe.transfers.list({ transfer_group: payment.order_id, limit: 100 });
  const already = sent.data.find((transfer) => transfer.metadata?.payment_id === payment.id && !transfer.reversed);
  if (already) {
    await rpc(db, "record_payment_released", { target_payment: payment.id, transfer: already.id });
    return { released: true, reason: already.id };
  }

  // The key stops two calls at the same moment (the webhook and the brand's
  // page) from both paying. It also carries when the factory's account last
  // changed, because Stripe replays a key's first answer for 24 hours: a
  // refusal from before the account could take transfers must not outlive it.
  const attempt = Date.parse(account.updated_at) || 0;
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
    { idempotencyKey: `release-${payment.id}-${attempt}` },
  );

  await rpc(db, "record_payment_released", { target_payment: payment.id, transfer: transfer.id });
  return { released: true, reason: transfer.id };
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
