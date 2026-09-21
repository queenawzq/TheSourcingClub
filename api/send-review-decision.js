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

// Exported for api/send-test-email.js, so a test is the real message.
export function messageFor(row) {
  const loginUrl = `${appUrl()}/app.html`;
  const company = row.orgs?.name || "your company";
  const zh = row.locale === "zh";
  const greeting = row.recipient_name
    ? (zh ? `${row.recipient_name} 你好，` : `Hi ${row.recipient_name},`)
    : (zh ? "你好，" : "Hi,");

  const copy = {
    approved: {
      en: {
        subject: "Your Sourcing Club account is approved",
        lead: `<strong>${escapeHtml(company)}</strong>'s profile has been approved. You can now log in to The Sourcing Club.`,
        leadText: `${company}'s profile has been approved. You can now log in to The Sourcing Club.`,
        noteHeading: "A note from our team:",
        cta: "Log in to The Sourcing Club",
      },
      zh: {
        subject: "你的 The Sourcing Club 账户已通过审核",
        lead: `<strong>${escapeHtml(company)}</strong> 的资料已通过审核。你现在可以登录 The Sourcing Club。`,
        leadText: `${company} 的资料已通过审核。你现在可以登录 The Sourcing Club。`,
        noteHeading: "我们团队的留言：",
        cta: "登录 The Sourcing Club",
      },
    },
    needs_information: {
      en: {
        subject: "We need a little more information",
        lead: `We have reviewed <strong>${escapeHtml(company)}</strong>'s profile and need a little more information before we can verify it.`,
        leadText: `We have reviewed ${company}'s profile and need a little more information before we can verify it.`,
        noteHeading: "What we need:",
        cta: "Update your profile",
      },
      zh: {
        subject: "我们还需要一些补充信息",
        lead: `我们已经查看了 <strong>${escapeHtml(company)}</strong> 的资料，在完成审核前还需要一些补充信息。`,
        leadText: `我们已经查看了 ${company} 的资料，在完成审核前还需要一些补充信息。`,
        noteHeading: "我们需要的信息：",
        cta: "更新你的资料",
      },
    },
    declined: {
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
    },
  };

  const decision = copy[row.decision] ? row.decision : "approved";
  const t = copy[decision][zh ? "zh" : "en"];
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
    response.status(503).json({ sent: 0, error: "review email is not configured on the server" });
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
    .select("org_id, recipient_user_id, recipient_email, recipient_name, locale, decision, note, review_updated_at, status, attempts, orgs (name)")
    .eq("org_id", orgId)
    .neq("status", "sent");

  if (queueError) {
    response.status(500).json({ sent: 0, error: "the review email queue could not be read" });
    return;
  }
  if (!queued?.length) {
    response.status(200).json({ sent: 0, alreadySent: true, error: null });
    return;
  }

  let sent = 0;
  const failures = [];

  // Every one of the four primary key columns has to be matched. Keying an
  // update on (org_id, recipient_user_id) alone was unique under the old
  // schema and is not under the new one: it would stamp one person's whole
  // decision history with the result of whichever row was sent last.
  const rowKey = (query, row) => query
    .eq("org_id", row.org_id)
    .eq("recipient_user_id", row.recipient_user_id)
    .eq("decision", row.decision)
    .eq("review_updated_at", row.review_updated_at);

  for (const row of queued) {
    const { error: claimError } = await rowKey(
      service
        .from("verification_approval_email_outbox")
        .update({ status: "sending", attempts: 1 + Number(row.attempts ?? 0), last_error: null }),
      row,
    );

    if (claimError) {
      failures.push("the review email could not be claimed for delivery");
      continue;
    }

    const message = messageFor(row);
    try {
      const delivery = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `review-${row.decision}-${row.org_id}-${row.recipient_user_id}-${row.review_updated_at}`,
        },
        body: JSON.stringify({ from, to: [row.recipient_email], ...message }),
      });
      const payload = await delivery.json().catch(() => ({}));
      if (!delivery.ok) throw new Error(payload.message || `email provider returned ${delivery.status}`);

      await rowKey(
        service
          .from("verification_approval_email_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString(), provider_id: payload.id ?? null, last_error: null }),
        row,
      );
      sent += 1;
    } catch (error) {
      const reason = String(error.message || error).slice(0, 500);
      failures.push(reason);
      await rowKey(
        service
          .from("verification_approval_email_outbox")
          .update({ status: "failed", last_error: reason }),
        row,
      );
    }
  }

  if (failures.length) {
    response.status(502).json({ sent, error: "one or more review emails could not be delivered" });
    return;
  }
  response.status(200).json({ sent, alreadySent: sent === 0, error: null });
}
