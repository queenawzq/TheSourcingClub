import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { emailTransport, sendDueNotificationEmails, serviceClient } from "./_notification-sender.js";

/**
 * Sends the queued notification emails (notification_email_outbox).
 *
 * Nothing here decides WHO gets an email: the database queued one row per
 * member when the notification was written, and only if the company's switch
 * was on. This only delivers what is due, a few at a time, and records what
 * happened. It is safe to call as often as anyone likes: rows are claimed
 * with `skip locked`, and Resend's idempotency key stops a double send.
 *
 * Called by the browser right after its own writes (src/lib/supabase.js), so
 * any signed-in user may ask; and with CRON_SECRET. The sending itself is in
 * _notification-sender.js, shared with the daily job (api/cron-daily).
 */

export default async function handler(request, response) {
  if (request.method !== "POST" && request.method !== "GET") {
    response.status(405).json({ sent: 0, error: "method not allowed" });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  const mail = emailTransport();
  if (!supabaseUrl || !anonKey || !serviceKey || !mail) {
    // Rows stay queued; a configured server sends them later.
    response.status(503).json({ sent: 0, error: "notification email is not configured on the server" });
    return;
  }

  // Vercel's cron calls with GET and `Authorization: Bearer $CRON_SECRET`.
  const authorization = request.headers.authorization ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret) && authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    if (request.method !== "POST" || !authorization.startsWith("Bearer ")) {
      response.status(401).json({ sent: 0, error: "sign in is required" });
      return;
    }
    const caller = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: who, error: whoError } = await caller.auth.getUser(authorization.slice(7));
    if (whoError || !who?.user) {
      response.status(401).json({ sent: 0, error: "sign in is required" });
      return;
    }
  }

  const service = serviceClient(supabaseUrl, serviceKey);
  try {
    const result = await sendDueNotificationEmails(service, request, mail);
    response.status(200).json({ ...result, error: null });
  } catch (error) {
    response.status(500).json({ sent: 0, error: error.message });
  }
}
