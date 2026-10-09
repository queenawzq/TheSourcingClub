/**
 * Settings, on Queena's designed screen.
 *
 * `SettingsScreen` is imported from src/prototype/main.jsx and mounted here.
 * This file is the seam: it supplies the real team and turns the invite panel
 * and the remove control into the calls that back them.
 *
 * For a brand it also supplies the real account details (org name, business
 * email, HQ location from brand_profiles), the real pending invitations, and
 * the payment method's empty state: payments are track-only, so no card or
 * bank account is ever stored. No phone number is stored anywhere either, so
 * that field is left empty. A factory still sees the drawn account (later).
 *
 * Password and notification preferences are drawn against nothing and are
 * left exactly as drawn.
 */
import React, { useCallback, useEffect, useState } from "react";
import { SettingsScreen, settingsPermissionLabels } from "../../prototype/main.jsx";
import { inviteMember, listMembers, listPendingInvitations } from "../../lib/domain/org.js";
import { getBrandProfile } from "../../lib/domain/profile.js";

/** "Sent today", "Sent yesterday", "Sent Oct 3", like the drawn rows. */
function sentLabel(createdAt) {
  const sent = new Date(createdAt);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(sent).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Sent today";
  if (days === 1) return "Sent yesterday";
  return `Sent ${sent.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default function LiveSettings({ org, isFactory }) {
  const [members, setMembers] = useState(null);
  const [profile, setProfile] = useState(null);
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [loadedMembers, loadedProfile, loadedInvites] = await Promise.all([
        listMembers(org.id),
        isFactory ? null : getBrandProfile(org.id),
        isFactory ? [] : listPendingInvitations(org.id),
      ]);
      setProfile(loadedProfile);
      setInvites(loadedInvites);
      setMembers(loadedMembers);
    } catch (failure) {
      setError(failure);
    }
  }, [org.id, isFactory]);

  useEffect(() => { reload(); }, [reload]);

  async function invite(email) {
    setBusy(true);
    setError(null);
    try {
      await inviteMember(org.id, email);
      await reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The designed team rows.
   *
   * The schema has two roles, owner and member. The owner can do everything
   * the design lists, so every box is ticked; a member's list is empty because
   * there is no per-member permission to map the toggles onto.
   */
  const team = (members ?? []).map((member) => ({
    name: member.user_profiles?.full_name ?? member.user_profiles?.email ?? "Member",
    email: member.user_profiles?.email ?? "",
    role: member.role === "owner" ? "Owner" : "Member",
    permissions: member.role === "owner" && !isFactory ? settingsPermissionLabels.map((item) => item.key) : [],
  }));

  const owner = (members ?? []).find((member) => member.role === "owner");
  const brandLive = isFactory ? {} : {
    account: {
      name: org.name ?? "",
      email: profile?.business_email || owner?.user_profiles?.email || "",
      phone: "",
      location: profile?.hq_location ?? "",
    },
    paymentMethods: [],
    invites: invites.map((invite) => ({
      email: invite.email,
      role: invite.role === "owner" ? "Owner" : "Member",
      sent: sentLabel(invite.created_at),
    })),
  };

  if (!members) return null;

  return (
    <SettingsScreen
      accountType={isFactory ? "factory" : "brand"}
      team={team}
      {...brandLive}
      onInvite={invite}
      busy={busy}
      error={error}
    />
  );
}
