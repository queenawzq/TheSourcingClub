/**
 * Production orders.
 *
 * One row, two parties. That is why there is a single set of screens for both
 * sides rather than a brand copy and a factory copy — the two prototypes each
 * built their own and promptly disagreed about what step two is called.
 *
 * The wording each side reads is derived HERE and nowhere else. Nothing in the
 * database stores a label: the same stored state renders as "Needs your
 * approval" to a brand and "With the brand for approval" to a factory, and a
 * component that reaches past these functions for a raw status is how the two
 * sides drift apart again.
 */
import { supabase, unwrap } from "../supabase.js";

// Everything the header and the list cards need, already summed in SQL.
// JavaScript never adds money up here: capacity_monthly_units() has four
// copies across the prototypes and one of them overstates a sweater factory
// by 2.3x, which is the whole argument for the view.
const SUMMARY_COLUMNS = `
  id, order_number, rfq_id, quote_id, brand_org_id, factory_org_id, status,
  unit_price_cents, production_quantity, bulk_subtotal_cents, sample_subtotal_cents,
  order_total_cents, currency, bulk_lead_time_days, deposit_pct, balance_pct,
  incoterm_id, payment_term_id, capacity_window_start, capacity_window_end,
  agreed_scope, schedule_revision,
  schedule_brand_agreed_at, schedule_factory_agreed_at,
  cancel_proposed_by_org, cancel_proposed_at, cancel_reason,
  activated_at, completed_at, cancelled_at, created_at,
  total_cents, paid_cents, outstanding_cents,
  next_payment_cents, next_payment_due_on,
  current_milestone_id, current_milestone_title,
  awaiting_brand, awaiting_factory
`;

export async function listOrders(orgId) {
  return unwrap(
    await supabase
      .from("production_order_summary")
      // The steps ride along so each card can draw its own rail rather than
      // the design's fixed five, and `brief` so the card's description line
      // has something in it.
      .select(`${SUMMARY_COLUMNS}, rfqs (title, brief), brand:brand_org_id (name), factory:factory_org_id (name), order_milestones (id, title, sort, state, due_on, amount_cents, order_payments (state, due_at))`)
      // RLS already scopes this, but a person can belong to both a brand and a
      // factory org, and the question being asked is about the ACTIVE one.
      .or(`brand_org_id.eq.${orgId},factory_org_id.eq.${orgId}`)
      .order("created_at", { ascending: false }),
    "load your production orders",
  );
}

export async function getOrder(orderId) {
  return unwrap(
    await supabase
      .from("production_order_summary")
      .select(`${SUMMARY_COLUMNS}, rfqs (title, brief), brand:brand_org_id (name), factory:factory_org_id (name, factory_profiles (location, country_code))`)
      .eq("id", orderId)
      .maybeSingle(),
    "load the order",
  );
}

export async function agreeSchedule(orderId, revision) {
  return unwrap(
    await supabase.rpc("agree_schedule", { target_order: orderId, revision }),
    "agree the schedule",
  );
}

/**
 * What has happened on an order, newest first: `{ at, kind, actor_org_id,
 * milestone_title, detail }`. Read through each table's own RLS (the function
 * is security invoker), so it shows a party nothing it could not already read.
 */
export async function orderActivity(orderId) {
  return unwrap(
    await supabase.rpc("order_activity", { target_order: orderId }),
    "load the order's activity",
  );
}

export async function proposeCancellation(orderId, reason) {
  return unwrap(
    await supabase.rpc("propose_cancellation", { target_order: orderId, reason }),
    "propose cancelling this order",
  );
}

export async function acceptCancellation(orderId) {
  return unwrap(
    await supabase.rpc("accept_cancellation", { target_order: orderId }),
    "accept the cancellation",
  );
}

/** The side that proposed cancelling takes it back (migration 070). */
export async function withdrawCancellation(orderId) {
  return unwrap(
    await supabase.rpc("withdraw_cancellation", { target_order: orderId }),
    "withdraw the cancellation",
  );
}

/** The other side keeps the order (migration 070). */
export async function declineCancellation(orderId) {
  return unwrap(
    await supabase.rpc("decline_cancellation", { target_order: orderId }),
    "keep the order",
  );
}

/* ------------------------------------------------------------------------ */
/* Wording                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * `pending_schedule` is why this is a function and not a lookup table: what
 * the viewer should read depends on which side it is. Only the brand sets the
 * production steps, and its confirmation starts the order.
 */
export function orderStatusLabel(order, { isFactory }) {
  if (!order) return "";

  switch (order.status) {
    case "pending_schedule":
      return isFactory ? "Brand is setting the steps" : "Set the production steps";
    case "active":
      return "In production";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return order.status;
  }
}

const MILESTONE_LABELS = {
  pending:   { brand: "Not started",         factory: "Not started" },
  active:    { brand: "Factory working",     factory: "Yours to do" },
  submitted: { brand: "Needs your approval", factory: "With the brand for approval" },
  approved:  { brand: "Approved",            factory: "Approved by the brand" },
  complete:  { brand: "Done",                factory: "Done" },
  cancelled: { brand: "Cancelled",           factory: "Cancelled" },
};

export function milestoneStatusLabel(state, { isFactory }) {
  const pair = MILESTONE_LABELS[state];
  if (!pair) return state;
  return isFactory ? pair.factory : pair.brand;
}

/**
 * Where a step's money is. TSC holds a funded payment (`confirmed`) until the
 * brand approves the step, then pays the factory (`released`). `sent` is only
 * a bank-wire claim made on the old site, which staff still confirm by hand.
 */
const PAYMENT_LABELS = {
  not_due:    { brand: "Not yet due",             factory: "Not yet due" },
  due:        { brand: "Awaiting funding",        factory: "Awaiting funding from the brand" },
  processing: { brand: "Bank payment clearing",   factory: "Bank payment clearing — don't start yet" },
  failed:     { brand: "Payment failed",          factory: "The brand's payment failed" },
  sent:       { brand: "You marked this sent — we're confirming receipt",
                factory: "The brand says it is sent — awaiting our confirmation" },
  confirmed:  { brand: "Funded: held by TSC",     factory: "Funded: held by TSC — you can start this step" },
  released:   { brand: "Paid out to the factory", factory: "Paid out to you" },
  cancelled:  { brand: "Cancelled",               factory: "Cancelled" },
};

export function paymentStatusLabel(state, { isFactory }) {
  const pair = PAYMENT_LABELS[state];
  if (!pair) return state;
  return isFactory ? pair.factory : pair.brand;
}

/**
 * ready | warning | neutral, per the design system's signal colours.
 *
 * The colour follows the label, as in the design, where each status has one
 * colour: "In production" is always the same pill. It used to turn orange
 * whenever the brand owed something, so two orders both "In production" wore
 * different colours; what is owed is shown on the step bar instead. Setting
 * the steps is the brand's to do, so it is the one warning.
 */
export function statusTone(order, { isFactory }) {
  if (!order) return "neutral";
  switch (order.status) {
    case "pending_schedule":
      return isFactory ? "neutral" : "warning";
    case "active":
    case "completed":
      return "ready";
    default:
      return "neutral";
  }
}
