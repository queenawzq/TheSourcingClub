/**
 * Settings, on Queena's designed screen.
 *
 * `SettingsScreen` is imported from src/prototype/main.jsx and mounted here.
 * This file is the seam: it supplies the real team and turns the invite panel
 * and the remove control into the calls that back them.
 *
 * For a brand it also supplies the real account details (org name, business
 * email, HQ location from brand_profiles), the real pending invitations, and
 * the cards saved to the company: every payment saves its card, and "+ Add
 * payment method" saves one (Stripe, listed and removed through
 * api/stripe-cards). No phone number is stored anywhere, so that field is
 * left empty.
 *
 * A factory gets the same: org name, the owner's email (factory_profiles has
 * no email column), its location, and its real pending invitations. Payout
 * management and card setup reuse the Payments dialogs directly on this page,
 * so Settings never detours through the Payments route. Its Billing tab lists
 * the same saved cards.
 *
 * Only an owner may add or remove a card (stripe-billing-setup and
 * stripe-cards refuse anyone else), so a member is told that up front
 * instead of being offered buttons that can only fail.
 *
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
import { connectAccountFor, connectAction, listSavedCards, removeSavedCard, startBillingSetup } from "../../lib/domain/stripe.js";
import { getBrandProfile, getFactoryProfile } from "../../lib/domain/profile.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import StripePayoutCard from "../order/StripePayoutCard.jsx";
import { BillingMethodFlow } from "../order/PayoutDetails.jsx";

const PAYOUT_FIELDS = [
  ["bank_name", "Bank", "Your bank's name"],
  ["account_name", "Account name", "As it appears on the account"],
  ["account_number_last4", "Last 4 digits", "1234"],
  ["swift", "SWIFT / BIC", "8 or 11 characters"],
  ["iban", "IBAN", "Only if your bank uses one"],
];

const blankPayout = (row) => ({
  bank_name: row?.bank_name ?? "",
  account_name: row?.account_name ?? "",
  account_number_last4: row?.account_number_last4 ?? "",
  swift: row?.swift ?? "",
  iban: row?.iban ?? "",
  instructions: row?.instructions ?? "",
});

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** A saved card as the designed payment-method row draws it. */
const cardRow = (card) => ({
  id: card.id,
  label: "Saved card",
  name: `${card.brand} ending in ${card.last4}`,
  note: card.expMonth && card.expYear
    ? `Expires ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
    : "",
});

/** "Sent today", "Sent yesterday", "Sent Oct 3", like the drawn rows. */
function sentLabel(createdAt) {
  const sent = new Date(createdAt);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(sent).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Sent today";
  if (days === 1) return "Sent yesterday";
  return `Sent ${sent.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default function LiveSettings({ org, isFactory, onSignOut }) {
  const [members, setMembers] = useState(null);
  const [profile, setProfile] = useState(null);
  const [invites, setInvites] = useState([]);
  const [payoutMethods, setPayoutMethods] = useState([]);
  const [manualAccount, setManualAccount] = useState(null);
  const [manualForm, setManualForm] = useState(blankPayout());
  const [manualSaved, setManualSaved] = useState(false);
  const [payoutFlow, setPayoutFlow] = useState(null);
  const [billingSecret, setBillingSecret] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [cards, setCards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A site with no Stripe keys has no saved cards to show; any other failure
  // is said, since an empty list would claim nothing is saved.
  const loadCards = useCallback(() => listSavedCards(org.id).then(setCards, (failure) => {
    setCards([]);
    if (failure.status !== 503) setError(failure);
  }), [org.id]);

  const reload = useCallback(async () => {
    try {
      const [loadedMembers, loadedProfile, loadedInvites] = await Promise.all([
        listMembers(org.id),
        isFactory ? getFactoryProfile(org.id) : getBrandProfile(org.id),
        listPendingInvitations(org.id),
      ]);
      setProfile(loadedProfile);
      setInvites(loadedInvites);
      setMembers(loadedMembers);
      loadCards();

      if (isFactory) {
        const [connectAccount, manualAccounts] = await Promise.all([
          connectAccountFor(org.id).catch(() => null),
          listPayoutAccounts(org.id).catch(() => []),
        ]);
        const primaryManualAccount = manualAccounts[0] ?? null;
        setManualAccount(primaryManualAccount);
        setManualForm(blankPayout(primaryManualAccount));
        if (connectAccount?.transfers_active) {
          const balance = await connectAction(org.id, "balance").catch(() => null);
          const connected = balance?.methods ?? [];
          setPayoutMethods(connected.length ? connected.map((method) => ({
            label: method.default ? "Default" : method.type === "card" ? "Payout card" : "Bank account",
            name: `${method.type === "card" ? "Payout card" : "Bank account"}${method.last4 ? ` ending in ${method.last4}` : ""}`,
            note: [method.name, method.currency?.toUpperCase(), method.country && (regionNames.of(method.country) ?? method.country)].filter(Boolean).join(" · "),
          })) : [{ label: "Connected", name: "Payout account", note: "Managed securely through your connected payout account." }]);
        } else {
          setPayoutMethods(manualAccounts.map((account) => ({
            label: account.is_primary ? "Primary" : "Secondary",
            name: `${account.bank_name || "Bank account"}${account.account_number_last4 ? ` ending in ${account.account_number_last4}` : ""}`,
            note: "Manual bank transfer",
          })));
        }
      }
    } catch (failure) {
      setError(failure);
    }
  }, [org.id, isFactory, loadCards]);

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

  const setManualField = (key) => (event) => {
    setManualSaved(false);
    setManualForm((current) => ({ ...current, [key]: event.target.value }));
  };

  // The card passes the payout country it was set up for, which the form
  // itself has no field for.
  async function saveManualAccount(details = {}) {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        org_id: org.id,
        is_primary: true,
        ...Object.fromEntries(Object.entries(manualForm).map(([key, value]) => [key, value.trim() || null])),
        bank_country: "bank_country" in details ? details.bank_country : manualAccount?.bank_country ?? null,
      };
      const result = manualAccount?.id
        ? await supabase.from("factory_payout_accounts").update(payload).eq("id", manualAccount.id).select().single()
        : await supabase.from("factory_payout_accounts").insert(payload).select().single();
      const updated = unwrap(result, "save your payout account");
      setManualAccount(updated);
      setManualForm(blankPayout(updated));
      setManualSaved(true);
      await reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function deleteManualAccount() {
    if (!manualAccount?.id) return;
    setBusy(true);
    setError(null);
    try {
      unwrap(await supabase.from("factory_payout_accounts").delete().eq("id", manualAccount.id), "remove your payout account");
      setManualAccount(null);
      setManualForm(blankPayout());
      setManualSaved(false);
      await reload();
    } catch (failure) {
      setError(failure);
      throw failure;
    } finally {
      setBusy(false);
    }
  }

  async function removeCard(method) {
    setBillingBusy(true);
    setError(null);
    try {
      await removeSavedCard(org.id, method.id);
      await loadCards();
    } catch (failure) {
      setError(failure);
    } finally {
      setBillingBusy(false);
    }
  }

  async function addBillingMethod() {
    setBillingBusy(true);
    setError(null);
    try {
      const result = await startBillingSetup(org.id);
      setBillingSecret(result.clientSecret);
    } catch (failure) {
      setError(failure);
    } finally {
      setBillingBusy(false);
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
          earnings: payoutMethods,
          billing: cards.map(cardRow),
        }
      : cards.map(cardRow),
    invites: invites.map((invite) => ({
      email: invite.email,
      role: invite.role === "owner" ? "Owner" : "Member",
      sent: sentLabel(invite.created_at),
    })),
  };

  if (!members) return null;

  const openPayoutFlow = (action) => setPayoutFlow({ action, id: Date.now() });
  const isOwner = org.role === "owner";

  return (
    <>
      <SettingsScreen
        accountType={isFactory ? "factory" : "brand"}
        // What each role may do is decided in the database, not per person.
        permissionsNote={isFactory
          ? "Set by role for now: any member can send quotes and post updates; only an owner sets up payouts and buys credits. Per-person permissions aren't available yet."
          : "Set by role for now: only an owner chooses a quote, pays for a step and approves a step that releases money; members can do the rest. Per-person permissions aren't available yet."}
        companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
        onAddPaymentMethod={isFactory ? () => openPayoutFlow("manage") : undefined}
        onAddBillingMethod={isOwner ? addBillingMethod : undefined}
        onRemoveBillingMethod={isOwner ? removeCard : undefined}
        billingMethodNote={isOwner ? "" : `Only an owner of ${org.name || "your company"} can add or remove payment methods.`}
        onEditPaymentMethod={isFactory ? () => openPayoutFlow("edit") : undefined}
        onDeletePaymentMethod={isFactory ? () => openPayoutFlow("remove") : undefined}
        team={team}
        {...live}
        onInvite={invite}
        busy={busy || billingBusy}
        error={error}
        onSignOut={onSignOut}
      />
      {isFactory && payoutFlow ? (
        <StripePayoutCard
          key={payoutFlow.id}
          org={org}
          isOwner
          renderCard={false}
          initialAction={payoutFlow.action}
          onFlowClose={() => { setPayoutFlow(null); setManualSaved(false); }}
          manualAccount={manualAccount}
          manualForm={manualForm}
          manualFields={PAYOUT_FIELDS}
          onManualFieldChange={setManualField}
          onSaveManual={saveManualAccount}
          onDeleteManual={deleteManualAccount}
          manualBusy={busy}
          manualSaved={manualSaved}
        />
      ) : null}
      {billingSecret ? (
        <BillingMethodFlow
          clientSecret={billingSecret}
          intro={isFactory ? undefined : "Save a card to use when funding production milestones."}
          onClose={() => setBillingSecret(null)}
          onSaved={() => { setBillingSecret(null); loadCards(); }}
        />
      ) : null}
    </>
  );
}
