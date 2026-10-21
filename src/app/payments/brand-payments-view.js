/**
 * The brand's Payments page, in the shape the designed `BillingScreen` draws.
 *
 * Pure. The brand funds each paid step through Stripe by card and TSC holds
 * the money until the brand approves the step, then pays the factory. So the
 * design's figures read:
 *   total paid   payments held or paid out (the orders' paid_cents)
 *   funded       held by TSC now, not yet paid out
 *   remaining    what is still to pay on open orders (outstanding_cents)
 *   next payment the open orders' next payment, soonest due first
 * Every sum comes from production_order_summary except "funded", which is the
 * held payments' own amounts. The list shows what has happened or is owed
 * now: a due payment is listed as "Not paid", dated when it falls due, in the
 * same table as the rest (the design has no separate place for it); a step
 * not reached yet counts only in "remaining". A row's amount is what the brand
 * is charged: the step plus the service fee.
 */
import { feeCents } from "../../lib/domain/payment.js";
import { formatMoney } from "../../lib/money.js";

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

const OPEN = new Set(["pending_schedule", "active"]);
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const sum = (items, pick) => items.reduce((total, item) => total + Number(pick(item) ?? 0), 0);

/** When the payment last moved, which is the date its row shows. */
const movedAt = (payment) => payment.released_at ?? payment.confirmed_at ?? payment.failed_at ?? payment.processing_at
  ?? payment.sent_at ?? payment.due_at ?? payment.created_at;

/** What the brand is (or was) charged: recorded at checkout, else step + fee. */
const charged = (payment) => Number(payment.charged_cents ?? payment.amount_cents + feeCents(payment));

/**
 * orders: the brand's production_order_summary rows (listOrders), payments:
 * listPaymentsForOrders() for those orders.
 */
export function brandPaymentsView({ orders, payments }) {
  const byOrder = new Map(orders.map((order) => [order.id, order]));
  const open = orders.filter((order) => OPEN.has(order.status));
  const next = open
    .filter((order) => order.next_payment_cents)
    .sort((a, b) => String(a.next_payment_due_on ?? "9999").localeCompare(String(b.next_payment_due_on ?? "9999")))[0];

  const rows = payments
    .filter((payment) => PAYMENT_STATUS[payment.state] && byOrder.has(payment.order_id))
    .sort((a, b) => String(movedAt(b)).localeCompare(String(movedAt(a))))
    .map((payment) => {
      const order = byOrder.get(payment.order_id);
      const orderTitle = order.rfqs?.title || order.order_number;
      return {
        id: payment.id,
        orderId: payment.order_id,
        title: payment.order_milestones?.title || "Payment",
        client: order.factory?.name ?? "Factory",
        date: day(payment.state === "due" ? (payment.order_milestones?.due_on ?? payment.due_at ?? movedAt(payment)) : movedAt(payment)),
        meta: `${orderTitle}${payment.state === "failed" && payment.failure_reason ? ` · ${payment.failure_reason}` : ""}`,
        status: payment.state === "due" ? "Not paid" : PAYMENT_STATUS[payment.state],
        state: payment.state,
        amount: formatMoney(charged(payment), payment.currency),
      };
    });

  return {
    metrics: [
      ["total paid", formatMoney(sum(orders, (order) => order.paid_cents))],
      ["funded", formatMoney(sum(payments.filter((payment) => payment.state === "confirmed"), (payment) => payment.amount_cents))],
      ["remaining", formatMoney(sum(open, (order) => order.outstanding_cents))],
      ["next payment", next ? formatMoney(next.next_payment_cents, next.currency) : "—", "highlight"],
    ],
    rows,
    vendors: [...new Set(rows.map((row) => row.client))],
  };
}
