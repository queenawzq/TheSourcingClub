/**
 * The brand's Payments page, in the shape the designed `BillingScreen` draws.
 *
 * Pure. Payments are track-only: the brand wires money off-platform, marks it
 * sent, TSC confirms it arrived (the order page calls that "Funded") and later
 * releases it to the factory. So the design's figures read:
 *   total paid   payments TSC confirmed or released (the orders' paid_cents)
 *   funded       confirmed and not yet released
 *   remaining    what is still to pay on open orders (outstanding_cents)
 *   next payment the open orders' next payment, soonest due first
 * Every sum comes from production_order_summary except "funded", which is the
 * confirmed payments' own amounts. The list shows what has happened or is
 * owed now; a step not reached yet counts only in "remaining".
 */
import { formatMoney } from "../../lib/money.js";

/** The design's status word for each payment state that is listed. */
export const PAYMENT_STATUS = {
  due: "Due",
  sent: "Sent",
  confirmed: "Funded",
  released: "Paid",
};

const OPEN = new Set(["pending_schedule", "active"]);
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const sum = (items, pick) => items.reduce((total, item) => total + Number(pick(item) ?? 0), 0);

/** When the payment last moved, which is the date its row shows. */
const movedAt = (payment) => payment.released_at ?? payment.confirmed_at ?? payment.sent_at ?? payment.due_at ?? payment.created_at;

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
        meta: `${orderTitle} - ${payment.state === "due" && payment.order_milestones?.due_on ? `due ${day(payment.order_milestones.due_on)}` : day(movedAt(payment))}`,
        status: PAYMENT_STATUS[payment.state],
        state: payment.state,
        amount: formatMoney(payment.amount_cents, payment.currency),
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
