import { EMAIL_LOGO_URL } from "./_email-assets.js";
import { emailTransport, publicAppUrl, sendOneEmail } from "./_notification-sender.js";
// Vercel compiles api/*.js as CommonJS; import the ESM email builder lazily.
const loadReviewEmail = () => import("../scripts/generate-account-approved-email.mjs");

/**
 * Sends the review emails: a decision to every member of the company
 * (verification_approval_email_outbox), and a company's resubmission to staff
 * (review_resubmission_email_outbox). Shared by api/send-review-decision
 * (staff's kick after a decision, and "Resend email"), api/review-resubmitted
 * (the company's kick) and api/cron-daily (the retry for everything).
 *
 * The database decides what is due (claim_review_*): the current decision
 * only, current members only, at most five attempts. This file only sends, and
 * records each outcome in words staff can read: the provider's own message is
 * logged, never stored or shown.
 */

// Replies land in the operations inbox (forwarded by api/inbound-email.js),
// not at the noreply sender, which has no mailbox.
const REPLY_TO = process.env.SUPPORT_EMAIL ?? "operations@contact.sourcing-club.com";
// Resend's free plan allows two requests a second.
const RESEND_SPACING_MS = 550;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Staff wait on this answer after a decision, so a provider that never answers
// must not hold the screen: the send is recorded as failed and retried.
const SEND_TIMEOUT_MS = 10_000;
class SendTimeout extends Error {}
const withinTime = (promise) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new SendTimeout("timed out")), SEND_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
};

