/**
 * The live half of the data seam.
 *
 * Maps what the database returns onto the shape the designed screens expect.
 * That mapping is not glue — it is where the two sides' vocabularies are
 * reconciled, and it belongs in one file rather than smeared across screens.
 *
 * Every function here returns a promise, which is what tells the provider to
 * show a loading state. The mock adapter returns values synchronously and so
 * never does.
 */
import { listOrders, orderStatusLabel, statusTone } from "../lib/domain/order.js";
import { formatMoney } from "../lib/money.js";

const MONTH_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/**
 * The five-step rail is fixed in the design — "1st step funded", "Fit sample",
 * "Fit / lab dip", "Production", "Shipped" — while a real order's schedule is
 * derived from the accepted quote and can have any steps at all. There is no
 * honest one-to-one mapping.
 *
 * Rather than invent one, this reports how far through its OWN schedule the
 * order is, scaled onto the five positions. It is right at both ends and
 * approximate in between, and the rail's middle labels will not always match
 * what the order actually contains. Flagged for Queena: either the rail
 * becomes derived from the schedule, or the schedule gets a fixed spine.
 */
function progressPosition(order) {
  if (order.status === "pending_schedule") return 1;
  if (order.status === "completed") return 5;
  const total = Number(order.total_cents) || 0;
  const paid = Number(order.paid_cents) || 0;
  if (!total) return 2;
  return Math.min(5, Math.max(2, 1 + Math.ceil((paid / total) * 4)));
}

/** What the other side is called, from the viewer's point of view. */
function counterparty(order, isFactory) {
  return (isFactory ? order.brand?.name : order.factory?.name) ?? "—";
}

/**
 * One sentence saying what is actually outstanding. The prototype's
 * `statusDetail` is a hardcoded string per mock order; here it is derived, so
 * it cannot describe a state the order is not in.
 */
function statusDetail(order, isFactory) {
  if (order.status === "pending_schedule") {
    const mine = isFactory ? order.schedule_factory_agreed_at : order.schedule_brand_agreed_at;
    return mine ? "Waiting on the other side to agree the schedule" : "Agree the schedule to begin";
  }
  if (order.status === "cancelled") return order.cancel_reason ?? "Cancelled";
  if (order.status === "completed") return "Every step is done";
  if (Number(order.next_payment_cents) > 0 && !isFactory) {
    return `${formatMoney(order.next_payment_cents, order.currency)} due next`;
  }
  return order.current_milestone_title
    ? `Now: ${order.current_milestone_title}`
    : "In production";
}

/** A database row in the shape the designed card reads. */
export function toProjectCard(order, isFactory) {
  return {
    id: order.id,
    title: order.rfqs?.title ?? order.order_number,
    factory: counterparty(order, isFactory),
    location: order.order_number,
    started: order.activated_at
      ? `Started ${MONTH_DAY.format(new Date(order.activated_at))}`
      : `Awarded ${MONTH_DAY.format(new Date(order.created_at))}`,
    description: order.rfqs?.brief ?? "",
    status: orderStatusLabel(order, { isFactory }),
    statusTone: statusTone(order, { isFactory }),
    statusDetail: statusDetail(order, isFactory),
    currentStep: order.current_milestone_title ?? "—",
    nextDue: order.next_payment_due_on
      ? MONTH_DAY.format(new Date(order.next_payment_due_on))
      : "—",
    progress: progressPosition(order),
    // The prototype shows a reference photograph on every card. Real orders
    // may have none, and the card renders without it — better than a
    // placeholder that implies an image exists.
    image: null,
  };
}

export function createLiveAdapter({ org, isFactory, user }) {
  return {
    viewer: { isFactory, org, user },
    orders: async () => (await listOrders(org.id)).map((order) => toProjectCard(order, isFactory)),
  };
}
