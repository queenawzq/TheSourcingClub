/**
 * Orgs and membership.
 *
 * An org is a brand or a factory. Every user belongs to at least one, and
 * every row in the database reaches an org_id — that is what makes a single
 * access rule work across the whole schema.
 */
import { fetchApi, SIGN_IN_ENDED, supabase, unwrap } from "../supabase.js";

/**
 * Orgs the signed-in user belongs to.
 *
 * The user_id filter is load-bearing, not belt-and-braces. `org_members_read`
 * ends in `or is_platform_admin()` — deliberately, because the admin tooling
 * needs to see who belongs to what — so for staff this query without a filter
 * returns EVERY membership in the marketplace. The app then took the first
 * one as the signed-in user's own org and dropped an admin into a stranger's
 * workspace, mid-onboarding, with their org id written to localStorage.
 *
 * RLS says what a user may read. It does not say what a query means. This one
 * means "mine", so it says so.
 */
export async function listMyOrgs(knownUserId = null) {
  // AuthProvider already has the restored session. Revalidating it with
  // getUser() here adds another auth request and can wait behind a stale token
  // refresh lock, leaving the whole app on "Checking your session…". Callers
  // without a restored session may still use the validated fallback.
  let userId = knownUserId;
  if (!userId) {
    const { data: auth } = await supabase.auth.getUser();
    userId = auth?.user?.id;
  }
  if (!userId) return [];

  return unwrap(
    await supabase
      .from("org_members")
      .select("role, permissions, title, orgs (id, type, name, slug, is_demo, created_at)")
      .eq("user_id", userId)
      .order("created_at", { referencedTable: "orgs", ascending: true }),
    "load your organisations",
  ).map((row) => ({ ...row.orgs, role: row.role, permissions: row.permissions ?? [], title: row.title ?? null }));
}

/**
 * The design's permission keys (Settings → Roles & access), per kind of
 * company. The database holds the same list (permission_keys()).
 */
export const PERMISSION_KEYS = {
  brand: ["rfqFlow", "approve", "releaseFunds", "primaryContact", "settingsAccess"],
  factory: ["rfqFlow", "addUpdate", "primaryContact", "settingsAccess"],
};

/** What a newly invited member starts with: the design's ticked box. */
export const INVITE_DEFAULT_PERMISSIONS = { brand: ["approve"], factory: ["addUpdate"] };

export function permissionLabel(perm, kind) {
  return {
    rfqFlow: kind === "factory" ? "RFQ flow" : "Quote flow",
    approve: "Approve samples",
    releaseFunds: "Release funds",
    addUpdate: "Add update",
    primaryContact: "Primary contact",
    settingsAccess: "Settings access",
  }[perm] ?? perm;
}

/**
 * Whether the signed-in person may do `perm` at `org` (an entry from
 * listMyOrgs). The same rule as has_org_permission() in the database: an
 * owner holds every authority, and primaryContact only when chosen. The
 * screens use it to offer only what the database will allow.
 */
export function can(org, perm) {
  if (!org) return false;
  if (org.role === "owner" && perm !== "primaryContact") return true;
  return (org.permissions ?? []).includes(perm);
}

/** The sentence a screen shows instead of a control the person may not use. */
export function needsPermission(org, perm) {
  const kind = org?.type === "factory" ? "factory" : "brand";
  return `You need the ${permissionLabel(perm, kind)} permission at ${org?.name ?? "your company"} for this. An owner can give it to you in Settings.`;
}

/**
 * Create an org and become its owner, atomically.
 *
 * This goes through an RPC rather than a plain insert so an org can never
 * exist without an owner attached — there is deliberately no INSERT policy on
 * the table.
 */
export async function createOrg(name, type) {
  return unwrap(
    await supabase.rpc("create_org", { org_name: name, org_kind: type }),
    "create your organisation",
  );
}

/** Members of an org, for the settings screen. */
export async function listMembers(orgId) {
  return unwrap(
    await supabase
      .from("org_members")
      .select("user_id, role, permissions, title, created_at, user_profiles (id, full_name, email, avatar_url)")
      .eq("org_id", orgId),
    "load team members",
  );
}

/**
 * Invite a teammate by email, and email them (api/send-team-invite). Someone
 * with Settings access may; the database decides the rest (permissions no
 * wider than the inviter's own, not already on the team, 20 a day).
 * `permissions` null means the design's default for a new member.
 * @returns {{ id, emailed: boolean, reason: "reserved_address"|"email_not_set_up"|"email_failed"|null }}
 */
export async function inviteMember(orgId, email, { name = null, title = null, permissions = null } = {}) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!address.includes("@")) throw new Error("Enter their email address.");
  return teamInviteCall({ orgId, email: address, name, title, permissions });
}

/** Email a pending invitation again, with another 14 days to accept it. */
export async function resendInvitation(invitationId) {
  return teamInviteCall({ resendId: invitationId });
}

async function teamInviteCall(body) {
  let response;
  try {
    response = await fetchApi("/api/send-team-invite", body);
  } catch {
    throw new Error("The invitation could not be sent: check your connection and try again.");
  }
  if (response.status === 401) throw new Error(SIGN_IN_ENDED);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(teamError({ message: result.error, hint: result.code }, "send the invitation"));
  return result;
}

