import { createClient } from "@supabase/supabase-js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const jsonBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function appUrl() {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "https://the-sourcing-club.vercel.app";
}

function messageFor(row) {
  const loginUrl = `${appUrl()}/app.html`;
  const company = row.orgs?.name || "your company";
  const greeting = row.recipient_name ? `Hi ${row.recipient_name},` : "Hi,";

  if (row.locale === "zh") {
    return {
      subject: "你的 The Sourcing Club 账户已通过审核",
      text: `${greeting}\n\n${company} 的资料已通过审核。你现在可以登录 The Sourcing Club。\n\n登录：${loginUrl}\n\nThe Sourcing Club`,
      html: `<p>${escapeHtml(greeting)}</p><p><strong>${escapeHtml(company)}</strong> 的资料已通过审核。你现在可以登录 The Sourcing Club。</p><p><a href="${escapeHtml(loginUrl)}">登录 The Sourcing Club</a></p><p>The Sourcing Club</p>`,
    };
  }

  return {
    subject: "Your Sourcing Club account is approved",
    text: `${greeting}\n\n${company}'s profile has been approved. You can now log in to The Sourcing Club.\n\nLog in: ${loginUrl}\n\nThe Sourcing Club`,
    html: `<p>${escapeHtml(greeting)}</p><p><strong>${escapeHtml(company)}</strong>'s profile has been approved. You can now log in to The Sourcing Club.</p><p><a href="${escapeHtml(loginUrl)}">Log in to The Sourcing Club</a></p><p>The Sourcing Club</p>`,
  };
}

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
    response.status(503).json({ sent: 0, error: "approval email is not configured on the server" });
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
  const { data: isAdmin, error: adminError } = await caller.rpc("is_platform_admin");
  if (adminError || !isAdmin) {
    response.status(403).json({ sent: 0, error: "platform staff access is required" });
    return;
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: queued, error: queueError } = await service
    .from("verification_approval_email_outbox")
    .select("org_id, recipient_user_id, recipient_email, recipient_name, locale, status, attempts, orgs (name)")
    .eq("org_id", orgId)
    .neq("status", "sent");

  if (queueError) {
    response.status(500).json({ sent: 0, error: "the approval email queue could not be read" });
    return;
  }
  if (!queued?.length) {
    response.status(200).json({ sent: 0, alreadySent: true, error: null });
    return;
  }

  let sent = 0;
  const failures = [];

  for (const row of queued) {
    const { error: claimError } = await service
      .from("verification_approval_email_outbox")
      .update({ status: "sending", attempts: 1 + Number(row.attempts ?? 0), last_error: null })
      .eq("org_id", row.org_id)
      .eq("recipient_user_id", row.recipient_user_id);

    if (claimError) {
      failures.push("the approval email could not be claimed for delivery");
      continue;
    }

    const message = messageFor(row);
    try {
      const delivery = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `verification-approved-${row.org_id}-${row.recipient_user_id}`,
        },
        body: JSON.stringify({ from, to: [row.recipient_email], ...message }),
      });
      const payload = await delivery.json().catch(() => ({}));
      if (!delivery.ok) throw new Error(payload.message || `email provider returned ${delivery.status}`);

      await service
        .from("verification_approval_email_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), provider_id: payload.id ?? null, last_error: null })
        .eq("org_id", row.org_id)
        .eq("recipient_user_id", row.recipient_user_id);
      sent += 1;
    } catch (error) {
      const reason = String(error.message || error).slice(0, 500);
      failures.push(reason);
      await service
        .from("verification_approval_email_outbox")
        .update({ status: "failed", last_error: reason })
        .eq("org_id", row.org_id)
        .eq("recipient_user_id", row.recipient_user_id);
    }
  }

  if (failures.length) {
    response.status(502).json({ sent, error: "one or more approval emails could not be delivered" });
    return;
  }
  response.status(200).json({ sent, alreadySent: sent === 0, error: null });
}
