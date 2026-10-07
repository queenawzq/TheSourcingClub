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
import { listRfqs } from "../lib/domain/rfq.js";
import { listThreads } from "../lib/domain/message.js";
import { formatMoney, formatRange } from "../lib/money.js";

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
 * what the order actually contains.
 *
 * It is now only the fallback: when the list carries the order's steps, the
 * card draws its rail from them instead (`railSteps` below). Flagged for
 * Queena, as the rail is a design decision.
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
  // Only the brand sets the production steps; its confirmation starts the order.
  if (order.status === "pending_schedule") {
    return isFactory ? "The brand is setting the production steps" : "Set the production steps to begin";
  }
  if (order.status === "cancelled") return order.cancel_reason ?? "Cancelled";
  if (order.status === "completed") return "Every step is done";
  // A payment that is actually due, from the steps when the row carries them.
  // next_payment_cents is the next PAYING step, which may still be weeks off:
  // "$4,284.00 due next" on a final balance that waits on QC read as a bill.
  if (order.order_milestones) {
    const due = order.order_milestones.find((milestone) => {
      const payment = Array.isArray(milestone.order_payments) ? milestone.order_payments[0] : milestone.order_payments;
      return payment?.state === "due";
    });
    if (due) {
      const amount = formatMoney(due.amount_cents, order.currency);
      return isFactory ? `Waiting on ${amount} from the brand` : `${amount} due for ${due.title}`;
    }
  } else if (Number(order.next_payment_cents) > 0 && !isFactory) {
    return `${formatMoney(order.next_payment_cents, order.currency)} due next`;
  }
  return order.current_milestone_title
    ? `Now: ${order.current_milestone_title}`
    : "In production";
}

/**
 * The order's own steps for the card's rail: `[{ id, label, done, current,
 * needsFunding }]`. "Need funding" is the design's label for a first step
 * waiting on the brand's money, so it only ever shows to the brand.
 */
function railSteps(order, isFactory) {
  const payState = (milestone) => {
    const payment = milestone.order_payments;
    return (Array.isArray(payment) ? payment[0] : payment)?.state ?? null;
  };
  return [...(order.order_milestones ?? [])]
    .sort((a, b) => a.sort - b.sort)
    .map((milestone) => {
      const current = milestone.id === order.current_milestone_id;
      return {
        id: milestone.id,
        label: milestone.title,
        done: milestone.state === "complete",
        current,
        needsFunding: current && !isFactory && payState(milestone) === "due",
      };
    });
}

/** A database row in the shape the designed card reads. */
export function toProjectCard(order, isFactory) {
  return {
    id: order.id,
    // The raw state, so a screen can tell an open order from a finished one
    // without parsing the label it shows a human.
    state: order.status,
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
    steps: railSteps(order, isFactory),
    // What the list's search, date range and sort read.
    orderNumber: order.order_number,
    createdAt: order.created_at,
    nextDueOn: order.next_payment_due_on ?? null,
    // The prototype shows a reference photograph on every card. Real orders
    // may have none, and the card renders without it — better than a
    // placeholder that implies an image exists.
    image: null,
  };
}

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/**
 * A request row in the shape the designed card reads.
 *
 * The three metric cells are the interesting part: the prototype hardcodes
 * "3 quotes · 7 invited · 2 message" per mock request. All three are real
 * here — quotes and invitations come back with the row, messages from the
 * request's own conversations.
 *
 * The card destructures exactly three (RfqCard in src/prototype/main.jsx), so
 * handing it two threw and the error boundary ate the whole Quotes screen.
 * Count them, or the screen dies.
 */
export function toRfqCard(rfq, messageCount = 0) {
  const quotes = rfq.quotes?.[0]?.count ?? 0;
  const invited = rfq.rfq_invitations?.[0]?.count ?? 0;

  const posted = rfq.published_at ?? rfq.created_at;
  const due = rfq.quote_deadline
    ? ` · Quote due ${DAY.format(new Date(rfq.quote_deadline))}`
    : "";

  const tags = [
    rfq.quantity_total ? `${rfq.quantity_total.toLocaleString()} units` : null,
    formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents) !== "—"
      ? formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents)
      : null,
    rfq.requires_sample ? "Sample before bulk" : null,
  ].filter(Boolean);

  return {
    id: rfq.id,
    title: rfq.title || "Untitled request",
    date: `${rfq.published_at ? "Posted" : "Started"} ${DAY.format(new Date(posted))}${due}`,
    description: rfq.brief ?? "",
    tags,
    // Real requests may have no reference imagery, and the card renders
    // without it rather than showing a placeholder that implies one exists.
    images: [],
    status: rfq.status === "awarded"
      ? "Awarded"
      : rfq.status === "cancelled"
        ? "Cancelled"
        : quotes > 0
        ? "Ready to compare"
        : rfq.status === "draft"
          ? "Draft"
          : "Waiting for quotes",
    statusTone: rfq.status === "cancelled" ? "neutral" : rfq.status === "awarded" ? "ready" : quotes > 0 ? "ready" : "neutral",
    // Only a draft or an open request can be cancelled (cancel_rfq).
    archivable: rfq.status === "draft" || rfq.status === "open",
    metrics: [
      [String(quotes), quotes === 1 ? "quote" : "quotes"],
      [String(invited), "invited"],
      [String(messageCount), messageCount === 1 ? "message" : "messages"],
    ],
  };
}

export function createLiveAdapter({ org, isFactory, user }) {
  return {
    viewer: { isFactory, org, user },
    orders: async () => (await listOrders(org.id)).map((order) => toProjectCard(order, isFactory)),

    // Split here rather than in the screen: which statuses count as "closed"
    // is a domain question, and the factory side will need the same answer.
    rfqs: async () => {
      // One read for every conversation, then counted per request — the
      // alternative is a query per card.
      const [rows, threads] = await Promise.all([listRfqs(org.id), listThreads(org.id)]);
      const messagesByRfq = new Map();
      for (const thread of threads ?? []) {
        if (!thread.rfq_id) continue;
        messagesByRfq.set(
          thread.rfq_id,
          (messagesByRfq.get(thread.rfq_id) ?? 0) + (Number(thread.message_count) || 0),
        );
      }
      const bucket = (predicate) =>
        rows.filter(predicate).map((row) => toRfqCard(row, messagesByRfq.get(row.id) ?? 0));
      return {
        active: bucket((r) => r.status === "open"),
        drafts: bucket((r) => r.status === "draft"),
        closed: bucket((r) => r.status === "awarded" || r.status === "cancelled"),
      };
    },
  };
}
