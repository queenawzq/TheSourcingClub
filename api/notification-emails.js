import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
// Vercel compiles api/*.js as CommonJS; import the ESM email builder lazily.
const loadNotificationEmail = () => import("../scripts/generate-notification-email.mjs");

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
 * any signed-in user may ask; and by the daily cron with CRON_SECRET.
 *
 * Locally, with no Resend key and MAILPIT_URL set, emails go to the local
 * stack's Mailpit instead, so they can be read at http://127.0.0.1:54324.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REPLY_TO = process.env.SUPPORT_EMAIL ?? "operations@contact.sourcing-club.com";
// Resend's free plan allows two requests a second.
const BATCH = 10;
const RESEND_SPACING_MS = 550;

// Addresses that can never receive mail (RFC 2606/6761). Demo companies and
// e2e accounts use them; sending would only spend the daily quota.
const RESERVED = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|[^@]+\.(?:test|example|invalid|localhost))$/i;

function appUrl(request) {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  if (!process.env.VERCEL && request?.headers?.host) return `http://${request.headers.host}`;
  return "https://the-sourcing-club.vercel.app";
}

function transport() {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (resendKey && from) {
    return {
      name: "resend",
      async send(row, message) {
        const delivery = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `notification-${row.id}`,
          },
          body: JSON.stringify({ from, to: [row.recipient_email], reply_to: REPLY_TO, ...message }),
        });
        const payload = await delivery.json().catch(() => ({}));
        if (!delivery.ok) throw new Error(payload.message || `email provider returned ${delivery.status}`);
        return payload.id ?? null;
      },
    };
  }
  const mailpit = process.env.MAILPIT_URL?.trim();
  if (mailpit && !process.env.VERCEL) {
    return {
      name: "mailpit",
      async send(row, message) {
        const delivery = await fetch(`${mailpit.replace(/\/$/, "")}/api/v1/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            From: { Email: "notifications@sourcing-club.test", Name: "The Sourcing Club" },
            To: [{ Email: row.recipient_email, Name: row.recipient_name ?? "" }],
            ReplyTo: [{ Email: REPLY_TO }],
            Subject: message.subject,
            HTML: message.html,
            Text: message.text,
          }),
        });
        const payload = await delivery.json().catch(() => ({}));
        if (!delivery.ok) throw new Error(payload.Error || `Mailpit returned ${delivery.status}`);
        return payload.ID ?? null;
      },
    };
  }
  return null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(request, response) {
  if (request.method !== "POST" && request.method !== "GET") {
    response.status(405).json({ sent: 0, error: "method not allowed" });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  const mail = transport();
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

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rows, error: claimError } = await service.rpc("claim_notification_emails", { max_rows: BATCH });
  if (claimError) {
    response.status(500).json({ sent: 0, error: "the email queue could not be read" });
    return;
  }

  const { notificationEmail } = await loadNotificationEmail();
  const env = {
    appUrl: appUrl(request),
    logoUrl: `${appUrl(request)}/assets/logo.png`,
    supportEmail: REPLY_TO,
    companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
  };

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, row] of (rows ?? []).entries()) {
    if (mail.name === "resend" && RESERVED.test(row.recipient_email)) {
      await service.rpc("skip_notification_email", { outbox_id: row.id, reason: "reserved test address" });
      skipped += 1;
      continue;
    }
    try {
      if (mail.name === "resend" && index > 0) await wait(RESEND_SPACING_MS);
      const providerId = await mail.send(row, notificationEmail(row, env));
      await service.rpc("finish_notification_email", { outbox_id: row.id, delivered: true, provider: providerId, error_text: null });
      sent += 1;
    } catch (error) {
      await service.rpc("finish_notification_email", {
        outbox_id: row.id, delivered: false, provider: null, error_text: String(error.message || error),
      });
      failed += 1;
    }
  }

  response.status(200).json({ sent, skipped, failed, more: (rows?.length ?? 0) === BATCH, error: null });
}
