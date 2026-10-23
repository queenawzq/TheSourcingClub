import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { publicAppUrl, sendOneEmail, serviceClient } from "./_notification-sender.js";
// Vercel compiles api/*.js as CommonJS; import the ESM email builder lazily.
const loadEmails = () => import("../scripts/generate-notification-email.mjs");

/**
 * "Invite a factory" / "Invite a brand": records the invite and emails it.
 *
 * The invite is inserted with the CALLER's token, so the database decides
 * everything: membership (RLS), and the guard on `referrals` refuses the
 * company's own email domain, a repeat, and more than 20 a day. An address
 * that already has an account is saved with `refused_at` rather than raised,
 * so asking about it counts toward the 20; it is answered here as a refusal
 * and never emailed. Only then is the email sent, with the service key used
 * for nothing but reading the company's name and stamping `emailed_at`.
 *
 * An invite that is saved but could not be emailed still counts: whoever
 * signs up with that address is linked to it.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method not allowed" });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) {
    response.status(503).json({ error: "invites are not configured on the server" });
    return;
  }

  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ")) {
    response.status(401).json({ error: "sign in is required" });
    return;
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body ?? {};
  const orgId = String(body.orgId ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const message = String(body.message ?? "").trim().slice(0, 1000) || null;
  if (!orgId || !email) {
    response.status(400).json({ error: "enter the email address to invite" });
    return;
  }

  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: invite, error: inviteError } = await caller
    .from("referrals")
    .insert({ referrer_org_id: orgId, email, message })
    .select("id, email, refused_at")
    .single();
  if (inviteError) {
    const status = inviteError.code === "42501" ? 403 : inviteError.code === "54000" ? 429 : 400;
    response.status(status).json({ error: inviteError.message });
    return;
  }
  if (invite.refused_at) {
    response.status(400).json({ error: "this address already has a Sourcing Club account" });
    return;
  }

  const service = serviceClient(supabaseUrl, serviceKey);
  const { data: org } = await service.from("orgs").select("name, type").eq("id", orgId).single();

  let delivery = { sent: false, reason: "email is not set up on this server" };
  try {
    const { inviteEmail } = await loadEmails();
    const appUrl = publicAppUrl(request);
    const env = {
      appUrl,
      logoUrl: `${appUrl}/assets/logo.png`,
      supportEmail: process.env.SUPPORT_EMAIL ?? "operations@contact.sourcing-club.com",
      companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
    };
    delivery = await sendOneEmail({
      key: `invite-${invite.id}`,
      to: invite.email,
      message: inviteEmail({ inviterName: org?.name, kind: org?.type, message }, env),
    });
  } catch (error) {
    delivery = { sent: false, reason: String(error.message || error) };
  }

  if (delivery.sent) {
    await service.from("referrals").update({ emailed_at: new Date().toISOString() }).eq("id", invite.id);
  }
  response.status(200).json({ id: invite.id, emailed: delivery.sent, reason: delivery.sent ? null : delivery.reason, error: null });
}
