import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { logStripeFailure } from "./_stripe-errors.js";
import { cardReason } from "./_card-words.js";

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
 *   the brand approves      -> the money is owed (release_requested_at): it
 *                              stays with TSC, in the factory's balance
 *                              (factory_balance()), until the factory
 *                              withdraws. Nothing is transferred on approval
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
export function failureReason(intent) {
  return cardReason(intent.last_payment_error);
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
  // Held money on an order both sides cancelled (refundCancelledPayment).
  cancelled_order: "The order was cancelled. You were refunded.",
};
/** The brand's words for a refund made in Stripe; the server keys on the cause 'stripe_refund', never on these words. */
const REFUNDED = "The payment was refunded.";
/** TSC's own refund for a reason not listed above (cause 'not_needed'). */
const NOT_NEEDED = "This payment was not needed any more. You were refunded.";

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
  const reason = REFUND_REASONS[problem] ?? NOT_NEEDED;
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
  return rpc(db, "record_payment_refunded", { target_payment: paymentId, payment_intent: intent.id, reason, cause: REFUND_REASONS[problem] ? problem : "not_needed" });
}

/**
 * Record that Stripe refunded a charge (charge.refunded, a refund that failed
 * later, or a payout that found its charge refunded). Only a charge that is a
 * payment's own counts (its recorded charge, or its attached intent);
 * anything else is another app's, or a stray intent of ours already recorded
 * by refundIntent.
 *
 * Nothing is ever refunded here: what Stripe says was refunded in all
 * (charge.amount_refunded) is recorded as it is (record_payment_refund_amount),
 * so a partial refund staff make for a short shipment stays partial.
 *
 *   refunded in full before approval  back to Due, so the brand pays again
 *                                     (cancelled on a cancelled order)
 *   anything else                     the amount; the step stays as it is and
 *                                     only the factory's earning goes down.
 *                                     What it had already withdrawn is owed
 *                                     to TSC, and staff see it.
 *
 * Our own refunds (tsc_problem: a stray intent, a cancelled order) keep the
 * reason they were made for.
 *
 * Returns the payment row as it now stands, or null when it is not ours.
 */
async function paymentForCharge(db, charge) {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  const columns = "id, state, order_id, stripe_payment_intent_id, stripe_charge_id, refunded_cents";
  let { data: payment } = await db.from("order_payments").select(columns).eq("stripe_charge_id", charge.id).maybeSingle();
  if (!payment && intentId) {
    ({ data: payment } = await db.from("order_payments").select(columns).eq("stripe_payment_intent_id", intentId).maybeSingle());
  }
  return { payment: payment ?? null, intentId };
}

export async function applyChargeRefund({ stripe, db, charge }) {
  // Refunds staff made from the admin board are recorded first, by their own
  // row (record_staff_refund, once): they never open a payment review, and
  // the charge's total read below then holds only refunds made elsewhere
  // (20261125100000).
  let refunds = null;
  if (Number(charge.amount_refunded) > 0) {
    refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
    const staffMade = refunds.data.filter((refund) => refund.metadata?.staff_refund_id);
    for (const refund of staffMade) await recordStaffRefundFromStripe(db, refund);
    if (staffMade.length && staffMade.length === refunds.data.length) {
      return (await paymentForCharge(db, charge)).payment;
    }
  }
  const { payment, intentId } = await paymentForCharge(db, charge);
  // Nothing refunded, and nothing recorded as refunded: nothing to say.
  if (!(Number(charge.amount_refunded) > 0) && !(Number(payment?.refunded_cents) > 0)) return null;
  // A charge staff refunded again after a refund recorded as full failed
  // (the brand had paid again, or the order is cancelled): its Needs
  // checking row goes (20261121240000, 20261121250000).
  if (intentId && charge.refunded && (!payment || payment.state === "cancelled")) {
    await rpc(db, "record_refund_failure_resolved", { payment_intent: intentId });
  }
  if (!payment || !intentId) return payment ?? null;

  // Our own refund of a stray intent (refundIntent) can get here before it
  // was recorded, or after recording it failed: record it with the reason
  // it was made for. Recording twice writes nothing the second time.
  refunds ??= await stripe.refunds.list({ charge: charge.id, limit: 100 });
  const ours = refunds.data.length > 0 && refunds.data.every((refund) => refund.metadata?.tsc_problem && !refund.metadata?.staff_refund_id);
  if (ours && charge.refunded) {
    // Never 'stripe_refund': that cause means a refund made in Stripe, which
    // record_full_refund_failed may fund again if it fails (20261121340000).
    const problem = refunds.data[0].metadata.tsc_problem;
    const reason = REFUND_REASONS[problem] ?? NOT_NEEDED;
    return rpc(db, "record_payment_refunded", { target_payment: payment.id, payment_intent: intentId, reason, cause: REFUND_REASONS[problem] ? problem : "not_needed" });
  }
  // Not funded here yet: refunded in full, the brand pays again; in part,
  // nothing yet. applyPaymentIntent records it at its amount once the
  // payment is funded, and everyone is told then.
  if (!["confirmed", "released"].includes(payment.state)) {
    if (!charge.refunded) return payment;
    return rpc(db, "record_payment_refunded", { target_payment: payment.id, payment_intent: intentId, reason: REFUNDED, cause: "stripe_refund" });
  }
  // Only ever raises the total: an older copy of the charge never lowers it.
  return rpc(db, "record_payment_refund_amount", {
    target_payment: payment.id, payment_intent: intentId, refunded_cents: Number(charge.amount_refunded) || 0,
  });
}

