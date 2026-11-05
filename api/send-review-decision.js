import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { serviceClient } from "./_notification-sender.js";
import { sendReviewDecisionEmails } from "./_review-decision-sender.js";

// Kept here for api/send-test-email.js and scripts/test-transactional-emails.mjs.
export { messageFor } from "./_review-decision-sender.js";

/**
 * Staff's kick after a review decision, and the review page's "Resend email".
 *
 * The decision has already queued its emails in the database (one per member
 * with an address, nothing for a repeat). This sends that company's due ones
 * and answers with what actually happened, so the screen can say it:
 *
 *   outcome  emailed        every current email went
 *            partly         some went, some failed
 *            failed         none went; "Resend email" or the daily job retries
 *            unconfirmed    the email service did not confirm in time; it may
 *                           still arrive, and a retry keeps the same key so the
 *                           service drops a second copy
 *            not_configured this site cannot send email; they wait in the queue
 *            already_sent   nothing new to send: this decision was sent before
 *            no_recipients  nobody at the company has an address that can
 *                           receive it (none, or test addresses only)
 *
 * `{ resend: true }` first puts the current decision's failed emails back in
 * the queue (admin_requeue_review_emails, as the caller, so the staff check is
 * the database's).
 */
const jsonBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};

const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function outcomeOf(result, status, decision) {
  const rows = status?.recipients ?? [];
  const current = Boolean(status?.current) && (!decision || status?.decision === decision);
  const notSent = result.failed.length + result.unconfirmed.length;
  if (result.sent.length && notSent) return "partly";
  if (result.sent.length) return "emailed";
  // A timeout comes first: the rest of its batch was not tried because of it,
  // and the one that timed out may still arrive.
  if (result.unconfirmed.length) return "unconfirmed";
  if (result.failed.length) return "failed";
  if (!current) return "no_recipients";
  if (!result.configured && rows.some((row) => row.status === "pending" || row.status === "failed")) return "not_configured";
  if (rows.some((row) => row.status === "sent")) return "already_sent";
  if (rows.some((row) => row.status === "unconfirmed")) return "unconfirmed";
  if (rows.some((row) => row.status === "failed")) return "failed";
  return "no_recipients";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ outcome: null, error: "method not allowed" });
    return;
  }

  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  const authorization = request.headers.authorization;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    response.status(503).json({ outcome: null, error: "Review emails are not set up on this site." });
    return;
  }
  if (!authorization?.startsWith("Bearer ") || authorization === "Bearer ") {
    response.status(401).json({ outcome: null, error: "Your sign-in has expired. Sign in again to send the email." });
    return;
  }

  const body = jsonBody(request);
  const orgId = String(body.orgId ?? "");
  if (!ORG_ID.test(orgId)) {
    response.status(400).json({ outcome: null, error: "That company could not be found." });
    return;
  }
  const decision = typeof body.decision === "string" ? body.decision : null;

  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: isAdmin, error: adminError } = await caller.rpc("is_platform_admin");
  if (adminError?.code === "PGRST301" || /jwt/i.test(adminError?.message ?? "")) {
    response.status(401).json({ outcome: null, error: "Your sign-in has expired. Sign in again to send the email." });
    return;
  }
  if (adminError || !isAdmin) {
    response.status(403).json({ outcome: null, error: "Only platform staff can send review emails." });
    return;
  }

  if (body.resend === true) {
    const { error: requeueError } = await caller.rpc("admin_requeue_review_emails", { target_org: orgId });
    if (requeueError) {
      response.status(500).json({ outcome: null, error: "The email could not be put back in the queue. Try again in a minute." });
      return;
    }
  }

  let result;
  try {
    result = await sendReviewDecisionEmails(serviceClient(supabaseUrl, serviceKey), request, { orgId });
  } catch (error) {
    console.error("send-review-decision:", error.message);
    response.status(500).json({ outcome: null, error: "The email queue could not be read, so nothing was sent. The daily job will try again." });
    return;
  }

  const { data: status, error: statusError } = await caller.rpc("admin_review_email_status", { target_org: orgId });
  if (statusError) console.error("send-review-decision: status", statusError.message);

  response.status(200).json({
    outcome: outcomeOf(result, status, decision),
    sent: result.sent.length,
    skipped: result.skipped,
    failed: result.failed,
    unconfirmed: result.unconfirmed,
    configured: result.configured,
    status: status ?? null,
    error: null,
  });
}
