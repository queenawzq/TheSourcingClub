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
      .select(`${SUMMARY_COLUMNS}, rfqs (title), brand:brand_org_id (name), factory:factory_org_id (name)`)
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
      .select(`${SUMMARY_COLUMNS}, rfqs (title, brief), brand:brand_org_id (name), factory:factory_org_id (name)`)
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

/* ------------------------------------------------------------------------ */
/* Wording                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * `pending_schedule` is why this is a function and not a lookup table: what
 * the viewer should read depends on whether their own side has already agreed.
 */
export function orderStatusLabel(order, { isFactory }) {
  if (!order) return "";
  const mine = isFactory ? order.schedule_factory_agreed_at : order.schedule_brand_agreed_at;
  const theirs = isFactory ? order.schedule_brand_agreed_at : order.schedule_factory_agreed_at;

  switch (order.status) {
    case "pending_schedule":
      if (!mine) return "Schedule needs your agreement";
      return theirs ? "Starting" : "Waiting on the other side to agree";
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
 * The two rows that carry this whole phase are `sent` and `confirmed`.
 *
 * If "sent" reads as arrival on the factory's screen, the admin confirmation
 * step is theatre and the factory is once again taking the brand's word for
 * it — which is the exact thing it has no reason to do.
 */
const PAYMENT_LABELS = {
  not_due:   { brand: "Not yet due",   factory: "Not yet due" },
  due:       { brand: "Due from you",  factory: "Awaiting the brand's payment" },
  sent:      { brand: "You marked this sent — we're confirming receipt",
               factory: "The brand says it is sent — awaiting our confirmation" },
  confirmed: { brand: "Payment confirmed",
               factory: "Payment confirmed — you can start this step" },
  released:  { brand: "Released to the factory", factory: "Paid out to you" },
  cancelled: { brand: "Cancelled",     factory: "Cancelled" },
};

export function paymentStatusLabel(state, { isFactory }) {
  const pair = PAYMENT_LABELS[state];
  if (!pair) return state;
  return isFactory ? pair.factory : pair.brand;
}

/** ready | warning | neutral, per the design system's signal colours. */
export function statusTone(order, { isFactory }) {
  if (!order) return "neutral";
  if (order.status === "cancelled") return "neutral";
  if (order.status === "completed") return "ready";
  const waiting = isFactory ? order.awaiting_factory : order.awaiting_brand;
  return waiting ? "warning" : "ready";
}
