/**
 * The brand's Payments page, in the shape the designed `BillingScreen` draws.
 *
 * Pure. The brand funds each paid step through Stripe by card and TSC holds
 * the money until the brand approves the step, then pays the factory. Every
 * figure is what the brand pays, the fees included (chargedCents), less
 * anything that went back to it, the same as each row and the Fund screen:
 *   Paid         paid out to the factory
 *   Held         held by TSC now, not yet paid out (approved money stays
 *                with TSC until the factory withdraws it)
 *   Due now      due or failed on open orders, as the dashboard's figure
 *   Remaining    what is still to pay on open orders
 * The figures follow the vendor filter, as the factory's earnings figures
 * follow its client filter. "remaining" and "next payment" read the same
 * payments production_order_summary does (outstanding_cents, the next
 * payment), with the fees added. An order whose steps are not agreed has no
 * payments yet, so its paying steps count at what order_step_charges says
 * they will charge (the database knows the rates; JavaScript does not).
 * The list shows what has happened or is owed now: what is owed comes first,
 * soonest due first, then the rest newest first. A step not reached yet counts
 * only in "Remaining".
 */
import { plainCardReason } from "../../shared/card-words.mjs";
import { chargedCents } from "../../lib/domain/payment.js";
import { formatMoney } from "../../lib/money.js";
import { dateFrom } from "../../lib/dates.js";
import { paymentRefund, refundPendingWord } from "../order/payment-summary.mjs";

/**
 * One word for where a payment stands, on the list and its details page. A
 * paid step the brand has approved reads Approved until it is paid; a deposit
 * or balance has nothing to approve, so it stays Funded.
 */
export function paymentStatusWord(payment, order) {
  // A held payment staff refunded in full goes back to be funded again: its
  // refund is a row of its own, and the payment reads Due, never Failed.
  if (refundedInFull(payment)) return PAYMENT_STATUS.due;
  // Held money that went back when the order was cancelled.
  if (payment.state === "cancelled" && payment.refunded_at) return "Refunded";
  // All of it went back after it was the factory's (refunded by TSC, or the
  // brand's bank reversed it): the step stays done, nothing to pay again.
  if (["confirmed", "released"].includes(payment.state) && paymentRefund(payment).full) {
    return paymentRefund(payment).refunded > 0 ? "Refunded" : "Reversed by your bank";
  }
  if (refundPendingWord(payment, order)) return refundPendingWord(payment, order);
  // Disputed with the brand's bank: not held for the step while the bank decides.
  if (payment.state === "confirmed" && payment.disputed_at) return "Disputed";
  if (payment.state === "confirmed" && payment.release_requested_at && payment.order_milestones?.kind !== "payment_only") return "Approved";
  return PAYMENT_STATUS[payment.state];
}

/**
 * A payment set back after a full refund, recorded the old way (failed, with
 * the refund in failure_reason): §13 sets it back to due instead. Known only
 * from the refunds read (brand_payment_refunds) on the payment's own row.
 */
export const refundedInFull = (payment) => payment?.state === "failed" && Boolean(payment.refunded_at)
  && (payment.refunds ?? []).some((refund) => String(refund.refunded_at) >= String(payment.failed_at ?? payment.refunded_at).slice(0, 19));

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
/** What the brand paid for a funded step, less what went back to it (a refund, a lost dispute). */
const netCharged = (payment) => Math.max(0, chargedCents(payment) - (["confirmed", "released"].includes(payment.state) ? paymentRefund(payment).brand : 0));
const dueOn = (payment) => String(payment.order_milestones?.due_on ?? "9999");

/** When the payment last moved, which is the date its row shows. */
const movedAt = (payment) => payment.refunded_at ?? payment.released_at ?? payment.confirmed_at ?? payment.failed_at ?? payment.processing_at
  ?? payment.sent_at ?? payment.due_at ?? payment.created_at;

/**
 * orders: the brand's production_order_summary rows (listOrders), payments:
 * listPaymentsForOrders() for those orders, stepCharges: listStepCharges()
 * for them, vendor: the filter's choice.
 */
export function brandPaymentsView({ orders, payments, stepCharges = [], refunds = [], vendor = ALL_VENDORS, nameOf = (order) => order.factory?.name }) {
  const byOrder = new Map(orders.map((order) => [order.id, order]));
  // `nameOf`: the vendor's name as the brand reads it (English where it has one).
  const vendorOf = (order) => nameOf(order) ?? "Factory";
  const refundsOf = (id) => refunds.filter((refund) => refund.payment_id === id);
  const listed = payments.filter((payment) => byOrder.has(payment.order_id))
    .map((payment) => (refundsOf(payment.id).length ? { ...payment, refunds: refundsOf(payment.id) } : payment));

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
        meta: `${orderTitle}${payment.state === "failed" && payment.failure_reason && !refundedInFull(payment) ? ` · ${plainCardReason(payment.failure_reason)}` : ""}`,
        status: paymentStatusWord(payment, order),
        state: payment.state,
        amount: formatMoney(netCharged(payment), payment.currency),
      };
    });
  // Each refund that went through is its own row (brand_payment_refunds), by
  // its own date, among the rest: the payment's row keeps what it still holds.
  const refundRows = refunds
    .filter((refund) => byOrder.has(refund.order_id))
    .map((refund) => {
      const order = byOrder.get(refund.order_id);
      return {
        id: `refund-${refund.id ?? `${refund.payment_id}-${refund.refunded_at}`}`,
        paymentId: refund.payment_id,
        orderId: refund.order_id,
        title: refund.step_title || "Payment",
        client: vendorOf(order),
        date: day(refund.refunded_at),
        meta: order.rfqs?.title || order.order_number,
        status: "Refunded",
        state: "refunded",
        refund: true,
        at: refund.refunded_at,
        amount: formatMoney(Number(refund.amount_cents) || 0, refund.currency),
      };
    });
  if (refundRows.length) {
    const owedCount = rows.filter((row) => OWED.has(row.state)).length;
    const rest = [...rows.slice(owedCount).map((row) => ({ row, at: movedAt(listed.find((payment) => payment.id === row.id) ?? {}) })),
      ...refundRows.map((row) => ({ row, at: row.at }))]
      .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))
      .map(({ row }) => row);
    rows.splice(owedCount, rows.length - owedCount, ...rest);
  }
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
  // like any other at the rates its first payment will get.
  const unscheduledIds = new Set(unscheduled.map((order) => order.id));
  const remaining = sum(unpaid, chargedCents)
    + sum(stepCharges.filter((step) => unscheduledIds.has(step.order_id)), (step) => step.charged_cents);

  return {
    metrics: [
      ["Paid", formatMoney(sum(scoped.filter((payment) => payment.state === "released"), netCharged))],
      ["Held", formatMoney(sum(scoped.filter((payment) => payment.state === "confirmed"), netCharged))],
      ["Due now", formatMoney(sum(unpaid.filter((payment) => OWED.has(payment.state)), chargedCents)), "highlight"],
      ["Remaining", formatMoney(remaining)],
    ],
    rows,
    vendors,
  };
}
