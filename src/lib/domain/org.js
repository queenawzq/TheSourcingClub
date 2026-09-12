/**
 * Orgs and membership.
 *
 * An org is a brand or a factory. Every user belongs to at least one, and
 * every row in the database reaches an org_id — that is what makes a single
 * access rule work across the whole schema.
 */
import { supabase, unwrap } from "../supabase.js";

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
export async function listMyOrgs() {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return [];

  return unwrap(
    await supabase
      .from("org_members")
      .select("role, orgs (id, type, name, slug, is_demo, created_at)")
      .eq("user_id", userId)
      .order("created_at", { referencedTable: "orgs", ascending: true }),
    "load your organisations",
  ).map((row) => ({ ...row.orgs, role: row.role }));
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
      .select("role, created_at, user_profiles (id, full_name, email, avatar_url)")
      .eq("org_id", orgId),
    "load team members",
  );
}

/** Invite someone by email. Only owners may do this; RLS enforces it. */
export async function inviteMember(orgId, email, role = "member") {
  return unwrap(
    await supabase
      .from("org_invitations")
      .insert({ org_id: orgId, email: email.trim().toLowerCase(), role })
      .select()
      .single(),
    "send the invitation",
  );
}

/** Invitations addressed to the signed-in user's own email address. */
export async function listMyInvitations() {
  return unwrap(
    await supabase
      .from("org_invitations")
      .select("id, role, created_at, orgs (id, name, type)")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString()),
    "load your invitations",
  );
}

export async function acceptInvitation(invitationId) {
  return unwrap(
    await supabase.rpc("accept_invitation", { invitation_id: invitationId }),
    "accept the invitation",
  );
}
