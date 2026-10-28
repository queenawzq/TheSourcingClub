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
 * The team is per person (team_permissions migration): an owner holds every
 * authority and ticks what each member may do; Settings access invites and
 * runs this page (cards, credits, the email switches, the company's
 * details); where money is paid out stays with owners. Each control is
 * offered only to someone the database will allow, and a refusal is said in
 * words. Removing someone or making them an owner asks first, in the
 * design's dialog frame (the design has no confirmation for either).
 *
 * The factory's copy (RFQ wording, "Trading company account") follows
 * factory-prototype.html's own Settings screen.
 *
 * Password is drawn against nothing and is left exactly as drawn. The email
 * switches are the company's (notification_preferences), loaded on their own
 * so that a failure there does not blank the page.
 */
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SettingsScreen, factoryAccountPermissionLabels, settingsPermissionLabels } from "../../prototype/main.jsx";
import {
  can, getCompanyBasics, inviteMember, listMembers, listPendingInvitations, permissionLabel, removeMember,
  resendInvitation, revokeInvitation, saveCompanyBasics, setMemberAccess, setMemberRole, teamInviteNotice,
} from "../../lib/domain/org.js";
import { useAuth } from "../../lib/auth.jsx";
import { listPayoutAccounts } from "../../lib/domain/payment.js";
import { connectAccountFor, connectAction, listSavedCards, removeSavedCard, startBillingSetup } from "../../lib/domain/stripe.js";
import { getBrandProfile, getFactoryProfile } from "../../lib/domain/profile.js";
import { getNotificationEmails, setNotificationEmail } from "../../lib/domain/notification-preferences.js";
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

