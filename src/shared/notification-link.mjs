/**
 * Where a notification opens in the app, for the bell and for its email.
 * api/ keeps its own copy (scripts/generate-notification-email.mjs), because
 * Vercel builds api/ on its own; the smoke test checks the two agree.
 */
export function notificationLink(notification, { isFactory }) {
  const { subject_type: type, subject_id: id } = notification;
  if (!id) return null;

  // A request lives at a different address for each side; an order does not —
  // it is one row with two parties, and the same link has to open for both.
  // A quote arriving or leaving is news about the comparison, so the brand
  // lands on it rather than on the request.
  if (type === "rfq" && !isFactory && ["quote_received", "quote_withdrawn"].includes(notification.kind)) {
    return `/rfqs/${id}/quotes`;
  }
  if (type === "rfq") return isFactory ? `/browse/${id}` : `/rfqs/${id}`;
  if (type === "order") return `/orders/${id}`;

  // Milestones and payments carry their order id alongside the subject, since
  // neither is addressable without it.
  if (type === "milestone" && notification.order_id) {
    return `/orders/${notification.order_id}/milestones/${id}`;
  }
  if (type === "payment" && notification.order_id) {
    return `/orders/${notification.order_id}/payments/${id}`;
  }
  if (type === "thread") return `/messages/${id}`;

  // Capacity is updated from the factory's dashboard.
  if (type === "capacity" && isFactory) return "/";

  // Credits are on the factory's Payments page.
  if (type === "credits" && isFactory) return "/payout?tab=credits";

  return null;
}
