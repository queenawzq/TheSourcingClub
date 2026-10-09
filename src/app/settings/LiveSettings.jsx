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
 * that field is left empty.
 *
 * A factory gets the same: org name, the owner's email (factory_profiles has
 * no email column), its location, and its real pending invitations. Its
 * Earnings tab lists the payout accounts brands are told to pay into; Billing
 * is always empty, since no card or account is stored for platform charges.
 * "+ Add payment method" on Earnings opens the existing Payout details page.
 * The factory's copy (RFQ wording, "Trading company account") follows
 * factory-prototype.html's own Settings screen.
 *
 * Password and notification preferences are drawn against nothing and are
 * left exactly as drawn.
 */
import React, { useCallback, useEffect, useState } from "react";
import { SettingsScreen, factoryAccountPermissionLabels, settingsPermissionLabels } from "../../prototype/main.jsx";
import { inviteMember, listMembers, listPendingInvitations } from "../../lib/domain/org.js";
import { listPayoutAccounts } from "../../lib/domain/payment.js";
import { useRouter } from "../../lib/router.jsx";
import { getBrandProfile, getFactoryProfile } from "../../lib/domain/profile.js";

/** "Sent today", "Sent yesterday", "Sent Oct 3", like the drawn rows. */
function sentLabel(createdAt) {
  const sent = new Date(createdAt);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(sent).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Sent today";
  if (days === 1) return "Sent yesterday";
  return `Sent ${sent.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** "Demo Bank ending in 0000", like the drawn "Bank account ending in 1184". */
function payoutName(account) {
  const bank = account.bank_name || account.label || account.account_name || "Bank account";
  return account.account_number_last4 ? `${bank} ending in ${account.account_number_last4}` : bank;
}

export default function LiveSettings({ org, isFactory }) {
  const { navigate } = useRouter();
  const [members, setMembers] = useState(null);
  const [profile, setProfile] = useState(null);
  const [invites, setInvites] = useState([]);
  const [payoutAccounts, setPayoutAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [loadedMembers, loadedProfile, loadedInvites, loadedPayouts] = await Promise.all([
        listMembers(org.id),
        isFactory ? getFactoryProfile(org.id) : getBrandProfile(org.id),
        listPendingInvitations(org.id),
        isFactory ? listPayoutAccounts(org.id) : [],
      ]);
      setProfile(loadedProfile);
      setInvites(loadedInvites);
      setPayoutAccounts(loadedPayouts);
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
  const permissionLabels = isFactory ? factoryAccountPermissionLabels : settingsPermissionLabels;
  const team = (members ?? []).map((member) => ({
    name: member.user_profiles?.full_name ?? member.user_profiles?.email ?? "Member",
    email: member.user_profiles?.email ?? "",
    role: member.role === "owner" ? "Owner" : "Member",
    permissions: member.role === "owner" ? permissionLabels.map((item) => item.key) : [],
  }));

  const owner = (members ?? []).find((member) => member.role === "owner");
  const ownerEmail = owner?.user_profiles?.email ?? "";
  const live = {
    account: isFactory
      ? {
          name: org.name ?? "",
          email: ownerEmail,
          phone: "",
          location: profile?.location ?? "",
        }
      : {
          name: org.name ?? "",
          email: profile?.business_email || ownerEmail,
          phone: "",
          location: profile?.hq_location ?? "",
        },
    paymentMethods: isFactory
      ? {
          earnings: payoutAccounts.map((account) => ({
            label: account.is_primary ? "Primary" : "Secondary",
            name: payoutName(account),
            note: account.is_primary ? "Receives released milestone funds from brand orders." : "Backup account for receiving earnings.",
          })),
          billing: [],
        }
      : [],
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
      companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
      onAddPaymentMethod={isFactory ? () => navigate("/payout") : undefined}
      team={team}
      {...live}
      onInvite={invite}
      busy={busy}
      error={error}
    />
  );
}
