import { createClient } from "@supabase/supabase-js";
// Vercel compiles api/*.js as CommonJS; import the ESM email builder lazily.
const loadNotificationEmail = () => import("../scripts/generate-notification-email.mjs");

/**
 * Delivers what is due in notification_email_outbox, a batch at a time. Shared
 * by api/notification-emails (the browser's kick) and api/cron-daily (the
 * daily job). Nothing here decides who gets an email; see the migration.
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

/** The app's public address for links in an email. */
export function publicAppUrl(request) {
  return appUrl(request);
}

/**
 * Sends one email that is not a notification (an invite). Same transport and
 * the same rule for reserved test addresses as the queue.
 * @returns {{ sent: boolean, reason?: string, providerId?: string }}
 */
export async function sendOneEmail({ key, to, message }, mail = transport()) {
  if (!mail) return { sent: false, reason: "email is not set up on this server" };
  if (mail.name === "resend" && RESERVED.test(to)) return { sent: false, reason: "reserved test address" };
  const providerId = await mail.send({ id: key, recipient_email: to, recipient_name: null }, message);
  return { sent: true, providerId };
}

/** Whether this server can send at all (a provider, or Mailpit locally). */
export function emailTransport() {
  return transport();
}

/**
 * Claims one batch and sends it.
 * @returns {{ sent, skipped, failed, more }} or throws when the queue can't be read
 */
export async function sendDueNotificationEmails(service, request, mail = transport()) {
  const { data: rows, error: claimError } = await service.rpc("claim_notification_emails", { max_rows: BATCH });
  if (claimError) throw new Error("the email queue could not be read");

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
  return { sent, skipped, failed, more: (rows?.length ?? 0) === BATCH };
}

export function serviceClient(supabaseUrl, serviceKey) {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