/**
 * What the inviter is told once an invitation is in: emailed, or saved
 * without the email and why. Saved still works: the person sees it when they
 * sign in with that address.
 */
export function teamInviteNotice({ emailed, reason = null }, email = null) {
  if (emailed) return `Invitation sent${email ? ` to ${email}` : ""}.`;
  const saved = `Invitation saved${email ? ` for ${email}` : ""}`;
  switch (reason) {
    case "reserved_address":
      return `${saved}. No email was sent: it is a test address that cannot receive mail. They will see it when they log in with that address.`;
    case "email_not_set_up":
      return `${saved}. This site does not send email, so let them know yourself. They will see it when they log in with that address.`;
    default:
      return `${saved}, but the email did not go out. Let them know yourself: they will see it when they log in with that address.`;
  }
}

/**
 * One sentence per way a team change can be refused. The database's own
 * words are already sentences for most; the hint names the case where the
 * screen should say more, and a raw code never reaches the page.
 */
export function teamError(error, doing = "make that change") {
  const hint = String(error?.hint ?? "");
  const message = String(error?.message ?? "");
  if (hint === "last_owner") return "A company always keeps at least one owner. Make someone else an owner first.";
  if (hint === "already_member") return "That person is already on your team.";
  if (hint === "already_invited") return "That address already has an invitation waiting. Use Resend to email it again.";
  if (hint === "daily_limit") return "You can invite up to 20 people a day. Try again tomorrow.";
  if (hint === "staff_address") return "That address belongs to The Sourcing Club staff, who cannot join a company.";
  if (hint === "resend_too_soon") return "This invitation was emailed a few minutes ago. Try again in 10 minutes.";
  if (hint.startsWith("permission_not_held:") || hint.startsWith("missing_permission:")) return message;
  if (hint === "signed_out" || /JWT|sign-in has expired/i.test(message)) return SIGN_IN_ENDED;
  if (hint === "not_set_up") return "Invitations are not set up on this site yet.";
  if (/^Only|^You |^A company|^That |^This /.test(message)) return message;
  return `We could not ${doing}. Try again, and if it keeps failing contact support.`;
}

/** Change what a member may do, and their title. Owners only. */
export async function setMemberAccess(orgId, userId, permissions, title = null) {
  const { data, error } = await supabase.rpc("set_member_access", {
    target_org: orgId, target_user: userId, new_permissions: permissions, new_title: title,
  });
  if (error) throw new Error(teamError(error, "change their permissions"));
  return data;
}

/** Make someone an owner, or an owner a member. Owners only; never the last owner. */
export async function setMemberRole(orgId, userId, role) {
  const { data, error } = await supabase.rpc("set_member_role", { target_org: orgId, target_user: userId, new_role: role });
  if (error) throw new Error(teamError(error, "change their role"));
  return data;
}

/** Remove someone (owners), or leave (anyone but the last owner). */
export async function removeMember(orgId, userId) {
  const { error } = await supabase.rpc("remove_member", { target_org: orgId, target_user: userId });
  if (error) throw new Error(teamError(error, "remove them"));
}

/** Settings → Account: the company's own email, phone and location. */
export async function getCompanyBasics(orgId) {
  return unwrap(
    await supabase.from("org_contact_details").select("email, phone").eq("org_id", orgId).maybeSingle(),
    "load the company details",
  );
}

export async function saveCompanyBasics(orgId, { email, phone, location }) {
  const { data, error } = await supabase.rpc("save_company_basics", {
    target_org: orgId, new_email: email ?? null, new_phone: phone ?? null, new_location: location ?? null,
  });
  if (error) {
    if (error.code === "23514") throw new Error("Check the email address and phone number: one of them is not in a form we can save.");
    throw new Error(teamError(error, "save the company details"));
  }
  return data;
}

/** An org's own pending invitations, for the settings screen. Owners only; RLS enforces it. */
export async function listPendingInvitations(orgId) {
  return unwrap(
    await supabase
      .from("org_invitations")
      .select("id, email, role, permissions, title, invited_name, emailed_at, created_at")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    "load pending invitations",
  );
}

/** Withdraw a pending invitation. Someone with Settings access. */
export async function revokeInvitation(invitationId) {
  const { data, error } = await supabase.rpc("revoke_invitation", { target_invitation: invitationId });
  if (error) throw new Error(teamError(error, "withdraw the invitation"));
  return data;
}

/**
 * Invitations addressed to the signed-in user's own email address, to a
 * company they are not in yet. Read through my_invitation_companies(): a
 * plain select also returned an owner's own company's outgoing invitations,
 * and the invited company's name was unreadable to someone not in it yet.
 */
export async function listMyInvitations() {
  return unwrap(await supabase.rpc("my_invitation_companies"), "load your invitations").map((row) => ({
    id: row.invitation_id,
    role: row.role,
    title: row.title,
    permissions: row.permissions ?? [],
    created_at: row.created_at,
    orgs: { id: row.org_id, name: row.org_name, type: row.org_type },
  }));
}

export async function acceptInvitation(invitationId) {
  return unwrap(
    await supabase.rpc("accept_invitation", { invitation_id: invitationId }),
    "accept the invitation",
  );
}