/** What the brand reads when a cancelled order's held money goes back. */
const CANCELLED_REFUND = "The order was cancelled. You were refunded.";

/**
 * The refund failure staff read on the board, by Stripe's code: never
 * Stripe's message, which can quote a key.
 */
export function cancelRefundFailure(failure) {
  const code = failure?.code ?? failure?.raw?.code;
  if (code === "charge_disputed") return "The brand disputed this charge: settle it in Stripe's dispute, not by refund.";
  if (code === "insufficient_funds" || code === "balance_insufficient") {
    return "TSC's Stripe balance is too low to refund this. Top it up, then refund the payment in Stripe.";
  }
  if (code === "charge_expired_for_refund") return "Stripe can no longer refund this charge (too old). Refund the brand by bank.";
  if (failure?.type === "StripeAuthenticationError" || failure?.type === "StripePermissionError") {
    return "Stripe refused TSC's key, so nothing was refunded. Fix STRIPE_SECRET_KEY, then refund the payment in Stripe.";
  }
  if (failure?.refundStatus) return `Stripe says the refund ${failure.refundStatus === "canceled" ? "was cancelled" : "failed"}. Refund the brand in Stripe.`;
  return "Stripe refused the refund. Open the payment in Stripe and refund it there.";
}

const OUTAGE_TYPES = new Set(["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"]);

/**
 * Refund one held payment on a cancelled order to the brand, in full (fee
 * included). Claimed first (claim_cancellation_refund), so the webhook, the
 * accepting page and the daily job never refund twice; the claim's time is in
 * the idempotency key, so a refusal Stripe stored is never replayed on the next
 * try. A refund already made on the charge in full (by staff, or a try whose
 * reply was lost) is recorded instead of making another; after a partial one,
 * only the rest is refunded.
 *
 * Returns "refunded", "failed", "retry" (Stripe unreachable: the lease runs
 * out and the next try goes again) or the claim's refusal.
 */
export async function refundCancelledPayment({ stripe, db, paymentId }) {
  const claim = await rpc(db, "claim_cancellation_refund", { target_payment: paymentId });
  if (claim?.refused) return claim.refused;

  try {
    // A partial refund staff made first (or a try whose reply was lost)
    // counts; only the rest is refunded (no amount: Stripe refunds what is
    // left), never the whole charge again.
    const existing = await stripe.refunds.list({ payment_intent: claim.intent, limit: 100 });
    const made = existing.data.filter((refund) => ["succeeded", "pending"].includes(refund.status))
      .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
    const intent = made > 0 ? await stripe.paymentIntents.retrieve(claim.intent) : null;
    if (!made || made < Number(intent?.amount_received ?? 0)) {
      const refund = await stripe.refunds.create(
        {
          payment_intent: claim.intent,
          reason: "requested_by_customer",
          metadata: { payment_id: claim.payment_id, order_id: claim.order_id, tsc_problem: "cancelled_order" },
        },
        { idempotencyKey: claim.key },
      );
      if (!["succeeded", "pending"].includes(refund.status)) {
        const failure = new Error(`refund ${refund.status}`);
        failure.refundStatus = refund.status;
        throw failure;
      }
    }
  } catch (failure) {
    logStripeFailure("cancel-refund", failure, { paymentId });
    if (OUTAGE_TYPES.has(failure?.type)) return "retry";
    await rpc(db, "record_cancellation_refund_failed", { target_payment: paymentId, reason: cancelRefundFailure(failure) });
    return "failed";
  }
  await rpc(db, "record_payment_refunded", { target_payment: paymentId, payment_intent: claim.intent, reason: CANCELLED_REFUND, cause: "cancelled_order" });
  return "refunded";
}

/**
 * A refund Stripe accepted and later failed (refund.updated, refund.failed,
 * charge.refund.updated). Our own cancelled-order refund: the money is held
 * again, and staff see why. Any other (a refund staff made in Stripe): its
 * charge is read again and the smaller total recorded. Returns the payment
 * row, or null.
 */
