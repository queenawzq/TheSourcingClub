import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { emailTransport, sendDueNotificationEmails, serviceClient } from "./_notification-sender.js";

/**
 * The daily job: capacity reminders and steps due soon
 * (run_daily_notifications), then every email still queued.
 *
 * Vercel's cron calls it once a day (vercel.json) with GET and
 * `Authorization: Bearer $CRON_SECRET`. Test sites have no crons, so platform
 * staff can also run it from Admin → Settings ("Run daily jobs now") with a
 * POST carrying their own session. Running it twice sends nothing twice:
 * notification_reminders records every reminder that went out.
 */

// Leaves room under Vercel's function time limit.
const DRAIN_BUDGET_MS = 40_000;

async function isStaff(authorization, supabaseUrl, anonKey) {
  if (!authorization.startsWith("Bearer ")) return false;
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await caller.rpc("is_platform_admin");
  return !error && data === true;
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ error: "method not allowed" });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) {
    response.status(503).json({ error: "the daily job is not configured on the server" });
    return;
  }

  const authorization = request.headers.authorization ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron = request.method === "GET" && Boolean(cronSecret) && authorization === `Bearer ${cronSecret}`;
  if (!isCron && !(request.method === "POST" && (await isStaff(authorization, supabaseUrl, anonKey)))) {
    response.status(401).json({ error: "platform staff access is required" });
    return;
  }

  const service = serviceClient(supabaseUrl, serviceKey);
  const { data: reminders, error: runError } = await service.rpc("run_daily_notifications");
  if (runError) {
    response.status(500).json({ error: "the daily reminders could not be written" });
    return;
  }

  // Reminders are written either way; without a provider they wait queued.
  const emails = { sent: 0, skipped: 0, failed: 0, more: false, configured: false };
  const mail = emailTransport();
  if (mail) {
    emails.configured = true;
    const started = Date.now();
    try {
      do {
        const batch = await sendDueNotificationEmails(service, request, mail);
        emails.sent += batch.sent;
        emails.skipped += batch.skipped;
        emails.failed += batch.failed;
        emails.more = batch.more;
      } while (emails.more && Date.now() - started < DRAIN_BUDGET_MS);
    } catch (error) {
      response.status(500).json({ reminders, emails, error: error.message });
      return;
    }
  }

  response.status(200).json({ reminders, emails, error: null });
}
