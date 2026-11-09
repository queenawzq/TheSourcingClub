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
  can, inviteMember, permissionHint, listMembers, listPendingInvitations, permissionLabel, removeMember,
  resendInvitation, revokeInvitation, setMemberAccess, setMemberRole, teamError, teamInviteNotice,
} from "../../lib/domain/org.js";
import { MIN_PASSWORD_LENGTH, useAuth } from "../../lib/auth.jsx";
import { useManualPayouts } from "../order/use-manual-payouts.js";
import { connectAccountFor, connectAction, listSavedCards, removeSavedCard, startBillingSetup } from "../../lib/domain/stripe.js";
import { countryCodeFrom, getBrandProfile, getFactoryProfile, saveFactoryProfile } from "../../lib/domain/profile.js";
import { listTerms } from "../../lib/domain/taxonomy.js";
import { getNotificationEmails, setNotificationEmail } from "../../lib/domain/notification-preferences.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import StripePayoutCard, { payoutRemovalError } from "../order/StripePayoutCard.jsx";
import { BillingMethodFlow } from "../order/PayoutDetails.jsx";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

// The email switches' labels say enough: the design's line under each is left out.
const EMAIL_NOTES = { rfq: "", payments: "", messages: "" };

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
  const [savedAccount, setSavedAccount] = useState(null);
  const [members, setMembers] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [profile, setProfile] = useState(null);
  const [invites, setInvites] = useState([]);
  const [payoutMethods, setPayoutMethods] = useState([]);
  // The bank accounts staff pay where Stripe cannot (use-manual-payouts.js).
  const payouts = useManualPayouts(org.id);
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
      const [loadedMembers, loadedProfile, loadedInvites] = await Promise.all([
        listMembers(org.id),
        isFactory ? getFactoryProfile(org.id) : getBrandProfile(org.id),
        // Invitations are Settings access's to see; RLS returns none to
        // anyone else, and the screen says why.
        listPendingInvitations(org.id),
      ]);
      setProfile(loadedProfile);
      const company = unwrap(await supabase.from("orgs").select("name").eq("id", org.id).single(), "load account settings");
      const contact = unwrap(await supabase.from("company_contact_details").select("phone").eq("org_id", org.id).maybeSingle(), "load company contact");
      setSavedAccount({ name: company.name, phone: contact?.phone ?? "", location: (isFactory ? loadedProfile?.location : loadedProfile?.hq_location) ?? "" });
      setInvites(loadedInvites);
      setMembers(loadedMembers);
      loadCards();

      if (isFactory) {
        const [connectAccount, manualAccounts, preference] = await Promise.all([
          connectAccountFor(org.id).catch(() => null),
          payouts.load().catch(() => []),
          supabase.from("factory_payout_preferences").select("route").eq("org_id", org.id).maybeSingle(),
        ]);
        if (preference.error) throw new Error("Could not load the default withdrawal method. Try again.");
        const stripeDefault = preference.data?.route !== "manual" && connectAccount?.transfers_active;
        let stripeMethods = [];
        if (connectAccount?.transfers_active) {
          const balance = await connectAction(org.id, "balance").catch(() => null);
          const connected = balance?.methods ?? [];
          stripeMethods = connected.length ? connected.map((method) => ({
            id: method.id,
            label: method.default && stripeDefault ? "Default" : method.payoutsFor ? `For ${method.payoutsFor.toUpperCase()} payouts` : method.type === "card" ? "Debit card" : "Bank account",
            // The words Payments uses for this account; never a bank name as Stripe holds it.
            name: `${method.type === "card" ? "Debit card" : "Bank account"}${method.last4 ? ` ····${method.last4}` : ""}`,
            note: [method.currency?.toUpperCase(), method.country && (regionNames.of(method.country) ?? method.country)].filter(Boolean).join(" · "),
          })) : [{ label: stripeDefault ? "Default" : "Connected", name: "Withdrawal account" }];
        }
          setPayoutMethods([...stripeMethods, ...manualAccounts.map((account) => (account.method === "paypal" ? {
            id: account.id,
            label: account.is_primary && !stripeDefault ? "Default" : "PayPal",
            name: "PayPal",
            note: account.paypal_email,
          } : {
            id: account.id,
            label: account.is_primary && !stripeDefault ? "Default" : "Bank account",
            name: `${account.bank_name || "Bank account"}${account.account_number_last4 ? ` ending in ${account.account_number_last4}` : ""}`,
            note: account.number_changed_at ? "" : "Add the full account number",
          }))]);
      }
    } catch (failure) {
      setError(failure);
    }
  }, [org.id, isFactory, loadCards, payouts.load]);

  useEffect(() => { reload(); }, [reload]);

  // Someone else changed the team while this page is open: an invitation was
  // accepted or withdrawn, a teammate was removed or left, a co-owner changed
  // what someone may do. Only the team is read again, since the full reload
  // also asks Stripe. Deletes carry only the row's key and are not filtered, so
  // the handler checks the company. The slow re-read is for what sends no
  // event, an invitation expiring, and for a dropped connection.
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let latest = 0;
    const reread = async () => {
      const seq = ++latest;
      const loaded = await Promise.all([listMembers(org.id), listPendingInvitations(org.id)]).catch(() => null);
      if (cancelled || seq !== latest || !loaded) return;
      setMembers(loaded[0]);
      setInvites(loaded[1]);
    };
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reread, 300);
    };
    const channel = supabase
      .channel(`team:${org.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "org_members", filter: `org_id=eq.${org.id}` }, (change) => {
        if (change.eventType !== "DELETE" || !change.old?.org_id || change.old.org_id === org.id) soon();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "org_invitations", filter: `org_id=eq.${org.id}` }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "org_invitations", filter: `org_id=eq.${org.id}` }, soon)
      .subscribe();
    const slow = window.setInterval(() => { if (!document.hidden) reread(); }, 30000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(slow);
      supabase.removeChannel(channel);
    };
  }, [org.id]);

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

  // Settings' list is built from the accounts, so it is read again after a change.
  const savePayout = async (details) => { const row = await payouts.save(details); await reload(); return row; };
  const removePayout = async (account, promote) => { await payouts.remove(account, promote); await reload(); };
  const makePrimaryPayout = async (account) => { await payouts.makePrimary(account); await reload(); };


  // A person's own password: no company permission gates it. Signing in again
  // is how the current one is checked, since the project doesn't require it on
  // the update itself (secure_password_change is off).
  async function changePassword({ current, next }) {
    if (!current || !next) throw new Error("Enter your current password and a new one.");
    if (next.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    const { error: wrong } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
    if (wrong) {
      throw new Error(wrong.code === "invalid_credentials" ? "Your current password isn't right." : "We could not check your password. Try again.");
    }
    const { error: refused } = await supabase.auth.updateUser({ password: next });
    if (refused) {
      throw new Error(refused.code === "same_password" ? "That is already your password. Choose a different one." : "We could not change your password. Try again.");
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
      lockedReason: !isOwner ? "Only an owner changes what people may do" : "An owner holds every permission",
      removable: isMe ? !lastOwner : isOwner && !lastOwner,
      removeLabel: isMe ? `Leave ${org.name}` : `Remove ${name}`,
      removeLockedReason: lastOwner ? "A company always keeps at least one owner" : "Only an owner can remove someone",
      roleActionLabel: isOwner ? (isOwnerRow ? (lastOwner ? null : "Make member") : "Make owner") : null,
    };
  });

  const owner = (members ?? []).find((member) => member.role === "owner");
  const ownerEmail = owner?.user_profiles?.email ?? "";
  const live = {
    account: savedAccount ? { ...savedAccount, email: isFactory ? ownerEmail : profile?.business_email || ownerEmail } : isFactory
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

  const openPayoutFlow = (action, methodId = null) => setPayoutFlow({ action, methodId, id: Date.now() });

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
        permissionsNote={isOwner ? null : ""}
        onSaveAccount={canSettings ? async (details) => {
          // A non-owner's save never carries the name: their copy goes stale
          // when an owner renames the company, and null means "leave it".
          const { data: result, error: refused } = await supabase.rpc("save_account_settings", { target_org: org.id, account_name: isOwner ? details.name : null, phone: details.phone, location: details.location });
          if (refused) throw new Error(refused.code === "22023" ? refused.message : teamError(refused, "save these details"));
          setSavedAccount(result);
          // The country Browse filters on and matching compares follows the
          // location, the same reading as the profile dialog and onboarding.
          if (isFactory) {
            try {
              const code = countryCodeFrom(details.location, await listTerms("country"));
              if (code) await saveFactoryProfile(org.id, { country_code: code });
            } catch {
              throw new Error("Your details were saved, but the country could not be updated. Save again to retry.");
            }
          }
          await refreshOrgs();
        } : undefined}
        companyType={profile?.vendor_kind === "trading_company" ? "trading" : "factory"}
        // Where a factory is paid stays with its owners.
        onAddPaymentMethod={isFactory && isOwner ? () => openPayoutFlow("manage") : undefined}
        onAddBillingMethod={canSettings ? addBillingMethod : undefined}
        onRemoveBillingMethod={canSettings ? removeCard : undefined}
        billingLocked={canSettings ? "" : permissionHint(org, "settingsAccess")}
        paymentLocked={isFactory && !isOwner ? "Only an owner can set up or change payouts" : ""}
        inviteLocked={canSettings ? "" : permissionHint(org, "settingsAccess")}
        saveLocked={canSettings ? "" : permissionHint(org, "settingsAccess")}
        notificationEmailsLocked={canSettings ? "" : permissionHint(org, "settingsAccess")}
        onEditPaymentMethod={isFactory && isOwner ? (method) => openPayoutFlow("edit", method?.id) : undefined}
        onDeletePaymentMethod={isFactory && isOwner ? (method) => openPayoutFlow("remove", method?.id) : undefined}
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
        accountLocked={!canSettings}
        onChangePassword={changePassword}
        nameLocked={!isOwner}
        notificationEmails={notificationEmails ?? undefined}
        onNotificationEmailChange={canSettings ? changeNotificationEmail : undefined}
        notificationEmailNotes={EMAIL_NOTES}
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
          initialMethodId={payoutFlow.methodId}
          onFlowClose={() => { setPayoutFlow(null); payouts.clearSaved(); }}
          manualAccount={payouts.primary}
          manualAccounts={payouts.accounts ?? []}
          manualEditingId={payouts.editingId}
          onStartManual={payouts.startEdit}
          onMakePrimaryManual={makePrimaryPayout}
          manualForm={payouts.form}
          onManualFieldChange={payouts.setField}
          onSavePaypal={async () => { const row = await payouts.savePaypal(); await reload(); return row; }}
          onSaveWise={async (details) => { const row = await payouts.saveWise(details); await reload(); return row; }}
          onSaveManual={savePayout}
          onDeleteManual={removePayout}
          manualBusy={payouts.busy}
          manualSaved={payouts.saved}
          manualOwed={payouts.owed}
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
          intro={undefined}
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