export async function applyRefundUpdate({ stripe = null, db, refund }) {
  // A refund staff made from the admin board: its own row says what happens
  // (20261125100000). A full refund of a held payment that failed goes on to
  // record_full_refund_failed below, as a refund made in Stripe does.
  if (refund?.metadata?.staff_refund_id) {
    const row = await recordStaffRefundFromStripe(db, refund);
    if (!row?.reset_payment || !["failed", "canceled"].includes(refund.status)) return row;
  }
  if (!["failed", "canceled"].includes(refund?.status)) return null;
  const paymentId = refund.metadata?.tsc_problem === "cancelled_order" ? refund.metadata.payment_id : null;
  if (!paymentId) {
    // Lowered only when Stripe, read again now, says this refund failed;
    // then the charge's total as it is now is recorded.
    const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
    if (!stripe || !chargeId || !refund.id) return null;
    const fresh = await stripe.refunds.retrieve(refund.id);
    if (!["failed", "canceled"].includes(fresh?.status)) return null;
    const charge = await stripe.charges.retrieve(chargeId);
    const { payment, intentId } = await paymentForCharge(db, charge);
    if (!intentId) return null;
    // A refund recorded as full that failed: the brand was sent back to pay
    // (the payment no longer names this charge), or the order was cancelled
    // and the payment kept it. record_full_refund_failed decides: funded
    // again with it, or staff refund it again (20261121240000, 20261121250000).
    // TSC's own refund of an extra payment (a stray intent) goes there too:
    // the database never funds the step again with it, staff refund it again
    // (20261121260000).
    if (!payment || payment.state === "cancelled") {
      if (charge.refunded) return null;
      const paymentIdOf = payment?.id ?? (await stripe.paymentIntents.retrieve(intentId)).metadata?.payment_id;
      if (!paymentIdOf) return null;
      // What Stripe still counts as lost on this charge, kept on a payment
      // funded again (each side was told when it happened).
      let lost = null;
      if (charge.disputed) {
        const dispute = await disputeForCharge(stripe, charge);
        if (dispute?.status === "lost") lost = { cents: Number(dispute.amount) || 0, fee: disputeFeeCents(dispute) };
      }
      return rpc(db, "record_full_refund_failed", {
        target_payment: paymentIdOf, payment_intent: intentId, charge: charge.id,
        charged: Number(charge.amount_captured ?? charge.amount) || 0,
        refunded_now: Number(charge.amount_refunded) || 0,
        failed_cents: Number(fresh.amount) || 0,
        lost_cents: lost?.cents ?? 0, fee_cents: lost?.fee ?? null,
      });
    }
    if (!payment) return null;
    await rpc(db, "record_payment_refund_failed", {
      target_payment: payment.id, payment_intent: intentId, refunded_cents: Number(charge.amount_refunded) || 0,
    });
    // A refund made since that read is never lost: the charge as it is now,
    // recorded by the function that only raises (20261121240000).
    return applyChargeRefund({ stripe, db, charge: await stripe.charges.retrieve(chargeId) });
  }
  const failure = new Error(`refund ${refund.status}`);
  failure.refundStatus = refund.status;
  return rpc(db, "record_cancellation_refund_failed", { target_payment: paymentId, reason: cancelRefundFailure(failure) });
}

/**
 * What staff read when Stripe refuses or fails a refund they made from the
 * admin board, by Stripe's code: never Stripe's message, which can quote a key.
 */
export function staffRefundFailure(failure) {
  const code = failure?.code ?? failure?.raw?.code;
  if (code === "charge_disputed") return "The bank is deciding this payment.";
  if (code === "insufficient_funds" || code === "balance_insufficient") {
    return "TSC's Stripe balance is too low. Add funds in Stripe, then try again.";
  }
  if (code === "charge_expired_for_refund") return "This charge is too old to refund to the card. Refund the brand by bank.";
  if (failure?.type === "StripeAuthenticationError" || failure?.type === "StripePermissionError") {
    return "Stripe refused TSC's key. Nothing was refunded.";
  }
  if (failure?.refundStatus) return "The refund failed. Nothing was refunded.";
  return "Stripe refused the refund. Nothing was refunded.";
}

/** A staff refund as Stripe reports it (its webhook, or a read), recorded once by its own row. */
async function recordStaffRefundFromStripe(db, refund) {
  const id = refund.metadata.staff_refund_id;
  if (["failed", "canceled"].includes(refund.status)) {
    const failure = new Error(`refund ${refund.status}`);
    failure.refundStatus = refund.status;
    return rpc(db, "record_staff_refund_failed", { target_refund: id, reason: staffRefundFailure(failure) });
  }
  return rpc(db, "record_staff_refund", { target_refund: id, stripe_refund: refund.id, refund_status: refund.status });
}

