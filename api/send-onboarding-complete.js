import { createClient } from "@supabase/supabase-js";
// Loaded with import(), not a static import: Vercel compiles api/*.js to
// CommonJS, and a static import of this .mjs becomes a require() that
// crashes the function before it runs (ERR_REQUIRE_ESM, a bare 500).
const loadOnboardingEmail = () =>
  import("../scripts/generate-onboarding-emails.mjs").then((module) => module.onboardingEmail);

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Replies land in the operations inbox (forwarded by api/inbound-email.js),
// not at the noreply sender, which has no mailbox.
const REPLY_TO = process.env.SUPPORT_EMAIL ?? "operations@contact.sourcing-club.com";

const jsonBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};

function appUrl() {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "https://the-sourcing-club.vercel.app";
}

const rowKey = (query, row) => query
  .eq("org_id", row.org_id)
  .eq("recipient_user_id", row.recipient_user_id);

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ sent: 0, error: "method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const authorization = request.headers.authorization;

  if (!supabaseUrl || !anonKey || !serviceKey || !resendKey || !from) {
    response.status(503).json({ sent: 0, error: "onboarding email is not configured on the server" });
    return;
  }
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ sent: 0, error: "sign in is required" });
    return;
  }

  const orgId = String(jsonBody(request).orgId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId)) {
    response.status(400).json({ sent: 0, error: "a valid organization id is required" });
    return;
  }

  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: isOwner, error: ownerError } = await caller.rpc("is_org_owner", { target_org: orgId });
  if (ownerError || !isOwner) {
    response.status(403).json({ sent: 0, error: "organization owner access is required" });
    return;
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: queued, error: queueError } = await service
    .from("onboarding_submission_email_outbox")
    .select("org_id, recipient_user_id, recipient_email, recipient_name, company_name, profile_kind, submitted_at, status, attempts")
    .eq("org_id", orgId)
    .neq("status", "sent");

  if (queueError) {
    response.status(500).json({ sent: 0, error: "the onboarding email queue could not be read" });
    return;
  }
  if (!queued?.length) {
    response.status(200).json({ sent: 0, alreadySent: true, error: null });
    return;
  }

  let sent = 0;
  const failures = [];
  for (const row of queued) {
    const { error: claimError } = await rowKey(
      service
        .from("onboarding_submission_email_outbox")
        .update({ status: "sending", attempts: 1 + Number(row.attempts ?? 0), last_error: null }),
      row,
    );
    if (claimError) {
      failures.push("the onboarding email could not be claimed for delivery");
      continue;
    }

    const dashboardUrl = row.profile_kind === "brand"
      ? `${appUrl()}/app.html`
      : `${appUrl()}/app.html?portal=factory`;
    try {
      const onboardingEmail = await loadOnboardingEmail();
      const message = onboardingEmail(row.profile_kind, {
        companyName: row.company_name,
        dashboardUrl,
        logoUrl: `${appUrl()}/assets/logo.png`,
        supportEmail: REPLY_TO,
        companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
      });
      const delivery = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `onboarding-${row.org_id}-${row.recipient_user_id}-${row.submitted_at}`,
        },
        body: JSON.stringify({ from, to: [row.recipient_email], reply_to: REPLY_TO, ...message }),
      });
      const payload = await delivery.json().catch(() => ({}));
      if (!delivery.ok) throw new Error(payload.message || `email provider returned ${delivery.status}`);

      await rowKey(
        service
          .from("onboarding_submission_email_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString(), provider_id: payload.id ?? null, last_error: null }),
        row,
      );
      sent += 1;
    } catch (error) {
      const reason = String(error.message || error).slice(0, 500);
      failures.push(reason);
      await rowKey(
        service
          .from("onboarding_submission_email_outbox")
          .update({ status: "failed", last_error: reason }),
        row,
      );
    }
  }

  if (failures.length) {
    response.status(502).json({ sent, error: "one or more onboarding emails could not be delivered" });
    return;
  }
  response.status(200).json({ sent, alreadySent: sent === 0, error: null });
}
