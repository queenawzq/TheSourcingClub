/**
 * The brand's Payments page, in the shape the designed `BillingScreen` draws.
 *
 * Pure. The brand funds each paid step through Stripe by card and TSC holds
 * the money until the brand approves the step, then pays the factory. Every
 * figure is what the brand pays, the service fee included (chargedCents), the
 * same as each row and the Fund screen:
 *   Paid         paid out to the factory
 *   Held         held by TSC now, not yet paid out
 *   Due now      due or failed on open orders, as the dashboard's figure
 *   Remaining    what is still to pay on open orders
 * The figures follow the vendor filter, as the factory's earnings figures
 * follow its client filter. "remaining" and "next payment" read the same
 * payments production_order_summary does (outstanding_cents, the next
 * payment), with the fee added. An order whose steps are not agreed has no
 * payments yet, so its paying steps count at the fee its payments will get.
 * The list shows what has happened or is owed now: what is owed comes first,
 * soonest due first, then the rest newest first. A step not reached yet counts
 * only in "Remaining".
 */
import { plainCardReason } from "../../shared/card-words.mjs";
import { chargedCents, orderFeeBps } from "../../lib/domain/payment.js";
import { formatMoney } from "../../lib/money.js";
import { dateFrom } from "../../lib/dates.js";
import { refundPendingWord } from "../order/payment-summary.mjs";

/**
 * One word for where a payment stands, on the list and its details page. A
 * paid step the brand has approved reads Approved until it is paid; a deposit
 * or balance has nothing to approve, so it stays Funded.
 */
export function paymentStatusWord(payment, order) {
  // Held money that went back when the order was cancelled.
  if (payment.state === "cancelled" && payment.refunded_at) return "Refunded";
  if (refundPendingWord(payment, order)) return refundPendingWord(payment, order);
  if (payment.state === "confirmed" && payment.release_requested_at && payment.order_milestones?.kind !== "payment_only") return "Approved";
  return PAYMENT_STATUS[payment.state];
}

/** The design's status word for each payment state that is listed. */
export const PAYMENT_STATUS = {
  due: "Due",
  failed: "Failed",
  processing: "Payment processing",
  // A bank-wire claim made before payments moved to Stripe.
  sent: "Sent",
  confirmed: "Funded",
  released: "Paid",
};

/** The vendor filter's "everything" option, as BillingScreen names it. */
export const ALL_VENDORS = "All vendors";

const OPEN = new Set(["pending_schedule", "active"]);
// Not held yet: production_order_summary counts these as outstanding.
const UNPAID = new Set(["not_due", "due", "sent", "processing", "failed"]);
const OWED = new Set(["due", "failed"]);
// A due row is dated by its step's due_on (a calendar day), the rest by when
// the payment moved (an instant).
const day = (value) => dateFrom(value)?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) ?? "";
const sum = (items, pick) => items.reduce((total, item) => total + Number(pick(item) ?? 0), 0);
const dueOn = (payment) => String(payment.order_milestones?.due_on ?? "9999");

/** When the payment last moved, which is the date its row shows. */
const movedAt = (payment) => payment.refunded_at ?? payment.released_at ?? payment.confirmed_at ?? payment.failed_at ?? payment.processing_at
  ?? payment.sent_at ?? payment.due_at ?? payment.created_at;

/**
 * orders: the brand's production_order_summary rows (listOrders), payments:
 * listPaymentsForOrders() for those orders, vendor: the filter's choice.
 */
export function brandPaymentsView({ orders, payments, vendor = ALL_VENDORS }) {
  const byOrder = new Map(orders.map((order) => [order.id, order]));
  const vendorOf = (order) => order.factory?.name ?? "Factory";
  const listed = payments.filter((payment) => byOrder.has(payment.order_id));

  const rows = listed
    .filter((payment) => paymentStatusWord(payment, byOrder.get(payment.order_id)))
    .sort((a, b) => {
      const owed = Number(OWED.has(b.state)) - Number(OWED.has(a.state));
      if (owed) return owed;
      return OWED.has(a.state) ? dueOn(a).localeCompare(dueOn(b)) : String(movedAt(b)).localeCompare(String(movedAt(a)));
    })
    .map((payment) => {
      const order = byOrder.get(payment.order_id);
      const orderTitle = order.rfqs?.title || order.order_number;
      return {
        id: payment.id,
        orderId: payment.order_id,
        title: payment.order_milestones?.title || "Payment",
        client: vendorOf(order),
        date: day(payment.state === "due" ? (payment.order_milestones?.due_on ?? payment.due_at ?? movedAt(payment)) : movedAt(payment)),
        meta: `${orderTitle}${payment.state === "failed" && payment.failure_reason ? ` · ${plainCardReason(payment.failure_reason)}` : ""}`,
        status: paymentStatusWord(payment, order),
        state: payment.state,
        amount: formatMoney(chargedCents(payment), payment.currency),
      };
    });
  const vendors = [...new Set(rows.map((row) => row.client))];

  // The filter BillingScreen applies to the rows, applied to the figures.
  const inScope = (order) => !vendors.includes(vendor) || vendorOf(order) === vendor;
  const scoped = listed.filter((payment) => inScope(byOrder.get(payment.order_id)));
  const open = orders.filter((order) => OPEN.has(order.status) && inScope(order));
  const openIds = new Set(open.map((order) => order.id));
  const unpaid = scoped.filter((payment) => openIds.has(payment.order_id) && UNPAID.has(payment.state));
  const scheduled = new Set(listed.map((payment) => payment.order_id));

  const unscheduled = open.filter((order) => !scheduled.has(order.id));
  // Each paying step of an unscheduled order becomes one payment, charged
  // like any other at the rate its first payment will get.
  const remaining = sum(unpaid, chargedCents) + sum(unscheduled, (order) => sum(
    (order.order_milestones ?? []).filter((step) => Number(step.amount_cents) > 0),
    (step) => chargedCents({ amount_cents: Number(step.amount_cents), fee_bps: orderFeeBps(order) }),
  ));

  return {
    metrics: [
      ["Paid", formatMoney(sum(scoped.filter((payment) => payment.state === "released"), chargedCents))],
      ["Held", formatMoney(sum(scoped.filter((payment) => payment.state === "confirmed"), chargedCents))],
      ["Due now", formatMoney(sum(unpaid.filter((payment) => OWED.has(payment.state)), chargedCents)), "highlight"],
      ["Remaining", formatMoney(remaining)],
    ],
    rows,
    vendors,
  };
}
