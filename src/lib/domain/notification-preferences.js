/**
 * The company's email switches (Settings → Notifications).
 *
 * One row per company, read directly; written only through
 * set_notification_preference(), which checks membership. No row means every
 * switch is on, the designed default.
 */
import { supabase, unwrap } from "../supabase.js";

const fromRow = (row) => ({
  rfq: row?.rfq_emails ?? true,
  payments: row?.payment_emails ?? true,
  messages: row?.message_emails ?? true,
  orders: row?.order_emails ?? true,
  calls: row?.call_emails ?? true,
  capacity: row?.capacity_emails ?? true,
});

export async function getNotificationEmails(orgId) {
  return fromRow(unwrap(
    await supabase
      .from("notification_preferences")
      .select("rfq_emails, payment_emails, message_emails, order_emails, call_emails, capacity_emails")
      .eq("org_id", orgId)
      .maybeSingle(),
    "load your email settings",
  ));
}

/** category: "rfq" | "payments" | "orders" | "messages" | "calls" | "capacity" */
export async function setNotificationEmail(orgId, category, enabled) {
  return fromRow(unwrap(
    await supabase.rpc("set_notification_preference", { target_org: orgId, category, enabled }),
    "save that email setting",
  ));
}