// What each email switch covers (notification_email_category), since the
// designed labels name only part of it. Every member with an email gets them,
// whatever their permissions.
const EVERY_MEMBER = "Emails every member of your company.";
const SHARED_EMAIL_NOTES = {
  payments: `Payments, steps to approve, steps due soon and changes to your orders. ${EVERY_MEMBER}`,
  messages: `New messages (at most one email per conversation every 6 hours) and call invites. ${EVERY_MEMBER}`,
};
const FACTORY_EMAIL_NOTES = {
  rfq: `Requests that match you or invite you, decisions on your quotes, and capacity reminders. ${EVERY_MEMBER}`,
  ...SHARED_EMAIL_NOTES,
};
const BRAND_EMAIL_NOTES = {
  rfq: `Quotes sent or withdrawn on your requests. ${EVERY_MEMBER}`,
  ...SHARED_EMAIL_NOTES,
};

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
  const { user, refreshOrgs } = useAuth();
  const [members, setMembers] = useState(null);
  const [basics, setBasics] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saveNote, setSaveNote] = useState("");
  const [confirming, setConfirming] = useState(null);
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
  const [notificationEmails, setNotificationEmails] = useState(null);
  const [notificationEmailsError, setNotificationEmailsError] = useState(null);

  // A site with no Stripe keys has no saved cards to show; any other failure
  // is said, since an empty list would claim nothing is saved.
  const loadCards = useCallback(() => listSavedCards(org.id).then(setCards, (failure) => {
    setCards([]);
    if (failure.status !== 503) setError(failure);
  }), [org.id]);

  // The email switches load on their own: a failure there is said in their
  // section, and the rest of Settings still renders.
  const loadNotificationEmails = useCallback(() => getNotificationEmails(org.id).then((loaded) => {
    setNotificationEmails(loaded);
    setNotificationEmailsError(null);
  }, setNotificationEmailsError), [org.id]);

  useEffect(() => { loadNotificationEmails(); }, [loadNotificationEmails]);

  const reload = useCallback(async () => {
    try {
      const [loadedMembers, loadedProfile, loadedInvites, loadedBasics] = await Promise.all([
        listMembers(org.id),
        isFactory ? getFactoryProfile(org.id) : getBrandProfile(org.id),
        // Invitations are Settings access's to see; RLS returns none to
        // anyone else, and the screen says why.
        listPendingInvitations(org.id),
        getCompanyBasics(org.id).catch(() => null),
      ]);
      setProfile(loadedProfile);
      setInvites(loadedInvites);
      setBasics(loadedBasics);
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
            label: method.default ? "Default" : method.payoutsFor ? `For ${method.payoutsFor.toUpperCase()} payouts` : method.type === "card" ? "Payout card" : "Bank account",
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

  // The drawer stays open on a refusal (false), with the reason in it.
  async function invite({ email, name, title, permissions }) {
    setBusy(true);
    setError(null);
    try {
      const result = await inviteMember(org.id, email, { name, title, permissions });
      setNotice(teamInviteNotice(result, email.toLowerCase()));
      await reload();
      return true;
    } catch (failure) {
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // A team change, then everything it touches read again. The person's own
  // row may have changed, so their permissions are re-read too.
  async function teamChange(run, done) {
    setBusy(true);
    setNotice(null);
    try {
      await run();
      await reload();
      await refreshOrgs();
      if (done) setNotice(done);
      return null;
    } catch (failure) {
      return failure;
    } finally {
      setBusy(false);
    }
  }

  async function changePermission(member, key, checked) {
    const next = checked
      ? Array.from(new Set([...member.stored, key]))
      : member.stored.filter((item) => item !== key);
    const label = permissionLabel(key, isFactory ? "factory" : "brand");
    const failure = await teamChange(
      () => setMemberAccess(org.id, member.id, next, member.title),
      checked ? `${member.name} now has ${label}.` : `${member.name} no longer has ${label}.`,
    );
    if (failure) setNotice(failure.message);
  }

  async function resend(invitation) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(teamInviteNotice(await resendInvitation(invitation.id), invitation.email));
      await reload();
    } catch (failure) {
      setNotice(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveBasics(values) {
    setBusy(true);
    setSaveNote("");
    try {
      await saveCompanyBasics(org.id, values);
      await reload();
      setSaveNote("Saved.");
    } catch (failure) {
      setSaveNote(failure.message);
    } finally {
      setBusy(false);
    }
  }

  // What each confirmation says and does. Its error stays in the dialog.
  async function confirm() {
    const { kind, member, invitation } = confirming;
    const failure = await teamChange(
      kind === "remove" ? () => removeMember(org.id, member.id)
        : kind === "leave" ? () => removeMember(org.id, member.id)
          : kind === "role" ? () => setMemberRole(org.id, member.id, member.isOwnerRow ? "member" : "owner")
            : () => revokeInvitation(invitation.id),
      kind === "remove" ? `${member.name} no longer has access to ${org.name}.`
        : kind === "role" ? (member.isOwnerRow ? `${member.name} is now a member.` : `${member.name} is now an owner.`)
          : kind === "revoke" ? `The invitation to ${invitation.email} was withdrawn.` : null,
    );
    if (failure) setConfirming((current) => ({ ...current, error: failure.message }));
    else setConfirming(null);
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
   * The designed team rows, keyed by person (two people can share a name).
   *
   * An owner holds every authority, so its boxes are ticked and locked; only
   * Primary contact, which names a person rather than granting anything, can
   * move to or from an owner. Only an owner changes anyone's boxes.
   */
  const permissionLabels = isFactory ? factoryAccountPermissionLabels : settingsPermissionLabels;
  const isOwner = org.role === "owner";
  const canSettings = can(org, "settingsAccess");
  const ownerCount = (members ?? []).filter((member) => member.role === "owner").length;
  const allKeys = permissionLabels.map((item) => item.key);
  const team = (members ?? []).map((member) => {
    const isOwnerRow = member.role === "owner";
    const isMe = member.user_id === user?.id;
    const lastOwner = isOwnerRow && ownerCount <= 1;
    const stored = member.permissions ?? [];
    const name = member.user_profiles?.full_name || member.user_profiles?.email || "Member";
    return {
      id: member.user_id,
      name,
      title: member.title ?? null,
      isOwnerRow,
      stored,
      email: member.user_profiles?.email ?? "",
      role: isOwnerRow ? (member.title ? `Owner · ${member.title}` : "Owner") : member.title || "Member",
      permissions: isOwnerRow
        ? allKeys.filter((key) => key !== "primaryContact" || stored.includes("primaryContact"))
        : stored,
      lockedPermissions: !isOwner ? allKeys : isOwnerRow ? allKeys.filter((key) => key !== "primaryContact") : [],
      removable: isMe ? !lastOwner : isOwner && !lastOwner,
      removeLabel: isMe ? `Leave ${org.name}` : `Remove ${name}`,
      roleActionLabel: isOwner ? (isOwnerRow ? (lastOwner ? null : "Make member") : "Make owner") : null,
    };
  });

  const owner = (members ?? []).find((member) => member.role === "owner");
  const ownerEmail = owner?.user_profiles?.email ?? "";
  const live = {
    account: isFactory
      ? {
          name: org.name ?? "",
          email: basics?.email || ownerEmail,
          phone: basics?.phone ?? "",
          location: profile?.location ?? "",
        }
      : {
          name: org.name ?? "",
          email: basics?.email || profile?.business_email || ownerEmail,
          phone: basics?.phone ?? "",
          location: profile?.hq_location ?? "",
        },
    paymentMethods: isFactory
      ? {
          earnings: payoutMethods,
          billing: cards.map(cardRow),
        }
      : cards.map(cardRow),
    invites: invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.title || (invite.role === "owner" ? "Owner" : "Member"),
      sent: invite.emailed_at ? sentLabel(invite.emailed_at) : `Saved ${sentLabel(invite.created_at).replace(/^Sent /, "").toLowerCase()}, not emailed`,
      canResend: canSettings,
      canRevoke: canSettings,
    })),
  };
  // What a new invitation may carry: only what the inviter holds, and never
  // Primary contact (chosen among people already on the team).
  const grantablePermissions = allKeys.filter((key) => key !== "primaryContact" && can(org, key));

  if (!members) return error ? <p className="shell-note" role="alert">{error.message ?? String(error)}</p> : null;

  const openPayoutFlow = (action) => setPayoutFlow({ action, id: Date.now() });
  const settingsOnly = canSettings ? "" : " Only someone with Settings access can change this.";
  const emailNotes = Object.fromEntries(Object.entries(isFactory ? FACTORY_EMAIL_NOTES : BRAND_EMAIL_NOTES)
    .map(([key, text]) => [key, text + settingsOnly]));

  // The switch moves at once; a refused save puts it back and says why.
  async function changeNotificationEmail(category, enabled) {
    const before = notificationEmails;
    setNotificationEmails({ ...before, [category]: enabled });
    setNotificationEmailsError(null);
    try {
      setNotificationEmails(await setNotificationEmail(org.id, category, enabled));
    } catch (problem) {
      setNotificationEmails(before);
      setNotificationEmailsError(problem);
    }
  }

  return (
    <>
      <SettingsScreen
        accountType={isFactory ? "factory" : "brand"}
        permissionsNote={[
          isOwner ? "Owners can do everything; tick what each member may do." : "Only an owner changes what people may do.",
          canSettings ? "" : "Only someone with Settings access invites people and sees invitations.",
        ].filter(Boolean).join(" ")}
        companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
        // Where a factory is paid stays with its owners.
        onAddPaymentMethod={isFactory && isOwner ? () => openPayoutFlow("manage") : undefined}
        onAddBillingMethod={canSettings ? addBillingMethod : undefined}
        onRemoveBillingMethod={canSettings ? removeCard : undefined}
        billingMethodNote={canSettings ? "" : `Only someone with Settings access at ${org.name || "your company"} can add or remove payment methods.`}
        onEditPaymentMethod={isFactory && isOwner ? () => openPayoutFlow("edit") : undefined}
        onDeletePaymentMethod={isFactory && isOwner ? () => openPayoutFlow("remove") : undefined}
        team={team}
        {...live}
        onInvite={invite}
        canInvite={canSettings}
        grantablePermissions={grantablePermissions}
        onPermissionChange={changePermission}
        onRoleChange={(member) => setConfirming({ kind: "role", member })}
        onRemove={(member) => member && setConfirming({ kind: member.id === user?.id ? "leave" : "remove", member })}
        onResend={resend}
        onRevoke={(invitation) => setConfirming({ kind: "revoke", invitation })}
        onSave={canSettings ? saveBasics : undefined}
        accountLocked={!canSettings}
        saveNote={saveNote || (canSettings ? "" : "Only someone with Settings access can change these details.")}
        notificationEmails={notificationEmails ?? undefined}
        onNotificationEmailChange={canSettings ? changeNotificationEmail : undefined}
        notificationEmailNotes={emailNotes}
        notificationEmailsError={notificationEmailsError}
        busy={busy || billingBusy}
        error={error}
        onSignOut={onSignOut}
      />
      {isFactory && payoutFlow ? (
        <StripePayoutCard
          key={payoutFlow.id}
          org={org}
          isOwner={isOwner}
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
      {notice ? (
        <div className="tsc-team-notices" role="status">
          <div className="tsc-team-notice">
            <p>{notice}</p>
            <div className="tsc-team-notice-actions">
              <button type="button" className="quiet-btn" onClick={() => setNotice(null)}>OK</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirming ? createPortal(<TeamConfirm confirming={confirming} org={org} busy={busy} onCancel={() => setConfirming(null)} onConfirm={confirm} />, document.body) : null}
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

/**
 * Asking before a team change that takes something away or hands over the
 * company. Not in the design; the design's dialog frame (approve-fund-modal).
 */
function TeamConfirm({ confirming, org, busy, onCancel, onConfirm }) {
  const { kind, member, invitation, error } = confirming;
  const copy = {
    remove: {
      title: `Remove ${member?.name}?`,
      body: `They lose access to ${org.name} at once, including any page they have open. Everything they worked on (requests, quotes, orders, messages and files) stays with the company.`,
      action: "Remove",
    },
    leave: {
      title: `Leave ${org.name}?`,
      body: `You lose access at once. Everything you worked on stays with the company. To come back, an owner has to invite you again.`,
      action: "Leave company",
    },
    role: member?.isOwnerRow
      ? {
          title: `Make ${member?.name} a member?`,
          body: `They keep ${org.type === "factory" ? "Add update" : "Approve samples"}, and Primary contact if they hold it; an owner can give them more afterwards.`,
          action: "Make member",
        }
      : {
          title: `Make ${member?.name} an owner?`,
          body: `An owner can do everything at ${org.name}: pay and release funds, choose quotes, change payouts, and add or remove people, owners included.`,
          action: "Make owner",
        },
    revoke: {
      title: "Withdraw this invitation?",
      body: `${invitation?.email} will no longer be able to join with it. You can invite them again later.`,
      action: "Withdraw",
    },
  }[kind];

  return (
    <div className="approve-fund-modal-layer" role="presentation">
      <button className="approve-fund-modal-scrim" type="button" aria-label="Close" disabled={busy} onClick={onCancel} />
      <section className="approve-fund-modal tsc-team-confirm" role="dialog" aria-modal="true" aria-labelledby="tsc-team-confirm-title">
        <header><div><h2 id="tsc-team-confirm-title">{copy.title}</h2></div></header>
        <p>{copy.body}</p>
        {error ? <p className="tsc-team-notice-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="secondary-btn" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="primary-btn" disabled={busy} onClick={onConfirm} data-testid="confirm-team-change">
            {busy ? "Working…" : copy.action}
          </button>
        </footer>
      </section>
    </div>
  );
}
