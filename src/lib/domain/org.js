/**
 * Orgs and membership.
 *
 * An org is a brand or a factory. Every user belongs to at least one, and
 * every row in the database reaches an org_id — that is what makes a single
 * access rule work across the whole schema.
 */
import { supabase, unwrap } from "../supabase.js";

/** Orgs the signed-in user belongs to. RLS returns only their own. */
export async function listMyOrgs() {
  return unwrap(
    await supabase
      .from("org_members")
      .select("role, orgs (id, type, name, slug, is_demo, created_at)")
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