/** Where staff are told that a company sent its profile back. */
export function reviewAlertAddress() {
  return process.env.REVIEW_ALERT_EMAIL?.trim() || process.env.SUPPORT_EMAIL?.trim() || "operations@contact.sourcing-club.com";
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

/**
 * The note is what the reviewer actually wrote to the company. On
 * needs_information it is the whole point of the email — the database refuses
 * that decision without one — so it is quoted rather than summarised.
 */
const noteBlock = (note, heading) => {
  const trimmed = String(note ?? "").trim();
  if (!trimmed) return { text: "", html: "" };
  return {
    text: `\n${heading}\n${trimmed}\n`,
    html: `<p><strong>${escapeHtml(heading)}</strong></p><blockquote style="margin:0 0 16px;padding:8px 16px;border-left:3px solid #d5d5d5;color:#333;white-space:pre-wrap;">${escapeHtml(trimmed)}</blockquote>`,
  };
};

/** The sign-in link for the company's own portal. */
function loginUrlFor(row, appUrl) {
  return row.orgs?.type === "brand" || !row.orgs?.type ? `${appUrl}/app.html` : `${appUrl}/app.html?portal=factory`;
}

// Exported (through api/send-review-decision.js) for api/send-test-email.js,
// so a test is the real message.
export async function messageFor(row, { appUrl = publicAppUrl() } = {}) {
  const loginUrl = loginUrlFor(row, appUrl);
  const company = row.orgs?.name || "your company";
  const zh = row.locale === "zh";
  if (row.decision === "approved") {
    const { accountApprovedEmail } = await loadReviewEmail();
    return accountApprovedEmail({
      companyName: company,
      recipientName: row.recipient_name,
      locale: row.locale,
      loginUrl,
      logoUrl: EMAIL_LOGO_URL,
      supportEmail: REPLY_TO,
      companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
      note: row.note,
    });
  }
  if (row.decision === "needs_information") {
    const { needsInformationEmail } = await loadReviewEmail();
    return needsInformationEmail({
      companyName: company,
      recipientName: row.recipient_name,
      locale: row.locale,
      loginUrl,
      logoUrl: EMAIL_LOGO_URL,
      supportEmail: REPLY_TO,
      companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
      note: row.note,
    });
  }
  const greeting = row.recipient_name
    ? (zh ? `${row.recipient_name} 你好，` : `Hi ${row.recipient_name},`)
    : (zh ? "你好，" : "Hi,");

  const copy = {
    en: {
      subject: "We could not verify your profile",
      lead: `We were unable to verify <strong>${escapeHtml(company)}</strong>'s profile at this time.`,
      leadText: `We were unable to verify ${company}'s profile at this time.`,
      noteHeading: "Reason given:",
      cta: "Log in to The Sourcing Club",
    },
    zh: {
      subject: "你的资料未能通过审核",
      lead: `我们目前无法通过 <strong>${escapeHtml(company)}</strong> 的资料审核。`,
      leadText: `我们目前无法通过 ${company} 的资料审核。`,
      noteHeading: "原因说明：",
      cta: "登录 The Sourcing Club",
    },
  };

  const t = copy[zh ? "zh" : "en"];
  const note = noteBlock(row.note, t.noteHeading);
  const sign = zh
    ? "如有疑问，直接回复这封邮件即可。"
    : "If you have any questions, just reply to this email.";

  return {
    subject: t.subject,
    text: `${greeting}\n\n${t.leadText}\n${note.text}\n${t.cta}: ${loginUrl}\n\n${sign}\n\nThe Sourcing Club`,
    html: `<p>${escapeHtml(greeting)}</p><p>${t.lead}</p>${note.html}<p><a href="${escapeHtml(loginUrl)}">${escapeHtml(t.cta)}</a></p><p>${escapeHtml(sign)}</p><p>The Sourcing Club</p>`,
  };
}

/** The email staff get when a company sends its profile back. English: it is read by staff. */
export function resubmissionAlertMessage({ orgId, orgName, orgType, note }, { appUrl = publicAppUrl() } = {}) {
  const kind = orgType === "brand" ? "brand" : "vendor";
  const company = orgName || "A company";
  const reviewUrl = `${appUrl}/admin.html?screen=review&profile=${encodeURIComponent(orgId ?? "")}`;
  const request = noteBlock(note, "What we had asked for:");
  return {
    subject: `${company} sent its profile back for review`,
    text: `${company} (${kind}) has updated its profile and sent it back for review.\n${request.text}\nOpen the review: ${reviewUrl}\n\nThe Sourcing Club`,
    html: `<p><strong>${escapeHtml(company)}</strong> (${kind}) has updated its profile and sent it back for review.</p>${request.html}<p><a href="${escapeHtml(reviewUrl)}">Open the review</a></p><p>The Sourcing Club</p>`,
  };
}

/**
 * What is said about a send that did not happen, in words staff can act on.
 * The provider's own message goes to the log only.
 */
function failureReason(error) {
  const text = String(error?.message ?? error ?? "");
  if (error instanceof SendTimeout) return "the email service did not answer in time";
  if (error?.name === "TypeError" || /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network/i.test(text)) {
    return "the email service could not be reached";
  }
  return "the email service did not accept it";
}

/**
 * Sends what is due for one company (`orgId`) or for every company (no orgId).
 * Rows are only claimed when there is a way to send them, so on a site with no
 * email set up they wait in the queue untouched.
 * @returns {{ configured, sent: string[], skipped: {email, reason}[], failed: {email, reason}[] }}
 */
export async function sendReviewDecisionEmails(service, request, { orgId = null, max = 25 } = {}) {
  const result = { configured: false, sent: [], skipped: [], failed: [] };
  const mail = emailTransport();
  if (!mail) return result;
  result.configured = true;

  const { data: rows, error } = await service.rpc("claim_review_decision_emails", { target_org: orgId, max_rows: max });
  if (error) throw new Error("the review email queue could not be read");

  const appUrl = publicAppUrl(request);
  // Once the service has not answered, the rest of the batch is not tried:
  // each would wait the full timeout for the same answer.
  let down = null;
  for (const [index, row] of (rows ?? []).entries()) {
    const finish = (outcome, provider = null, errorText = null) => service.rpc("finish_review_decision_email", {
      target_org: row.org_id,
      target_user: row.recipient_user_id,
      row_decision: row.decision,
      row_review_updated_at: row.review_updated_at,
      outcome,
      provider,
      error_text: errorText,
    });
    if (down) {
      await finish("failed", null, down);
      result.failed.push({ email: row.recipient_email, reason: down });
      continue;
    }
    try {
      if (mail.name === "resend" && index > 0) await wait(RESEND_SPACING_MS);
      const message = await messageFor({ ...row, orgs: { name: row.org_name, type: row.org_type } }, { appUrl });
      // The attempt is in the key: the provider answers a reused key with its
      // first answer for 24 hours, errors included, so a retry with the same
      // key would only be told "failed" again.
      const delivery = await withinTime(sendOneEmail({
        key: `review-${row.decision}-${row.org_id}-${row.recipient_user_id}-${row.review_updated_at}-${row.attempts}`,
        to: row.recipient_email,
        message,
      }, mail));
      if (!delivery.sent) {
        const reason = delivery.reason === "reserved_address"
          ? "a test address that cannot receive email"
          : "email is not set up on this site";
        await finish("skipped", null, reason);
        result.skipped.push({ email: row.recipient_email, reason });
        continue;
      }
      await finish("sent", delivery.providerId ?? null);
      result.sent.push(row.recipient_email);
    } catch (sendError) {
      console.error("review email:", row.recipient_email, sendError?.message ?? sendError);
      const reason = failureReason(sendError);
      if (reason !== "the email service did not accept it") down = reason;
      await finish("failed", null, reason);
      result.failed.push({ email: row.recipient_email, reason });
    }
  }
  return result;
}

/**
 * Sends the staff alerts that are due, for one company or all.
 * @returns {{ configured, sent: number, skipped: number, failed: number }}
 */
export async function sendResubmissionAlerts(service, request, { orgId = null, max = 25 } = {}) {
  const result = { configured: false, sent: 0, skipped: 0, failed: 0 };
  const mail = emailTransport();
  if (!mail) return result;
  result.configured = true;

  const { data: rows, error } = await service.rpc("claim_review_resubmission_emails", { target_org: orgId, max_rows: max });
  if (error) throw new Error("the staff alert queue could not be read");

  const appUrl = publicAppUrl(request);
  const to = reviewAlertAddress();
  let down = null;
  for (const [index, row] of (rows ?? []).entries()) {
    const finish = (outcome, provider = null, errorText = null) => service.rpc("finish_review_resubmission_email", {
      target_org: row.org_id,
      row_resubmitted_at: row.resubmitted_at,
      outcome,
      provider,
      error_text: errorText,
    });
    if (down) {
      await finish("failed", null, down);
      result.failed += 1;
      continue;
    }
    try {
      if (mail.name === "resend" && index > 0) await wait(RESEND_SPACING_MS);
      const message = resubmissionAlertMessage({
        orgId: row.org_id, orgName: row.org_name, orgType: row.org_type, note: row.note,
      }, { appUrl });
      const delivery = await withinTime(sendOneEmail({
        key: `review-resubmitted-${row.org_id}-${row.resubmitted_at}-${row.attempts}`,
        to,
        message,
      }, mail));
      if (!delivery.sent) {
        await finish("skipped", null, "the staff address cannot receive email");
        result.skipped += 1;
        continue;
      }
      await finish("sent", delivery.providerId ?? null);
      result.sent += 1;
    } catch (sendError) {
      console.error("review resubmission alert:", sendError?.message ?? sendError);
      const reason = failureReason(sendError);
      if (reason !== "the email service did not accept it") down = reason;
      await finish("failed", null, reason);
      result.failed += 1;
    }
  }
  return result;
}
