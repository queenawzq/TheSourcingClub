import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { publicAppUrl, sendOneEmail, serviceClient } from "./_notification-sender.js";
// Vercel compiles api/*.js as CommonJS; import the ESM email builder lazily.
const loadEmails = () => import("../scripts/generate-notification-email.mjs");

/**
 * Inviting a teammate (Settings → Invite member), or sending the invitation
 * again (Invited → Resend).
 *
 * The invitation is written with the CALLER's token, so the database decides
 * everything (org_invitations guard): Settings access, permissions no wider
 * than the inviter's own, not already on the team, not a staff address, 20 a
 * day per person. Resend goes through resend_invitation(), which extends the
 * expiry and refuses a second email within ten minutes. Only then is the email
 * sent; the service key reads names and stamps `emailed_at`, nothing else.
 *
 * An invitation that is saved but not emailed still works: the person sees it
 * when they sign in with that address.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method not allowed" });
    return;
  }
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) {
    response.status(503).json({ error: "Invitations are not set up on this server", code: "not_set_up" });
    return;
  }

  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ")) {
    response.status(401).json({ error: "Your sign-in has expired: sign in again", code: "signed_out" });
    return;
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body ?? {};
  const resendId = body.resendId ? String(body.resendId) : null;

  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });

  const columns = "id, org_id, email, permissions, title, invited_name, invited_by, expires_at";
  let result;
  if (resendId) {
    result = await caller.rpc("resend_invitation", { target_invitation: resendId }).select(columns).single();
  } else {
    const orgId = String(body.orgId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!orgId || !email) {
      response.status(400).json({ error: "Enter the email address to invite", code: "email_missing" });
      return;
    }
    const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : null;
    result = await caller
      .from("org_invitations")
      .insert({
        org_id: orgId,
        email,
        permissions,
        title: String(body.title ?? "").trim().slice(0, 60) || null,
        invited_name: String(body.name ?? "").trim().slice(0, 120) || null,
      })
      .select(columns)
      .single();
  }

  const { data: invite, error } = result;
  // A token the database refuses (expired, or not ours) is a sign-in problem,
  // not a refusal of the invitation.
  if (error && /^PGRST30/.test(error.code ?? "")) {
    response.status(401).json({ error: "Your sign-in has expired: sign in again", code: "signed_out" });
    return;
  }
  if (error) {
    const status = { 42501: 403, 23505: 409, 54000: 429, 22023: 400, P0002: 404 }[error.code] ?? 400;
    // The guard's hint names the case (already_member, daily_limit,
    // permission_not_held:x, staff_address…) for the screen to word; a
    // duplicate pending invitation trips the unique index and has none.
    const code = error.hint || (error.code === "23505" ? "already_invited" : error.code === "42501" ? "not_allowed" : "refused");
    response.status(status).json({ error: error.message, code });
    return;
  }

  const service = serviceClient(supabaseUrl, serviceKey);
  const [{ data: org }, { data: inviter }] = await Promise.all([
    service.from("orgs").select("name, type").eq("id", invite.org_id).single(),
    service.from("user_profiles").select("full_name").eq("id", invite.invited_by).maybeSingle(),
  ]);

  // Why an invitation was saved but not emailed, as a code the screen words:
  // a reserved test address, no email set up on this server, or the email
  // service did not take it.
  let delivery = { sent: false, reason: "email_not_set_up" };
  try {
    const { teamInviteEmail } = await loadEmails();
    const appUrl = publicAppUrl(request);
    const env = {
      appUrl,
      logoUrl: `${appUrl}/assets/logo.png`,
      supportEmail: process.env.SUPPORT_EMAIL ?? "operations@contact.sourcing-club.com",
      companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
    };
    delivery = await sendOneEmail({
      // The expiry moves on every resend, so a resend is a new send to Resend
      // and never its replay of the first answer.
      key: `team-invite-${invite.id}-${new Date(invite.expires_at).getTime()}`,
      to: invite.email,
      message: teamInviteEmail({
        companyName: org?.name,
        kind: org?.type,
        inviterName: inviter?.full_name,
        inviteeName: invite.invited_name,
        title: invite.title,
        permissions: invite.permissions,
        email: invite.email,
        expiresAt: invite.expires_at,
      }, env),
    });
  } catch (failure) {
    console.error("send-team-invite: the email did not go out", failure);
    delivery = { sent: false, reason: "email_failed" };
  }

  if (delivery.sent) {
    await service.from("org_invitations").update({ emailed_at: new Date().toISOString() }).eq("id", invite.id);
  }
  response.status(200).json({ id: invite.id, emailed: delivery.sent, reason: delivery.sent ? null : delivery.reason, error: null });
}
