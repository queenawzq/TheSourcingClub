/**
 * Notifications.
 *
 * Written only by security-definer functions — award_quote is the sole writer
 * today — so a client can read them and mark them read, nothing more. That is
 * the same shape as credit_ledger, and for the same reason: a notification a
 * user could fabricate is worth nothing.
 */
import { supabase, unwrap } from "../supabase.js";

export async function listNotifications(orgId, { limit = 20 } = {}) {
  return unwrap(
    await supabase
      .from("notifications")
      .select("id, kind, subject_type, subject_id, order_id, title, body, read_at, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "load your notifications",
  );
}

export async function markRead(notificationId) {
  return unwrap(
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .select()
      .single(),
    "mark that as read",
  );
}

export async function markAllRead(orgId) {
  return unwrap(
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .is("read_at", null)
      .select("id"),
    "mark everything as read",
  );
}

/**
 * Where a notification should take you.
 *
 * Kept here rather than in the component so both dashboards agree, and so a
 * new notification kind has one obvious place to be handled.
 */
export function notificationLink(notification, { isFactory }) {
  const { subject_type: type, subject_id: id } = notification;
  if (!id) return null;

  // A request lives at a different address for each side; an order does not —
  // it is one row with two parties, and the same link has to open for both.
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

  return null;
}
