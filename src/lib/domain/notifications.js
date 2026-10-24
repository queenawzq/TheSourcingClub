/**
 * Notifications.
 *
 * Written only by security-definer functions and triggers — invitations,
 * quotes sent and withdrawn, awards, cancellations, messages and order steps —
 * so a client can read them and mark them read, nothing more. That is the same
 * shape as credit_ledger, and for the same reason: a notification a user could
 * fabricate is worth nothing.
 */
import { supabase, unwrap } from "../supabase.js";

export async function listNotifications(orgId, { limit = 20 } = {}) {
  return unwrap(
    await supabase
      .from("notifications")
      .select("id, kind, subject_type, subject_id, order_id, title, body, data, read_at, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit),
    "load your notifications",
  );
}

/**
 * How many notifications this org has not read: the figure on the dashboard's
 * bell. Counted in the database, since the list above stops at 20.
 */
export async function countUnreadNotifications(orgId) {
  const result = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("read_at", null);
  unwrap(result, "count your notifications");
  return result.count ?? 0;
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

export { notificationLink } from "../../shared/notification-link.mjs";
export { notificationBody, notificationTitle } from "../../shared/notification-text.mjs";

/**
 * The label the Activity drawer puts on a notification. The design types its
 * examples Quote / File / Status / Vendor; these are the kinds that exist.
 */
export function activityType(kind = "") {
  if (kind.startsWith("quote_")) return "Quote";
  // A held message that staff rejected is still news about a conversation.
  if (kind === "message" || kind === "message_rejected") return "Message";
  if (kind.startsWith("payment_") || kind === "funds_released") return "Payment";
  if (kind.startsWith("verification_")) return "Verification";
  if (kind.startsWith("rfq_")) return "Request";
  return "Status";
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "12 minutes ago", "yesterday", "just now". */
export function timeAgo(iso) {
  const seconds = Math.round((new Date(iso) - Date.now()) / 1000);
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