const dollars = (cents) => `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Make a refund staff claimed (claim_staff_refund), once. The claim's key
 * carries its time, and a retry first looks for a refund already made for
 * this claim (metadata.staff_refund_id), so a lost reply or an outage never
 * refunds twice. Recording happens outside the Stripe try: a database
 * failure after Stripe refunded leaves the claim for Check again, never
 * marks it failed.
 *
 * Returns { status: "refunded" | "pending", ... } | { refused, detail } |
 * { failed: sentence } | { retry: true }.
 */
export async function makeStaffRefund({ stripe, db, claim }) {
  const figures = { amountCents: claim.amount_cents, factoryCents: claim.factory_cents, tscCents: claim.tsc_cents };
  if (claim.status === "made") return { status: "refunded", ...figures };
  if (claim.status === "failed") return { failed: claim.failure ?? "Stripe refused the refund. Nothing was refunded." };
  let refund;
  try {
    const listed = await stripe.refunds.list({ payment_intent: claim.intent, limit: 100 });
    refund = listed.data.find((one) => one.metadata?.staff_refund_id === claim.staff_refund_id);
    if (!refund) {
      // Only what Stripe still holds of the charge can go back.
      const intent = await stripe.paymentIntents.retrieve(claim.intent);
      const made = listed.data.filter((one) => ["succeeded", "pending"].includes(one.status))
        .reduce((sum, one) => sum + Number(one.amount || 0), 0);
      const left = Math.max(0, Number(intent.amount_received || 0) - made);
      if (claim.amount_cents > left) {
        await rpc(db, "record_staff_refund_failed", { target_refund: claim.staff_refund_id, reason: `You can refund up to ${dollars(left)}.` });
        return { refused: "staff_refund_over", detail: dollars(left) };
      }
      refund = await stripe.refunds.create(
        {
          payment_intent: claim.intent,
          amount: claim.amount_cents,
          reason: "requested_by_customer",
          metadata: { payment_id: claim.payment_id, order_id: claim.order_id, staff_refund_id: claim.staff_refund_id, tsc_problem: "staff_refund" },
        },
        { idempotencyKey: claim.key },
      );
    }
    if (!["succeeded", "pending"].includes(refund.status)) {
      const failure = new Error(`refund ${refund.status}`);
      failure.refundStatus = refund.status;
      throw failure;
    }
  } catch (failure) {
    logStripeFailure("staff-refund", failure, { staffRefundId: claim.staff_refund_id });
    if (OUTAGE_TYPES.has(failure?.type)) return { retry: true };
    const sentence = staffRefundFailure(failure);
    await rpc(db, "record_staff_refund_failed", { target_refund: claim.staff_refund_id, reason: sentence });
    return { failed: sentence };
  }
  await rpc(db, "record_staff_refund", { target_refund: claim.staff_refund_id, stripe_refund: refund.id, refund_status: refund.status });
  return { status: refund.status === "pending" ? "pending" : "refunded", ...figures };
}

/** The daily job: claims Stripe couldn't be asked about, finished. Returns counts. */
export async function settleStaffRefunds({ stripe, db }) {
  const counts = { refunded: 0, failed: 0, retry: 0 };
  const ids = await rpc(db, "staff_refunds_unsettled", {});
  for (const id of ids ?? []) {
    try {
      const claim = await rpc(db, "staff_refund_for_server", { target_refund: id });
      if (!claim) continue;
      const outcome = await makeStaffRefund({ stripe, db, claim });
      if (outcome.status) counts.refunded += 1;
      else if (outcome.retry) counts.retry += 1;
      else counts.failed += 1;
    } catch (failure) {
      logStripeFailure("staff-refund-sweep", failure, { staffRefundId: id });
      counts.retry += 1;
    }
  }
  return counts;
}

/**
 * Every held payment still to refund on cancelled orders (or on one order).
 * Returns { refunded, failed, retry } counts; one payment's failure never
 * stops the next.
 */
export async function refundCancelledOrders({ stripe, db, orderId = null }) {
  const counts = { refunded: 0, failed: 0, retry: 0 };
  const ids = await rpc(db, "cancellation_refunds_due", { target_order: orderId });
  for (const id of ids ?? []) {
    try {
      const outcome = await refundCancelledPayment({ stripe, db, paymentId: id });
      if (outcome in counts) counts[outcome] += 1;
      // Held with no Stripe charge: recorded as failed, for staff.
      if (outcome === "no_stripe_charge") counts.failed += 1;
    } catch (failure) {
      logStripeFailure("cancel-refund", failure, { paymentId: id });
      counts.retry += 1;
    }
  }
  return counts;
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
    // Already refunded in full in Stripe (that event can arrive before this
    // one): record the refund, never the money. A partial refund is recorded
    // after the money, below.
    if (charge?.refunded) {
      const refunded = await applyChargeRefund({ stripe, db, charge });
      if (refunded) return refunded;
      const { data } = await db.from("order_payments").select("*").eq("id", paymentId).maybeSingle();
      return data;
    }
    // Disputed in the same second it was paid (its dispute event can come
    // before this): recorded first, from Stripe, so the funded notice says
    // the money is on hold, never "added to your balance". Never fails the
    // recording; the dispute webhook retries until the payment is known.
    if (charge?.id) {
      await recordChargeDispute({ stripe, db, paymentId, charge })
        .catch((failure) => logStripeFailure("charge-dispute", failure, { paymentId }));
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
    // A payment-only step is owed to the factory the moment it is funded, but
    // nothing is sent: it waits in the factory's balance until it withdraws.
    // When the charge's money becomes available decides Available or Pending.
    // Stripe attaches the charge's balance transaction a few seconds after
    // the payment succeeds: waited for briefly. Never fails the recording.
    await recordFundsAvailable({ stripe, db, paymentId, charge, waitMs: FUNDS_WAIT_MS })
      .catch((failure) => logStripeFailure("funds-available", failure, { paymentId }));
    // The charge as it is now, read after the funding is saved: a refund or
    // a dispute made while this ran found the payment still processing and
    // recorded nothing then (20261121240000).
    // A read that fails keeps the funding as saved: the copy read before it
    // is used, and the next read of this charge (a webhook, a balance read,
    // a payout's check) records the rest.
    const now = charge?.id
      ? await stripe.charges.retrieve(charge.id).catch((failure) => { logStripeFailure("charge-reread", failure, { paymentId }); return charge; })
      : null;
    // A dispute lost while the payment was still processing was only noted
    // then: recorded now that it is funded. A later read of the charge tries
    // again if this fails.
    if (now?.disputed) {
      await recordChargeDispute({ stripe, db, paymentId, charge: now })
        .catch((failure) => logStripeFailure("charge-dispute", failure, { paymentId }));
    }
    if (now && Number(now.amount_refunded) > 0) {
      return (await applyChargeRefund({ stripe, db, charge: now })) ?? result.payment;
    }
    return result.payment;
  }
  if (full.status === "requires_payment_method" && full.last_payment_error) {
    return rpc(db, "record_payment_failed", { target_payment: paymentId, reason: failureReason(full) });
  }
  const { data } = await db.from("order_payments").select("*").eq("id", paymentId).maybeSingle();
  return data;
}

/** How long a fresh payment waits for Stripe to attach its balance transaction (about 1.5 to 5 s after confirming). */
export const FUNDS_WAIT_MS = 10_000;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The order payment a dispute is about: by its charge, else by its
 * PaymentIntent (a charge can be disputed before its payment is recorded;
 * the intent is attached at checkout). An order payment Stripe knows but this
 * database does not yet throws, so the event is not marked processed and
 * Stripe sends it again. Another app's charge, or a credit pack, is null.
 */
export async function paymentForDispute({ stripe, db, dispute }) {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null;
  let { data: payment, error } = await db.from("order_payments").select("id").eq("stripe_charge_id", chargeId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!payment && intentId) {
    ({ data: payment, error } = await db.from("order_payments").select("id").eq("stripe_payment_intent_id", intentId).maybeSingle());
    if (error) throw new Error(error.message);
  }
  if (!payment && intentId) {
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const ownId = intent.metadata?.payment_id;
    if (ownId) {
      // Lost before approval already: the payment went back to Due and no
      // longer names this charge. A late event about it changes nothing.
      const { data: events, error: eventsError } = await db.from("payment_events").select("id")
        .eq("payment_id", ownId).eq("cause", "dispute_lost").eq("stripe_ref", dispute.id).limit(1);
      if (eventsError) throw new Error(eventsError.message);
      if (events?.length) return null;
      throw new Error("the disputed charge's payment is not recorded yet");
    }
  }
  return payment ?? null;
}

/** Stripe's dispute fees on a dispute, in its balance transactions (US cents); null when it lists none. */
export function disputeFeeCents(dispute) {
  const rows = dispute?.balance_transactions ?? [];
  if (!rows.length) return null;
  return Math.max(0, rows.reduce((sum, row) => sum + Number(row?.fee || 0), 0));
}

/**
 * A dispute as it is now, recorded on its payment: open (on hold), won or
 * closed in TSC's favour (hold lifted), or lost (the disputed amount went
 * back to the brand, as a refund: record_payment_dispute_lost, which also
 * ends the hold). Returns true while it is on hold.
 */
/**
 * A dispute's payment review, one per dispute id (20261125100000): Stripe's
 * status drives it. An inquiry pauses nobody; a chargeback pauses the brand
 * (and the factory, on money in its balance); won resumes the factory by
 * itself; lost waits for staff's Approve or Decline.
 */
async function recordDisputeReview(db, paymentId, dispute) {
  const dueBy = Number(dispute.evidence_details?.due_by);
  return rpc(db, "record_payment_review_dispute", {
    target_payment: paymentId, dispute_id: dispute.id, status: dispute.status ?? null,
    amount_cents: Number.isFinite(Number(dispute.amount)) ? Number(dispute.amount) : null,
    due_by: dueBy > 0 ? new Date(dueBy * 1000).toISOString() : null,
    fee_cents: disputeFeeCents(dispute),
  });
}

export async function applyDispute({ db, paymentId, dispute }) {
  if (dispute?.id) await recordDisputeReview(db, paymentId, dispute);
  const state = disputeState({ disputed: true }, dispute);
  if (state === "lost") {
    await rpc(db, "record_payment_dispute_lost", {
      target_payment: paymentId, dispute_id: dispute.id,
      lost_cents: Number.isFinite(Number(dispute.amount)) ? Number(dispute.amount) : null,
      fee_cents: disputeFeeCents(dispute),
    });
    return false;
  }
  const disputed = state === "open";
  await rpc(db, "record_payment_disputed", { target_payment: paymentId, disputed });
  return disputed;
}

/**
 * A charge's dispute, as every road reads it: "lost" (the brand's bank took
 * the money back), "open" (on hold: anything but won or closed in TSC's
 * favour, a dispute Stripe will not name included), or null (none, or one
 * TSC won). Stripe keeps `disputed` true after a decision.
 */
export function disputeState(charge, dispute) {
  if (!charge?.disputed) return null;
  if (dispute?.status === "lost") return "lost";
  return dispute && ["won", "warning_closed"].includes(dispute.status) ? null : "open";
}

/**
 * Whether the brand's charge is still good, the one check every road makes
 * before money leaves TSC (a Stripe or PayPal / Wise withdrawal, a per-step
 * payout) and the balance read makes without waiting for webhooks: read from
 * Stripe (or as given) and recorded as its webhooks would, a refund at its
 * amount (applyChargeRefund) and its dispute open, won or lost
 * (applyDispute). Both: a charge refunded in part can be disputed for the
 * rest. Throws when Stripe or the database fails. Returns
 * { charge, refunded, dispute } with `dispute` as disputeState says; what
 * each road then asks the database (withdrawal_refunded_part,
 * per_step_payout_check) decides what part is still the factory's.
 */
export async function checkCharge({ stripe, db, paymentId, charge }) {
  const read = typeof charge === "object" && charge && "disputed" in charge ? charge : await stripe.charges.retrieve(typeof charge === "string" ? charge : charge?.id);
  const refunded = Number(read.amount_refunded) > 0;
  if (refunded) await applyChargeRefund({ stripe, db, charge: read });
  const dispute = await recordChargeDispute({ stripe, db, paymentId, charge: read });
  return { charge: read, refunded, dispute };
}

/**
 * A dispute event, recorded on its payment. An event that lifts a hold (won,
 * or an inquiry closed in TSC's favour) is checked against the charge's
 * newest dispute first: an inquiry closing late must not lift the hold of
 * the chargeback opened after it. Returns true while it is on hold; null when
 * the charge is not an order payment.
 */
export async function applyDisputeEvent({ stripe, db, dispute }) {
  const payment = await paymentForDispute({ stripe, db, dispute });
  if (!payment) return null;
  let current = dispute;
  if (["won", "warning_closed", "prevented"].includes(dispute?.status)) {
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
    if (chargeId) current = (await disputeForCharge(stripe, await stripe.charges.retrieve(chargeId))) ?? dispute;
  }
  // One review per dispute (20261125100000): this event's own dispute is
  // recorded on its own review, even when a newer one on the charge decides
  // the step's hold.
  if (current?.id && dispute?.id && current.id !== dispute.id) await recordDisputeReview(db, payment.id, dispute);
  return applyDispute({ db, paymentId: payment.id, dispute: current });
}

/**
 * A disputed charge's dispute, or null. Stripe's Charge typings at the SDK's
 * API version list only `disputed`, not `dispute` (the API still returns the
 * id today), so a charge without it is looked up by charge: one dispute per
 * charge, newest first. Every read of a charge's dispute goes through here.
 */
export async function disputeForCharge(stripe, charge) {
  if (!charge?.disputed) return null;
  const ref = charge.dispute;
  if (ref && typeof ref === "object" && ref.status) return ref;
  const disputeId = typeof ref === "string" ? ref : ref?.id;
  if (disputeId) return stripe.disputes.retrieve(disputeId);
  const found = await stripe.disputes.list({ charge: charge.id, limit: 1 });
  return found?.data?.[0] ?? null;
}

/**
 * A charge's dispute (checkCharge's dispute half, and the one place it is
 * read): open, won or lost (Stripe keeps `disputed` true after a decision),
 * recorded on its payment (applyDispute). The charge is read from Stripe
 * unless given as read. Returns disputeState's word: "open" while it is on
 * hold, "lost", or null (none, or won).
 */
export async function recordChargeDispute({ stripe, db, paymentId, charge }) {
  const chargeId = typeof charge === "string" ? charge : charge?.id;
  if (!chargeId) return null;
  const fresh = typeof charge === "object" && "disputed" in charge ? charge : await stripe.charges.retrieve(chargeId);
  if (!fresh.disputed) return null;
  const found = await disputeForCharge(stripe, fresh);
  await applyDispute({ db, paymentId, dispute: found });
  return disputeState(fresh, found);
}

/**
 * Record when a charge's money is available on TSC's Stripe account (its
 * balance transaction's available_on): until then the factory's owed money
 * for it is Pending, not Available, and cannot be withdrawn through Stripe.
 * A charge that has no balance transaction yet (Stripe adds it a few seconds
 * after the payment succeeds) is read again, backing off, for up to `waitMs`.
 * Returns the date, or null when Stripe has none yet.
 */
export async function recordFundsAvailable({ stripe, db, paymentId, charge, waitMs = 0 }) {
  if (!charge) return null;
  const chargeId = typeof charge === "string" ? charge : charge.id;
  let transaction = typeof charge === "string" ? null : charge.balance_transaction;
  const deadline = Date.now() + waitMs;
  let delay = 500;
  for (;;) {
    if (!transaction) {
      const fresh = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
      transaction = fresh.balance_transaction;
    } else if (typeof transaction === "string") {
      transaction = await stripe.balanceTransactions.retrieve(transaction);
    }
    if (Number(transaction?.available_on) || Date.now() + delay > deadline) break;
    transaction = null;
    await pause(delay);
    delay = Math.min(delay * 2, 3000);
  }
  const seconds = Number(transaction?.available_on);
  if (!seconds) return null;
  const availableAt = new Date(seconds * 1000).toISOString();
  await rpc(db, "record_payment_funds_available", { target_payment: paymentId, available_at: availableAt });
  return availableAt;
}

/**
 * A funded Stripe payment whose clearing date is still missing (Stripe had
 * none yet, recording it failed, or it was cleared because the charge
 * changed) gets it now. Throws when Stripe or the database fails, so a
 * webhook delivery is tried again. Returns the date, or null when there is
 * nothing to record or Stripe has no date yet.
 */
export async function ensureFundsAvailable({ stripe, db, paymentId, waitMs = 0 }) {
  const { data: payment, error } = await db.from("order_payments")
    .select("id, state, stripe_charge_id, funds_available_at").eq("id", paymentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!payment || !["confirmed", "released"].includes(payment.state) || !payment.stripe_charge_id) return null;
  if (payment.funds_available_at) return payment.funds_available_at;
  return recordFundsAvailable({ stripe, db, paymentId, charge: payment.stripe_charge_id, waitMs });
}

/**
 * Before a factory's balance is read: its funded Stripe payments still
 * without a clearing date get one (a few per read, within `budgetMs`), so a
 * date Stripe added after the payment was recorded is never missed for long.
 * Never throws; returns how many were recorded in time.
 */
export async function ensureFundsAvailableFor({ stripe, db, orgId, limit = 5, budgetMs = 4000 }) {
  const work = (async () => {
    const { data, error } = await db.from("order_payments")
      .select("id, production_orders!inner(factory_org_id)")
      .eq("production_orders.factory_org_id", orgId).in("state", ["confirmed", "released"])
      .not("stripe_charge_id", "is", null).is("funds_available_at", null)
      .order("confirmed_at", { ascending: true }).limit(limit);
    if (error) return 0;
    const done = await Promise.all((data ?? []).map(async (row) => {
      const at = await ensureFundsAvailable({ stripe, db, paymentId: row.id })
        .catch((failure) => { logStripeFailure("funds-available", failure, { paymentId: row.id }); return null; });
      // The same few payments, freshly paid: a dispute Stripe already holds
      // on the charge is recorded too.
      const { data: payment } = await db.from("order_payments").select("stripe_charge_id").eq("id", row.id).maybeSingle();
      if (payment?.stripe_charge_id) {
        await recordChargeDispute({ stripe, db, paymentId: row.id, charge: payment.stripe_charge_id })
          .catch((failure) => logStripeFailure("charge-dispute", failure, { paymentId: row.id }));
      }
      return at;
    }));
    return done.filter(Boolean).length;
  })().catch(() => 0);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(0), budgetMs); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether this balance read may ask Stripe about the company's charges and
 * payouts: at most once a minute per company, decided by the database
 * (claim_balance_stripe_read), so owners and members reloading cannot exhaust
 * Stripe's rate limit. False on any failure: the next read tries again.
 */
export async function claimStripeRead(db, orgId) {
  try {
    const { data, error } = await db.rpc("claim_balance_stripe_read", { target_org: orgId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Before a factory's balance is read, without waiting for webhooks: the few
 * owed steps whose brand charge was checked least recently are read from
 * Stripe, and a refund or dispute there is recorded as its webhook would
 * (applyChargeRefund, recordChargeDispute), so refunded or disputed money
 * leaves the balance even when charge.refunded or charge.dispute.* never
 * arrives. Writes only on a change. Never throws; bounded by `budgetMs`.
 * Returns how many charges were read in time.
 */
export async function checkChargesFor({ stripe, db, orgId, limit = 5, budgetMs = 4000 }) {
  const work = (async () => {
    const { data: owed, error } = await db.from("order_payments")
      .select("id, stripe_charge_id, production_orders!inner(factory_org_id)")
      .eq("production_orders.factory_org_id", orgId).eq("state", "confirmed")
      .not("release_requested_at", "is", null).not("stripe_charge_id", "is", null)
      .limit(500);
    if (error || !owed?.length) return 0;
    const { data: checks } = await db.from("payment_charge_checks").select("payment_id, checked_at")
      .in("payment_id", owed.map((row) => row.id));
    const last = new Map((checks ?? []).map((row) => [row.payment_id, Date.parse(row.checked_at)]));
    // Steps an open withdrawal holds are read first, on every read the
    // company's once-a-minute claim allows: staff could pay them out. Any
    // other step read in the last 5 minutes is not read again.
    let held = new Set();
    try {
      const { data: heldRows } = await db.from("payment_takes")
        .select("payment_id, factory_withdrawals!inner(status)")
        .eq("org_id", orgId).eq("status", "held").eq("road", "pool")
        .in("factory_withdrawals.status", ["requested", "paying"]);
      held = new Set((heldRows ?? []).map((row) => row.payment_id));
    } catch {
      // Read as no step held: the least recently checked still go first.
    }
    const fresh = Date.now() - 5 * 60 * 1000;
    const due = owed.filter((row) => held.has(row.id) || !((last.get(row.id) ?? 0) > fresh))
      // Held first; within each group the least recently checked first, so
      // with more than `limit` held steps they are all read in turn.
      .sort((a, b) => (held.has(b.id) - held.has(a.id)) || ((last.get(a.id) ?? 0) - (last.get(b.id) ?? 0)))
      .slice(0, limit);
    const read = await Promise.all(due.map(async (row) => {
      try {
        await checkCharge({ stripe, db, paymentId: row.id, charge: row.stripe_charge_id });
        return row.id;
      } catch (failure) {
        logStripeFailure("charge-check", failure, { paymentId: row.id });
        return null;
      }
    }));
    const done = read.filter(Boolean);
    if (done.length) await db.rpc("record_charges_checked", { targets: done });
    return done.length;
  })().catch(() => 0);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(0), budgetMs); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stripe's charge.updated: the balance transaction has appeared on a charge
 * whose payment is recorded with no clearing date. Returns the date or null.
 */
export async function applyChargeUpdated({ stripe, db, charge }) {
  if (!charge?.id || !charge.balance_transaction) return null;
  const { data: payment, error } = await db.from("order_payments")
    .select("id, state, funds_available_at").eq("stripe_charge_id", charge.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!payment || !["confirmed", "released"].includes(payment.state) || payment.funds_available_at) return null;
  return recordFundsAvailable({ stripe, db, paymentId: payment.id, charge });
}

/**
 * A release an earlier version started on approval (a claim and a Stripe
 * call), settled without sending anything new: a transfer that went is
 * recorded, and one that did not is unpinned so the money stays in the
 * factory's balance. Never creates a transfer.
 *
 * Returns { released, reason }.
 */
export async function settleRelease({ stripe, db, paymentId }) {
  const { data: payment, error } = await db
    .from("order_payments")
    .select("id, state, amount_cents, order_id, stripe_release_started, release_claimed_at")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!payment) return { released: false, reason: "no such payment" };
  if (payment.state === "released") return { released: true, reason: "already paid out" };
  if (payment.state !== "confirmed" || !payment.stripe_release_started) {
    return { released: false, reason: "in the factory's balance until it withdraws" };
  }
  const settled = await settleStartedRelease({ stripe, db, payment });
  return settled ?? { released: false, reason: "in the factory's balance until it withdraws" };
}

/**
 * The transfer that paid this payment, found by its metadata, or null.
 * Withdrawal fees are taken by reversing the factory's transfers
 * (api/_stripe-withdrawals.js, metadata stripe_withdrawal_id), so a small
 * step's transfer can be reversed in full by them: it still paid the step, and
 * paying it again would pay twice. Only a transfer that other reversals (staff
 * in Stripe) took back in full counts as undone.
 */
async function paymentTransfer(stripe, payment) {
  for await (const transfer of stripe.transfers.list({ transfer_group: payment.order_id, limit: 100 })) {
    if (transfer.metadata?.payment_id !== payment.id) continue;
    if (!transfer.reversed) return transfer;
    let byWithdrawalFees = 0;
    for await (const reversal of stripe.transfers.listReversals(transfer.id, { limit: 100 })) {
      if (reversal.metadata?.stripe_withdrawal_id) byWithdrawalFees += Number(reversal.amount);
    }
    if (Number(transfer.amount_reversed) - byWithdrawalFees < Number(transfer.amount)) return transfer;
  }
  return null;
}

/**
 * What the factory paid on a transfer that went: the step less what was sent.
 * Zero since 2026-11-17 (the whole step is sent); a transfer made before then
 * held Stripe's payout fee back.
 */
async function recordTransferFee(db, payment, transfer) {
  const fee = Number(payment.amount_cents) - Number(transfer.amount);
  if (fee > 0) await rpc(db, "record_payout_fee", { target_payment: payment.id, fee });
}

/**
 * Stripe can no longer be asked to pay this payment, and an earlier call
 * started it. Look: a transfer that went is recorded; if none did, the
 * payment is unpinned so another rail can pay it. A claim still live may be
 * mid-call, so it is left alone.
 */
async function settleStartedRelease({ stripe, db, payment }) {
  if (!payment.stripe_release_started) return null;
  if (payment.release_claimed_at && Date.parse(payment.release_claimed_at) > Date.now() - 10 * 60 * 1000) return null;
  const already = await paymentTransfer(stripe, payment);
  if (already) {
    await recordTransferFee(db, payment, already);
    await rpc(db, "record_payment_released", { target_payment: payment.id, transfer: already.id });
    return { released: true, reason: already.id };
  }
  await rpc(db, "record_stripe_release_not_sent", { target_payment: payment.id, claimed: payment.release_claimed_at });
  return null;
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
  // Late events from the retired account, or verification events for a
  // replacement still onboarding, must never change the active destination.
  const { data: current, error: readError } = await db.from("stripe_connect_accounts")
    .select("stripe_account_id").eq("org_id", orgId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (current && current.stripe_account_id !== account.id) return null;
  const result = current
    ? await db.from("stripe_connect_accounts").update(row).eq("org_id", orgId).eq("stripe_account_id", account.id)
    : await db.from("stripe_connect_accounts").insert(row);
  const { error } = result;
  if (error) throw new Error(error.message);
  return row;
}

/** Answer with a status and a JSON body, the same shape on Vercel and in dev. */
export function reply(response, status, body) {
  response.status(status).json(body);
}
