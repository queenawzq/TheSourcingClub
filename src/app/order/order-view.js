/**
 * Wording for the order screen, from real rows. Pure functions: no fetching,
 * no React, so the brand's screen and (later) the factory's designed one say
 * the same thing about the same order.
 *
 * Money comes from the order snapshot and production_order_summary, formatted
 * with formatMoney. Nothing here sums or splits an amount.
 */
import { formatMoney } from "../../lib/money.js";
import { formatCapacityWindow } from "../../lib/domain/quote.js";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const DAY_TIME = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const day = (value) => (value ? DAY.format(new Date(value)) : "");

/** "AM" for "Atelier Minho"; one letter for one word. */
export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("") || "?";
}

/** "2h ago", "yesterday", "Sep 12": how long ago, in the panel's own voice. */
export function relativeTime(value, now = Date.now()) {
  if (!value) return "";
  const minutes = Math.round((now - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  return DAY.format(new Date(value));
}

/** "Today, 9:48 PM" or "Sep 12, 9:48 PM", as the update card draws it. */
export function updateTime(value, now = new Date()) {
  const at = new Date(value);
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : DAY_TIME.format(at);
}

/** Where a company is, as far as the viewer may know. */
export function locationLine(profile) {
  if (!profile) return "";
  // The typed location already names the country ("Porto, Portugal"); the
  // ISO code is only worth showing when nothing was typed.
  return profile.location || profile.hq_location || profile.country_code || "";
}

const PHOTO = /^image\//;

/**
 * The step's latest update, shaped for the designed update card, or null.
 * `urls` maps document id → signed URL, minted by the caller.
 */
export function latestUpdateFor(milestoneId, updates, { urls = {}, onViewAll } = {}) {
  const mine = updates.filter((update) => update.milestone_id === milestoneId);
  if (!mine.length) return null;
  const latest = mine[0];
  const documents = latest.documents ?? [];
  const photos = documents.filter((doc) => PHOTO.test(doc.mime_type ?? "")).slice(0, 3);
  return {
    author: latest.orgs?.name ?? "",
    when: updateTime(latest.created_at),
    body: latest.body,
    photos: photos.map((doc) => ({ id: doc.id, url: urls[doc.id] ?? null, label: doc.file_name })),
    extraFiles: documents.length - photos.length,
    total: mine.length,
    onViewAll,
  };
}

/**
 * Every file on the order: the request's attachments first, then each file
 * posted on a step, newest first. `[{ id, name, meta, document }]`.
 */
export function orderFiles(rfqDocuments, updates, milestones) {
  const titleOf = new Map(milestones.map((milestone) => [milestone.id, milestone.title]));
  const fromRequest = (rfqDocuments ?? []).map((doc) => ({
    id: doc.id,
    name: doc.file_name,
    meta: "Request attachment",
    document: doc,
  }));
  const fromSteps = (updates ?? []).flatMap((update) => (update.documents ?? []).map((doc) => ({
    id: doc.id,
    name: doc.file_name,
    meta: [`${update.orgs?.name ?? ""} on ${titleOf.get(update.milestone_id) ?? "a step"}`, day(update.created_at)]
      .filter(Boolean)
      .join(" · "),
    document: doc,
  })));
  return [...fromRequest, ...fromSteps];
}

/**
 * One sentence per activity row, newest first. The viewer's own company is
 * "You"; the other is named, so the same row reads right on both sides.
 */
export function activityLines(rows, { order, viewerOrgId, now = Date.now(), limit = 5 }) {
  const names = {
    [order.brand_org_id]: order.brand?.name ?? "The brand",
    [order.factory_org_id]: order.factory?.name ?? "The factory",
  };
  const who = (orgId) => (orgId === viewerOrgId ? "You" : names[orgId] ?? "TSC");
  const money = (cents) => (cents ? formatMoney(Number(cents), order.currency) : "");

  const sentence = (row) => {
    const step = row.milestone_title;
    switch (row.kind) {
      case "message": return `Last message ${relativeTime(row.at, now)}`;
      case "update_posted": return `${who(row.actor_org_id)} posted on ${step}`;
      case "step_submitted": return `${who(row.actor_org_id)} sent ${step} for approval`;
      case "step_approved": return `${who(row.actor_org_id)} approved ${step}`;
      case "step_completed": return `${step} is complete`;
      case "payment_due": return `${money(row.detail)} is due for ${step}`;
      case "payment_sent": return `${who(row.actor_org_id)} marked ${money(row.detail)} sent for ${step}`;
      case "payment_confirmed": return `TSC confirmed ${money(row.detail)} for ${step}`;
      case "payment_released": return `TSC released ${money(row.detail)} for ${step}`;
      case "schedule_agreed": return `${who(row.actor_org_id)} agreed the schedule`;
      case "order_activated": return "Production started";
      case "cancellation_proposed": return `${who(row.actor_org_id)} proposed cancelling`;
      case "order_completed": return "Order completed";
      case "order_cancelled": return "Order cancelled";
      case "order_created": return `Order ${row.detail ?? ""} created`.replace(/\s+/g, " ").trim();
      default: return null;
    }
  };

  return (rows ?? [])
    .map((row) => {
      const text = sentence(row);
      if (!text) return null;
      // "Last message …" already says when; the rest get a short time stamp.
      return row.kind === "message" ? text : `${text} · ${relativeTime(row.at, now)}`;
    })
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * The Contract tab, from the order's snapshot: what was agreed at award and
 * cannot change. Shaped as the designed panel's four sections.
 */
export function describeOrderContract({ order, milestones, incoterm, paymentTerm, factoryLine, attachments }) {
  const money = (cents) => (cents == null ? "—" : formatMoney(cents, order.currency));
  const title = order.rfqs?.title || order.order_number;
  const approvals = milestones
    .filter((milestone) => milestone.kind === "approval_and_payment" || milestone.kind === "approval_only")
    .map((milestone) => milestone.title);
  const capacity = formatCapacityWindow(order);

  return {
    workDetails: [
      ["Contract title", title],
      ["Scope of work", order.agreed_scope || order.rfqs?.brief || "As described in the request."],
      ["Approvals, revisions, and delivery", approvals.length
        ? `The brand signs off ${approvals.join(", ")} before the next step opens.`
        : "No step needs the brand's sign-off."],
    ],
    acceptedQuote: [
      ["Factory", factoryLine],
      ["Unit price", money(order.unit_price_cents)],
      ["Quantity", `${Number(order.production_quantity).toLocaleString("en")} units`],
      ["Samples", order.sample_subtotal_cents ? money(order.sample_subtotal_cents) : "None"],
      ["Bulk lead", order.bulk_lead_time_days ? `${order.bulk_lead_time_days} days` : "—"],
      ...(capacity ? [["Capacity", capacity]] : []),
      ["Terms", `${order.deposit_pct}/${order.balance_pct}`],
      ["Quote total", money(order.order_total_cents)],
    ],
    paymentTerms: [
      ["Payment split", paymentTerm || `${order.deposit_pct}% deposit · ${order.balance_pct}% balance`],
      ["Sample payment", order.sample_subtotal_cents ? `Samples quoted at ${money(order.sample_subtotal_cents)}` : "No paid samples"],
      ["Milestone release", "A paid step becomes due once the brand approves it, or when it opens if it needs no approval."],
      ["Release rule", "The next step opens once TSC confirms the payment has arrived."],
      ["Shipping / incoterms", incoterm || "Not stated in the quote"],
    ],
    attachments: (attachments ?? []).map((doc) => doc.file_name),
  };
}
