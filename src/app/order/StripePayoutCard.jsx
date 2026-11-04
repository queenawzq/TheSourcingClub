import { balanceCurrency } from "../../lib/payout-currency.mjs";
import { payoutUsdTotal } from "../../lib/payout-display.mjs";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { connectAccountFor, connectAction } from "../../lib/domain/stripe.js";
import { PAYOUT_COUNTRIES } from "../../shared/stripe-payout-countries.mjs";
import PaymentHelp, { PENDING_HELP } from "./PaymentHelp.jsx";
import StripeConnectEmbed from "./StripeConnectEmbed.jsx";
import AddPayoutMethodForm from "./AddPayoutMethodForm.jsx";
import { payoneerEmail, validPayoneerEmail } from "./use-manual-payouts.js";

const OTHER_COUNTRIES = ["CN", "HK", "TW", "VN", "IN", "BD", "PK", "TR", "ID", "TH", "KH", "LK", "KR", "JP", "MX", "BR", "MA", "EG"];
const names = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = [...new Set([...PAYOUT_COUNTRIES, ...OTHER_COUNTRIES])]
  .map((code) => ({ code, name: names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));
// A country missing from the list is paid by bank, like any Stripe cannot
// reach. It has no two-letter code, so its bank's country goes in the
// instructions and bank_country stays empty.
const NOT_LISTED = "other";

const countryName = (code) => (code && code !== NOT_LISTED ? names.of(code) ?? code : "");

const OPERATIONS_EMAIL = "operations@contact.sourcing-club.com";

// Said wherever Stripe's embedded forms open. They stay on this page and may
// show TSC's registered company name rather than The Sourcing Club. Only an
// Express account (made before 2026-10-30) also asks for a code in a small
// Stripe window, which it cannot turn off.
const STRIPE_FORM_NOTE = "Stripe, TSC's payment partner, securely verifies your company and bank details in its form on this page, and may show TSC's registered company name. TSC never stores those details.";
const EXPRESS_FORM_NOTE = "Stripe, TSC's payment partner, holds your company and bank details. It may ask you to confirm with a code in a small Stripe window, and may show TSC's registered company name.";

/** Where staff pay by bank, everything they need to pay it. */
/** A plain letter, not Payoneer's logo: using that needs their permission. */
const PAYONEER_MARK = <strong>P</strong>;

const manualComplete = (row) => isPayoneer(row) || Boolean(row?.bank_name?.trim() && row?.account_name?.trim());
const isPayoneer = (row) => row?.method === "payoneer";

function OperationsContact() {
  return (
    <>Before your first payout, TSC operations will email you from <a href={`mailto:${OPERATIONS_EMAIL}`}>{OPERATIONS_EMAIL}</a> to confirm the full transfer details.</>
  );
}

const SLOW_BALANCE_MS = 8000;
const BALANCE_STATUS_TEXT = {
  slow: "Stripe is taking longer than usual. Your balance will show here as soon as it answers.",
  failed: "We could not show your balance right now. Try again shortly.",
};

const amountIn = (rows, currency) => rows?.find((row) => row.currency?.toUpperCase() === currency)?.amount ?? 0;

/** When the earliest earning still pending at Stripe can be withdrawn, in the reader's words. */
function availableFrom(balance) {
  const first = Math.min(...(balance?.pendingEarnings ?? []).map((row) => Number(row.available_on)).filter(Boolean));
  return Number.isFinite(first)
    // Stripe's available_on is a day (midnight UTC), not an instant: read in
    // New York as an instant it is the day before.
    ? new Date(first * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : null;
}

/** "Bank account ending in 2345", the words the method list uses. */
function methodLabel(method) {
  return `${method.type === "card" ? "Debit card" : "Bank account"}${method.last4 ? ` ending in ${method.last4}` : ""}`;
}

const stripeDay = (unix) => new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Why a Stripe payout account cannot be removed now, in the factory's words,
 * or null. Stripe itself refuses to remove a currency's default account, so
 * where TSC manages the account another one becomes the default first, and
 * only the last one in its currency stays (the dialog offers Replace).
 */
function stripeRemovalRefusal(method, methods, payoutsOnTheirWay, managed) {
  const sameCurrency = methods.filter((other) => other.id !== method.id && other.currency === method.currency && other.standard !== false);
  if (methods.length <= 1) {
    return managed
      ? "Stripe keeps one payout method on file, so this one can be replaced but not removed. Your earnings stay in your balance until you withdraw them."
      : "This is your only payout account. Add another one first, so your earnings have somewhere to go.";
  }
  if ((method.default || method.payoutsFor) && (!managed || !sameCurrency.length)) {
    return managed
      ? `${methodLabel(method)} is your only ${method.currency?.toUpperCase() ?? ""} payout method, so it can be replaced but not removed. Your earnings stay in your balance until you withdraw them.`
      : `${methodLabel(method)} is your default ${method.payoutsFor ? `${method.payoutsFor.toUpperCase()} ` : ""}payout account. In Stripe’s form, make another account the default first, then remove this one.`;
  }
  const onItsWay = payoutsOnTheirWay.find((payout) => payout.destination === method.id);
  if (onItsWay) {
    return `A withdrawal of ${formatMoney(onItsWay.amount, onItsWay.currency.toUpperCase())} is on its way to this account${onItsWay.arrival_date ? ` (expected ${stripeDay(onItsWay.arrival_date)})` : ""}. You can remove it once it arrives.`;
  }
  return null;
}

/** What closing Stripe's form did, after an Add or a Remove. */
function handoverResult({ intent, target, before }, after) {
  if (intent === "add") {
    const added = after.filter((method) => !before.includes(method.id));
    return added.length
      ? `Added ${added.map((method) => methodLabel(method).toLowerCase()).join(" and ")}.`
      : "No payout account was added.";
  }
  return after.some((method) => method.id === target?.id)
    ? `${methodLabel(target)} is still there. Remove it under Payout details in Stripe’s form.`
    : `Removed ${methodLabel(target).toLowerCase()}.`;
}

/**
 * The database's refusal to remove a bank account TSC is about to pay
 * (20261029000300), in words with the amount; any other failure as it was.
 */
export function payoutRemovalError(failure) {
  if (failure?.cause?.hint === "payout_primary") return new Error(PRIMARY_REFUSAL);
  if (failure?.cause?.hint !== "payout_owed") return failure;
  const [cents, currency] = String(failure.cause.details ?? "").split(" ");
  return new Error(`${bankOwedSentence([{ amount: Number(cents) || 0, currency: currency || "USD" }])} You can change the details with Edit, but not remove the account until that payment is sent.`);
}

const PRIMARY_REFUSAL = "This is the account TSC pays. Choose another account for TSC to pay first, then remove this one.";

/** "TSC is about to pay $1,248.00 to this account." */
export function bankOwedSentence(owed) {
  const totals = new Map();
  for (const { amount, currency } of owed) totals.set(currency, (totals.get(currency) ?? 0) + Number(amount));
  return `TSC is about to pay ${[...totals].map(([currency, amount]) => formatMoney(amount, currency)).join(" and ")} to this account.`;
}

export function PayoutModal({ children, title, eyebrow, onClose, actions, wide = false }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className={`brand-profile-modal-layer payout-modal-layer${wide ? " tsc-connect-layer" : ""}`}>
      <button className="brand-profile-modal-scrim" type="button" aria-label="Close" onClick={onClose} />
      <section className={`brand-profile-modal payout-modal${wide ? " tsc-connect-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="payout-modal-title">
        <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        <header className="payout-modal-header">
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h2 id="payout-modal-title">{title}</h2>
        </header>
        <div className="payout-modal-body">{children}</div>
        <footer className="brand-profile-modal-actions payout-modal-actions">{actions}</footer>
      </section>
    </div>,
    document.body,
  );
}

/**
 * The payout card before anything about the factory's payouts is known. An
 * owner's has the two buttons' places, which stack under the balance on a
 * phone.
 */
export function PayoutCardPlaceholder({ isOwner = false }) {
  return (
    <section className="live-payout-method-card live-stripe-payout-card payout-card-placeholder" data-testid="payout-card-placeholder">
      <div className="live-payout-balance">
        <span className="payout-label-placeholder" aria-hidden="true" />
        <strong><span className="payout-balance-placeholder" role="status" aria-label="Loading payouts" /></strong>
        <p className="payout-balance-line payout-balance-placeholder-lines" aria-hidden="true"><span /><span /></p>
        <p className="payment-provider-note" aria-hidden="true"><span className="payout-note-placeholder" /></p>
      </div>
      {isOwner ? <div className="live-payout-card-action" aria-hidden="true"><span className="payout-button-placeholder" /><span className="payout-button-placeholder" /></div> : null}
    </section>
  );
}

export default function StripePayoutCard({
  org,
  isOwner,
  onBalanceChange,
  onBalanceStatus,
  onAccountKnown,
  manualAccount,
  manualAccounts = manualAccount ? [manualAccount] : [],
  manualEditingId = null,
  onStartManual,
  onMakePrimaryManual,
  manualForm,
  manualFields,
  onManualFieldChange,
  onManualMethodChange,
  onSaveManual,
  onDeleteManual,
  manualBusy,
  manualSaved,
  manualOwed = [],
  renderCard = true,
  initialAction = null,
  initialMethodId = null,
  onFlowClose,
}) {
  const [account, setAccount] = useState(undefined);
  const [balance, setBalance] = useState(null);
  // Where reading Stripe's balance stands: "loading", "slow" (still loading
  // after SLOW_BALANCE_MS), "failed", "ready", or "none" when it is not read
  // (not an owner, no active Stripe account). The card said "We could not
  // show your balance" for the two seconds a normal read takes.
  const [balanceStatus, setBalanceStatus] = useState("loading");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [methodMenu, setMethodMenu] = useState(null);
  const [withdrawal, setWithdrawal] = useState(null);
  const [withdrawn, setWithdrawn] = useState(false);
  // Remove and Add are TSC's own steps; Stripe's form does the last part,
  // since TSC cannot change an Express account's bank accounts itself.
  // `handover` remembers what the factory went there to do, so closing the
  // form can say whether it happened.
  const [removing, setRemoving] = useState(null);
  const [handover, setHandover] = useState(null);
  const [methodNotice, setMethodNotice] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  // TSC's own add and remove (an account TSC manages): which account a
  // Replace removes once the new one is added, which account becomes the
  // default when the default is removed, and a change still on its way.
  const [replacing, setReplacing] = useState(null);
  const [promoteId, setPromoteId] = useState(null);
  const [methodBusy, setMethodBusy] = useState(false);
  // A bank-paid factory may keep several bank accounts (John, 2026-10-29):
  // which one is being removed, and what the form or the list last refused.
  const [removingManual, setRemovingManual] = useState(null);
  const [manualError, setManualError] = useState(null);
  const handledInitialAction = useRef(false);
  const accountKnown = useRef(false);

  useEffect(() => {
    if (manualSaved) {
      setModal(null);
      onFlowClose?.();
    }
  }, [manualSaved, onFlowClose]);

  useEffect(() => {
    if (!methodMenu) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!event.target.closest(".payout-method-menu")) setMethodMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [methodMenu]);

  const manualCountry = manualAccount?.bank_country?.trim() || "";
  const load = useCallback(async () => {
    const [saved, { data: profile }] = await Promise.all([
      connectAccountFor(org.id),
      supabase.from("factory_profiles").select("country_code").eq("org_id", org.id).maybeSingle(),
    ]);
    setAccount(saved);
    accountKnown.current = true;
    setCountry((current) => current || saved?.country || manualCountry || profile?.country_code || "");
    if (saved && isOwner) {
      setBalanceStatus("loading");
      const nextBalance = await connectAction(org.id, "balance");
      setBalance(nextBalance);
      setBalanceStatus("ready");
      onBalanceChange?.(nextBalance);
      return nextBalance;
    }
    setBalance(null);
    setBalanceStatus("none");
    onBalanceChange?.(null);
    return null;
  }, [org.id, isOwner, onBalanceChange, manualCountry]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const back = params.get("stripe");
    const payoutAction = params.get("payoutAction");
    const clean = () => {
      params.delete("stripe");
      params.delete("payoutAction");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    };
    (async () => {
      // Stripe sends the factory to `refresh` when its setup link has
      // expired. Ask before going back, rather than bouncing it to Stripe.
      let resume = false;
      if (back && isOwner) {
        clean();
        if (back === "refresh") resume = true;
        else await connectAction(org.id, "refresh");
      }
      await load();
      if (resume) setModal("resume");
      if (payoutAction && isOwner) {
        clean();
        const saved = await connectAccountFor(org.id);
        // Stripe's dashboard opens from the list, where it says so.
        if (saved?.transfers_active) {
          setModal("manage");
        } else {
          if (payoutAction === "remove" && manualAccount) {
            setRemovingManual(manualAccount);
            setRemoveError(null);
            setModal("remove");
          } else {
            onStartManual?.(payoutAction === "add" ? null : manualAccount);
            setModal("setup");
          }
        }
      }
    })().catch((failure) => {
      // Once the account is known, a failure is the balance's, and the card
      // says so in its own sentence: Stripe's raw message (which names our
      // key, masked) is not for a factory. Before that, there is no sentence.
      if (!accountKnown.current) setError(failure);
      setAccount((current) => (current === undefined ? null : current));
      // The balance could not be read: say so, rather than "checking" forever.
      setBalanceStatus("failed");
      onBalanceChange?.(null);
    });
  }, [org.id, isOwner, load, manualAccount]);

  const supported = PAYOUT_COUNTRIES.has(country);
  const currency = balanceCurrency(balance);
  const available = amountIn(balance?.available, currency);
  const pending = amountIn(balance?.pending, currency);
  // Nothing to withdraw yet, but money on its way: that is the balance to
  // show, with the day it can be withdrawn, rather than a bare 0.00.
  const arriving = Boolean(balance) && available <= 0 && pending > 0;
  const recoveryCurrency = balanceCurrency(balance?.recovery);
  const recoveryAvailable = amountIn(balance?.recovery?.available, recoveryCurrency);
  const arrivesOn = availableFrom(balance);
  // A Stripe-paid owner whose balance is on its way from Stripe: the card
  // keeps its shape (a placeholder) until it arrives; a slow answer still
  // says so, and a failure says it failed.
  const balanceWaiting = !balance && isOwner && Boolean(account?.transfers_active)
    && (balanceStatus === "loading" || balanceStatus === "slow");
  const connectedMethods = balance?.methods ?? [];
  // Where TSC adds and removes payout accounts itself, rather than Stripe's form.
  const managed = Boolean(balance?.managedByTsc);
  useEffect(() => {
    if (balance && !balance.managedByTsc && (modal === "remove-stripe" || modal === "account")) setModal("upgrade");
  }, [balance, modal]);

  async function withdraw() {
    if (busy || !withdrawal) return;
    setBusy(true);
    setError(null);
    try {
      await connectAction(org.id, withdrawal.previous ? "withdraw_previous" : "withdraw", withdrawal);
      setWithdrawal(null);
      setModal(null);
      setWithdrawn(true);
      // Never leave an already-withdrawn amount available if refreshing fails.
      setBalance(null);
      onBalanceChange?.(undefined);
      await load();
    } catch (failure) {
      setError(failure);
      setBalanceStatus("failed");
      onBalanceChange?.(null);
    } finally {
      setBusy(false);
    }
  }
  // Stripe's embedded forms save as the factory goes, so closing one is
  // finishing it: read the account back (which also pays out anything owed
  // once transfers are on) and the payout methods with it.
  async function closeStripeForm() {
    setModal(null);
    onFlowClose?.();
    setError(null);
    // Not `busy`: the balance on screen stays usable while Stripe is read
    // back (several seconds), and Stripe refuses a withdrawal it cannot pay.
    try {
      // No account means the form never got as far as creating one.
      if (await connectAccountFor(org.id)) await connectAction(org.id, "refresh");
      const next = await load();
      if (handover) setMethodNotice(handoverResult(handover, next?.methods ?? []));
      setHandover(null);
    } catch (failure) {
      setError(failure);
      setBalanceStatus("failed");
    }
  }

  // The Payments page says the same under the figures that need Stripe.
  useEffect(() => {
    onBalanceStatus?.(balanceStatus);
  }, [balanceStatus, onBalanceStatus]);

  // Once the card knows how the factory is paid it has its final shape, and
  // the page can draw the figures below it without the card moving them.
  useEffect(() => {
    if (account !== undefined) onAccountKnown?.();
  }, [account, onAccountKnown]);

  // A read that is merely slow is not a failure: after a while, say so.
  useEffect(() => {
    if (balanceStatus !== "loading") return undefined;
    const timer = setTimeout(() => setBalanceStatus((current) => (current === "loading" ? "slow" : current)), SLOW_BALANCE_MS);
    return () => clearTimeout(timer);
  }, [balanceStatus]);

  useEffect(() => {
    if (account === undefined || !initialAction || handledInitialAction.current) return;
    handledInitialAction.current = true;
    const chosenManual = manualAccounts.find((row) => row.id === initialMethodId) ?? manualAccount;
    if (initialAction === "manage") {
      setModal(account || manualAccount ? "manage" : "setup");
    } else if (initialAction === "add") {
      // Add always adds: a bank-paid factory's new account never overwrites one.
      if (account?.transfers_active) setModal("add");
      else { onStartManual?.(null); setModal("setup"); }
    } else if (!account?.transfers_active && initialAction === "remove" && chosenManual) {
      setRemovingManual(chosenManual);
      setRemoveError(null);
      setModal("remove");
    } else if (!account?.transfers_active && initialAction === "edit") {
      onStartManual?.(chosenManual ?? null);
      setModal("setup");
    } else if (account?.transfers_active && initialAction === "remove" && initialMethodId) {
      // Settings' Remove on one account: straight to its removal dialog.
      setRemoving({ id: initialMethodId });
      setModal("remove-stripe");
    } else if (account?.transfers_active) {
      setModal("manage");
    } else {
      onStartManual?.(manualAccount ?? null);
      setModal("setup");
    }
  }, [account, initialAction, initialMethodId, manualAccount, manualAccounts, onStartManual]);

  // The card's shape while the account is read, so it does not appear late
  // and push the page down.
  if (account === undefined) return renderCard ? <PayoutCardPlaceholder isOwner={isOwner} /> : null;

  const closeModal = () => {
    if (!busy && !manualBusy) {
      setMethodMenu(null);
      setModal(null);
      onFlowClose?.();
    }
  };

  // Staff cannot pay a bank with no name, an account with no holder, or a
  // country nobody named; a country not listed is named in the instructions.
  const notListed = country === NOT_LISTED;
  const payoneerForm = manualForm?.method === "payoneer";
  const payoneerMismatch = payoneerForm && manualForm.payoneer_email_confirm
    && payoneerEmail(manualForm.payoneer_email) !== payoneerEmail(manualForm.payoneer_email_confirm);
  const manualReady = payoneerForm
    ? Boolean(country && validPayoneerEmail(manualForm.payoneer_email) && manualForm.payoneer_email_confirm && !payoneerMismatch)
    : Boolean(
      country
      && manualForm?.bank_name?.trim()
      && manualForm?.account_name?.trim()
      && (!notListed || manualForm?.instructions?.trim()),
    );

  const setupActions = (
    <>
      <button className="secondary-btn" type="button" onClick={closeModal}>Cancel</button>
      {supported ? (
        <button className="primary-btn" type="button" disabled={busy || !country} onClick={() => setModal("onboarding")}>Continue</button>
      ) : (
        <button className="primary-btn" type="button" data-testid="save-payout" disabled={manualBusy || !manualReady}
                onClick={() => saveManual({ bank_country: notListed ? null : country })}>
          {manualBusy ? "Saving…" : "Save payout method"}
        </button>
      )}
    </>
  );

  const manualRequired = new Set(["bank_name", "account_name"]);
  const editingManual = manualAccounts.find((row) => row.id === manualEditingId) ?? null;
  const payoneerFieldsContent = (
    <div className="payout-manual-fields">
      <div className="payout-form-grid">
        <label>
          <span>Payoneer account email (required)</span>
          <input type="email" autoComplete="off" data-field="payout_payoneer_email" value={manualForm?.payoneer_email ?? ""} required onChange={onManualFieldChange("payoneer_email")} placeholder="The email you sign in to Payoneer with" />
        </label>
        <label>
          <span>Re-enter the email (required)</span>
          <input type="email" autoComplete="off" data-field="payout_payoneer_email_confirm" value={manualForm?.payoneer_email_confirm ?? ""} required onChange={onManualFieldChange("payoneer_email_confirm")} />
        </label>
      </div>
      {payoneerMismatch ? <p className="live-stripe-error" role="alert">The two email addresses don't match.</p> : null}
      {manualForm?.payoneer_email && !validPayoneerEmail(manualForm.payoneer_email) ? <p className="payout-security-copy">Enter a valid email address for your Payoneer account.</p> : null}
      <p className="payout-security-copy">TSC pays your released earnings to this Payoneer account by hand, from TSC's Payoneer business account. TSC is not connected to your Payoneer account and never sees its sign-in or balance.</p>
    </div>
  );
  const manualFieldsContent = (
    <div className="payout-manual-fields">
      <div className="payout-form-grid">
        {manualFields.map(([key, label, placeholder]) => (
          <label key={key}>
            <span>{label}{manualRequired.has(key) ? " (required)" : ""}</span>
            <input data-field={`payout_${key}`} value={manualForm[key]} placeholder={placeholder} required={manualRequired.has(key)} onChange={onManualFieldChange(key)} />
          </label>
        ))}
      </div>
      <label className="payout-textarea-field">
        <span>{notListed ? "Bank country and transfer instructions (required)" : "Additional transfer instructions"}</span>
        <textarea data-field="payout_instructions" rows={3} value={manualForm.instructions} required={notListed} onChange={onManualFieldChange("instructions")}
                  placeholder={notListed ? "Your bank's country, and any intermediary bank" : "Intermediary bank or transfer instructions"} />
      </label>
      {!manualReady ? (
        <p className="payout-security-copy">Add the bank and the account name{notListed ? ", and name your bank's country," : ""} to save.</p>
      ) : null}
      <p className="payout-security-copy">For security, add only the last four digits of the account number here. <OperationsContact /></p>
    </div>
  );

  const providerMethodRows = connectedMethods.length ? connectedMethods : account?.transfers_active ? [{
    id: "connected-account",
    type: "bank_account",
    name: "Connected bank account",
    last4: "",
    currency: currency.toLowerCase(),
    default: true,
  }] : [];

  const openSecureManagement = () => {
    setHandover(null);
    setMethodNotice(null);
    setModal("account");
  };
  // Add or remove: TSC's dialog has done its part; Stripe's form does the rest.
  const handOver = (intent, target = null) => {
    setHandover({ intent, target, before: connectedMethods.map((method) => method.id) });
    setMethodNotice(null);
    setModal("account");
  };
  // Owed by bank only while Stripe is not the one paying this factory.
  const bankOwed = account?.transfers_active ? [] : manualOwed;
  // The account as Stripe lists it now (Settings passes only its id).
  const removingMethod = removing ? connectedMethods.find((method) => method.id === removing.id) ?? null : null;
  const removalRefusal = removingMethod
    ? stripeRemovalRefusal(removingMethod, connectedMethods, balance?.payoutsOnTheirWay ?? [], managed)
    : balance ? "That payout account is no longer listed. It may have been removed already." : null;

  // The accounts that could take over as the default from the one removed.
  const successors = removingMethod && managed && (removingMethod.default || removingMethod.payoutsFor)
    ? connectedMethods.filter((method) => method.id !== removingMethod.id && method.currency === removingMethod.currency && method.standard !== false)
    : [];
  const successor = successors.find((method) => method.id === promoteId) ?? successors[0] ?? null;

  // The route answers every change with the list as Stripe now holds it.
  const applyMethods = ({ methods, notice }) => {
    setBalance((current) => (current ? { ...current, methods } : current));
    if (notice) setMethodNotice(notice);
  };

  async function changeMethod(action, extra) {
    setMethodBusy(true);
    setRemoveError(null);
    try {
      applyMethods(await connectAction(org.id, action, extra));
      return true;
    } catch (failure) {
      setRemoveError(failure);
      return false;
    } finally {
      setMethodBusy(false);
    }
  }

  async function confirmStripeRemoval() {
    if (await changeMethod("remove_method", { methodId: removingMethod.id, promoteId: successor?.id })) {
      setRemoving(null);
      setModal("manage");
    }
  }

  const makeStripeDefault = (method) => {
    setMethodNotice(null);
    return changeMethod("default_method", { methodId: method.id });
  };

  // A new account is in (and, for a Replace, the old one out: the server
  // does both in one request).
  function methodAdded(result) {
    applyMethods(result);
    setReplacing(null);
    setModal("manage");
  }

  const startAdd = (kind) => {
    setMethodNotice(null);
    setRemoveError(null);
    if (managed) setModal(kind === "card" ? "add-card" : "add-bank");
    else setModal("upgrade");
  };

  async function startUpgrade() {
    setBusy(true);
    setRemoveError(null);
    try {
      await connectAction(org.id, "upgrade");
      setModal("upgrade-onboarding");
    } catch (failure) { setRemoveError(failure); }
    finally { setBusy(false); }
  }
  async function finishUpgrade() {
    setBusy(true);
    try {
      await connectAction(org.id, "refresh");
      await load();
      setModal("manage");
    } catch (failure) { setRemoveError(failure); }
    finally { setBusy(false); }
  }

  // Add (blank) or Edit (that account): the parent holds the form.
  const openManual = (row) => {
    setManualError(null);
    onStartManual?.(row);
    setModal("setup");
  };

  async function saveManual(details) {
    setManualError(null);
    try {
      await onSaveManual?.(details);
    } catch (failure) {
      setManualError(failure);
    }
  }

  async function makePrimary(row) {
    setManualError(null);
    try {
      await onMakePrimaryManual?.(row);
      setMethodNotice(`TSC now pays ${manualLabelInSentence(row)}.`);
    } catch (failure) {
      setManualError(failure);
    }
  }

  // Which bank account is being removed, and why it may not be yet.
  const otherManual = removingManual ? manualAccounts.filter((row) => row.id !== removingManual.id) : [];
  // The one TSC pays may go: another takes its place, or (the last one)
  // TSC holds the earnings. Only money TSC is sending to it now keeps it.
  const manualRemovalRefusal = !removingManual ? null
    : removingManual.is_primary && !otherManual.length && bankOwed.length ? `${bankOwedSentence(bankOwed)} You can change the details with Edit, but not remove the account until that payment is sent.`
    : null;
  const manualSuccessor = removingManual?.is_primary && otherManual.length
    ? otherManual.find((row) => row.id === promoteId) ?? otherManual[0]
    : null;
  const manualLabel = (row) => (isPayoneer(row) ? `Payoneer account ${row.payoneer_email}` : methodLabel({ type: "bank_account", last4: row.account_number_last4 }));
  // In a sentence. An email and the name Payoneer keep their case.
  const manualLabelInSentence = (row) => (isPayoneer(row) ? manualLabel(row) : manualLabel(row).toLowerCase());

  async function removeManualMethod() {
    setRemoveError(null);
    try {
      await onDeleteManual?.(removingManual, manualSuccessor);
      setModal(null);
      setMethodNotice("Payout method removed.");
    } catch (failure) {
      // Said in the dialog, where the factory is looking.
      setRemoveError(failure);
    }
  }

  return (
    <>
      {renderCard ? <section className="live-payout-method-card live-stripe-payout-card" data-testid="stripe-payout-card">
        <div className="live-payout-balance">
          {/* Paid by bank, the factory has no balance anywhere: TSC sends each
              released payment, so the card says how it is paid instead. */}
          <span className="payment-metric-label">{!account && manualAccount ? "Payouts" : arriving ? "Balance on its way (USD)" : "Available balance (USD)"}
            {arriving
              ? <PaymentHelp label="Balance on its way">{PENDING_HELP}</PaymentHelp>
              : <PaymentHelp label="Available balance">Money you can withdraw to your bank now. This is your overall balance across all clients.</PaymentHelp>}
          </span>
          <strong data-testid="payout-balance">{balance ? formatMoney(payoutUsdTotal(arriving ? balance.pending : balance.available, balance.displayFx), "USD")
            // A placeholder the size of the amount, so the card does not
            // jump when Stripe answers (a sentence said "checking" before).
            : balanceWaiting ? <span className="payout-balance-placeholder" role="status" aria-label="Loading balance" />
            : !account && manualAccount ? isPayoneer(manualAccount) ? "By Payoneer" : "By bank transfer" : "—"}</strong>
          {balanceStatus === "loading" && balanceWaiting ? (
            <p className="payout-balance-line payout-balance-placeholder-lines" aria-hidden="true"><span /><span /></p>
          ) : <p className={balance || balanceWaiting ? "payout-balance-line" : undefined}>{balance
            ? arriving
              // Orders are in USD; Stripe credits an account in its own currency.
              ? `Stripe is processing your earnings. You can withdraw them ${arrivesOn ? `from ${arrivesOn}` : "once processing finishes"}.${currency !== "USD" ? ` USD figures are estimates; withdrawals stay in ${currency}.` : ""}`
              : pending > 0
              ? <>{formatMoney(payoutUsdTotal(balance.pending, balance.displayFx), "USD")} pending <PaymentHelp label="Pending balance">{PENDING_HELP}</PaymentHelp></>
              : "Earnings stay in your balance until you withdraw them."
            // Only an owner reads the balance; for anyone else it is not "in progress".
            : account?.transfers_active
              // The account is known a moment before its balance arrives:
              // that is loading, and only a real failure says it failed.
              ? isOwner ? BALANCE_STATUS_TEXT[balanceStatus] ?? "" : "Only a company owner can view the withdrawable balance."
              : account?.details_submitted
                ? "Payout verification in progress"
                : account
                  ? isOwner ? "Finish setup to receive earnings." : "Payout setup on Stripe is not finished yet."
                  // Where Stripe cannot pay out, staff pay the saved bank account.
                  : isPayoneer(manualAccount)
                    ? <>Payoneer account {manualAccount.payoneer_email} on file. TSC pays your released earnings to it by hand, from TSC's Payoneer business account.</>
                  : manualAccount && manualComplete(manualAccount)
                    ? <>Bank details on file{manualAccount.account_number_last4 ? ` (account ending in ${manualAccount.account_number_last4})` : ""}. TSC pays your released earnings to this account by bank transfer. <OperationsContact /></>
                    : manualAccount
                      ? "Your bank details are incomplete. Add the bank and the account name so TSC can pay you."
                      : isOwner ? "Add a payout method to receive earnings" : "No payout method yet."}</p>}
          {balance?.recovery && [...balance.recovery.available, ...balance.recovery.pending].some(row => row.amount !== 0) ? <div role="alert">
            <p>Your previous payout account has funds remaining or returned after the upgrade.</p>
            {recoveryAvailable > 0 && balance.recovery.payoutsEnabled ? <button className="secondary-btn compact-btn" disabled={busy} onClick={() => {
              setWithdrawal({ previous: true, amount: recoveryAvailable, currency: recoveryCurrency.toLowerCase(), requestId: crypto.randomUUID() });
              setModal("withdraw");
            }}>Withdraw previous balance</button> : <p>Contact <a href={`mailto:${OPERATIONS_EMAIL}`}>TSC operations</a> to recover these funds.</p>}
          </div> : null}
          {manualSaved ? <p className="live-payment-notice">Payout method saved.</p> : null}
          {withdrawn ? <p className="live-payment-notice" role="status">Withdrawal requested. Your bank is processing the payout.</p> : null}
          {methodNotice ? <p className="live-payment-notice" role="status" data-testid="payout-method-notice">{methodNotice}</p> : null}
          {currency === "USD" && (balance || balanceWaiting) ? <p className="payment-provider-note">Payments securely processed by Stripe.</p> : null}
          {error ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
        </div>
        <div className="live-payout-card-action">
          {isOwner ? account?.transfers_active ? (
            <>
            <button className="primary-btn compact-btn" type="button" data-testid="withdraw-balance" disabled={busy || !balance || available <= 0 || !account.payouts_enabled} onClick={() => {
              setError(null);
              setWithdrawal({ amount: available, currency: currency.toLowerCase(), requestId: crypto.randomUUID() });
              setModal("withdraw");
            }}>Withdraw to bank</button>
            <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={() => setModal("manage")}>Manage payout method</button>
            </>
          ) : account ? (
            <button className="primary-btn compact-btn" type="button" disabled={busy} onClick={() => setModal("onboarding")}>Finish setup</button>
          ) : manualAccount && !manualComplete(manualAccount) ? (
            <button className="primary-btn compact-btn" type="button" data-testid="add-payout-method" onClick={() => openManual(manualAccount)}>Complete bank details</button>
          ) : (
            <button className="primary-btn compact-btn" type="button" data-testid="add-payout-method" onClick={() => (manualAccount ? setModal("manage") : openManual(null))}>{manualAccount ? "Manage payout method" : "Add payout method"}</button>
          )
          : <p className="payout-owner-only">Only an owner of your company can set up or change payouts.</p>}
        </div>
      </section> : null}

      {modal === "withdraw" && withdrawal ? (
        <PayoutModal title="Withdraw to bank" onClose={closeModal} actions={<>
          <button className="secondary-btn" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
          <button className="primary-btn" type="button" disabled={busy} onClick={withdraw}>{busy ? "Withdrawing…" : `Withdraw ${formatMoney(withdrawal.amount, withdrawal.currency)}`}</button>
        </>}>
          <p>Send {formatMoney(withdrawal.amount, withdrawal.currency)} to your {withdrawal.previous ? "previous account’s" : "default"} payout account. Bank processing time depends on your bank and country.</p>
          {error ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "manage" ? (
        <PayoutModal
          title="Payout methods"
          eyebrow="Payments"
          onClose={closeModal}
          actions={<button className="secondary-btn" type="button" onClick={closeModal}>Done</button>}
        >
          <div className="payout-methods-heading">
            <p className="payout-modal-intro">Choose where released earnings are sent.</p>
            {/* Add always adds: a bank-paid factory's new account sits beside the others. */}
            <button className="secondary-btn compact-btn" type="button" disabled={busy || manualBusy} onClick={() => (account ? setModal("add") : openManual(null))}>+ Add payout method</button>
          </div>
          <div className="payout-method-list">
            {account ? providerMethodRows.map((method) => (
              <article className="payout-method-row" key={method.id}>
                <div className="payout-bank-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>
                </div>
                <div className="payout-method-name">
                  <strong>{methodLabel(method)}</strong>
                  <span>{[method.name, method.currency?.toUpperCase(), method.country && countryName(method.country)].filter(Boolean).join(" · ")}</span>
                </div>
                {method.default ? <span className="payout-method-default">Default</span>
                  : method.payoutsFor ? <span className="payout-method-default">For {method.payoutsFor.toUpperCase()} payouts</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${methodLabel(method).toLowerCase()}`} aria-expanded={methodMenu === method.id} disabled={busy || methodBusy} onClick={() => setMethodMenu((open) => open === method.id ? null : method.id)}>...</button>
                  {methodMenu === method.id ? (
                    <div className="payout-method-popover" role="menu">
                      {managed ? (
                        !method.default && method.standard !== false ? <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); makeStripeDefault(method); }}>Make default</button> : null
                      ) : <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); setModal("upgrade"); }}>Upgrade payout methods</button>}
                      <button className="danger" type="button" role="menuitem" disabled={method.id === "connected-account"} onClick={() => { setMethodMenu(null); setRemoving(method); setPromoteId(null); setRemoveError(null); setModal(managed ? "remove-stripe" : "upgrade"); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            )) : manualAccounts.length ? manualAccounts.map((row) => (
              <article className="payout-method-row" key={row.id}>
                <div className="payout-bank-icon" aria-hidden="true">
                  {isPayoneer(row) ? PAYONEER_MARK : <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>}
                </div>
                <div className="payout-method-name">{isPayoneer(row)
                  ? <><strong>Payoneer</strong><span>{row.payoneer_email}</span></>
                  : <><strong>{manualLabel(row)}</strong><span>{row.bank_name || "Manual bank transfer"}</span></>}</div>
                {row.is_primary ? <span className="payout-method-default">Default</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${manualLabelInSentence(row)}`} aria-expanded={methodMenu === row.id} disabled={manualBusy} onClick={() => setMethodMenu((open) => open === row.id ? null : row.id)}>...</button>
                  {methodMenu === row.id ? (
                    <div className="payout-method-popover" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); openManual(row); }}>Edit method</button>
                      {!row.is_primary ? <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); makePrimary(row); }}>Make default</button> : null}
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMethodMenu(null); setRemovingManual(row); setPromoteId(null); setRemoveError(null); setModal("remove"); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            )) : <div className="payout-empty-guidance">No payout method added yet.</div>}
          </div>
          {account && balance && !managed ? (
            <div className="payout-info-callout"><p>
              {balance.upgrade ? balance.upgrade.creationFailed ? "Your payout upgrade has not started. Earnings continue to reach your current account. Retry the upgrade to continue." : "Your payout upgrade is in progress. New earnings are held by TSC until it finishes. You can still withdraw your existing balance."
                : "Upgrade once to add and manage bank accounts directly on TSC. Stripe needs you to verify the replacement payout account."}
              {" "}<button className="secondary-btn compact-btn" type="button" onClick={() => setModal("upgrade")}>{balance.upgrade ? "Continue upgrade" : "Upgrade payout methods"}</button>
            </p></div>
          ) : null}
          {removeError && modal === "manage" ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
          {methodNotice && modal === "manage" ? <p className="live-payment-notice" role="status">{methodNotice}</p> : null}
          {account
            ? !managed ? <p className="payout-security-copy">Your existing bank details stay with Stripe. Complete the payout upgrade to manage bank accounts directly on TSC.</p> : null
            : manualAccounts.length > 1 ? <p className="payout-security-copy">TSC pays your default payout method. To have another one paid, choose “Make default” on it.</p> : null}
          {manualError ? <p className="live-stripe-error" role="alert">{manualError.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "add" ? (
        <PayoutModal
          title="Add a payout method"
          eyebrow="Payments"
          onClose={closeModal}
          actions={<button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Cancel</button>}
        >
          <div className="payout-method-options">
            <article className="payout-method-option recommended">
              <div className="payout-option-icon payout-bank-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>
              </div>
              <div className="payout-option-copy">
                <div className="payout-option-title"><strong>Bank account</strong><span>Recommended</span></div>
                <p>Standard payouts directly to your bank. Timing and availability depend on your country.</p>
              </div>
              <button className="primary-btn compact-btn" type="button" data-testid="add-bank-account" disabled={busy} onClick={() => startAdd("bank")}>Add bank account</button>
            </article>
            <article className="payout-method-option">
              <div className="payout-option-icon payout-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
              </div>
              <div className="payout-option-copy">
                <div className="payout-option-title"><strong>Instant payout card</strong></div>
                <p>Receive eligible payouts on a supported debit card. Stripe confirms availability, timing, and fees.</p>
              </div>
              <button className="secondary-btn compact-btn" type="button" data-testid="add-payout-card" disabled={busy} onClick={() => startAdd("card")}>Add debit card</button>
            </article>
          </div>
          {managed ? null : <p className="payout-security-copy">{EXPRESS_FORM_NOTE}</p>}
        </PayoutModal>
      ) : null}

      {modal === "add-bank" || modal === "add-card" ? (
        <AddPayoutMethodForm
          kind={modal === "add-card" ? "card" : "bank"}
          org={org}
          country={account?.country ?? country}
          currency={(balance?.defaultCurrency ?? currency).toUpperCase()}
          isFirst={!connectedMethods.length || Boolean(replacing?.default)}
          replaceId={replacing?.id}
          onAdded={methodAdded}
          onClose={() => { setReplacing(null); setModal(replacing ? "remove-stripe" : "add"); }}
        />
      ) : null}

      {modal === "remove" && removingManual ? (
        <PayoutModal
          title={manualRemovalRefusal
            ? `${manualLabel(removingManual)} can’t be removed yet`
            : `Remove ${manualLabelInSentence(removingManual)}?`}
          eyebrow="Payments"
          onClose={closeModal}
          actions={manualRemovalRefusal
            ? <button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button>
            : <><button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Cancel</button><button className="primary-btn payout-remove-confirm" type="button" disabled={manualBusy} onClick={removeManualMethod}>{manualBusy ? "Removing…" : "Remove method"}</button></>}
        >
          <p className="payout-modal-intro" data-testid="payout-remove-reason">{manualRemovalRefusal
            ?? (manualSuccessor
              ? `TSC will pay your released earnings to ${manualLabelInSentence(manualSuccessor)}${manualSuccessor.bank_name ? ` (${manualSuccessor.bank_name})` : ""} from now on.`
              : removingManual.is_primary
                ? "This is your only payout method. TSC will hold your released earnings until you add another one, then pay them to it."
                : "TSC will no longer keep these details. Your earnings still go to your default account.")}</p>
          {!manualRemovalRefusal && otherManual.length > 1 && removingManual.is_primary ? (
            <label className="payout-country-field">
              <span>Pay my earnings to</span>
              <select value={manualSuccessor?.id ?? ""} onChange={(event) => setPromoteId(event.target.value)}>
                {otherManual.map((row) => <option key={row.id} value={row.id}>{manualLabel(row)}{row.bank_name ? ` · ${row.bank_name}` : ""}</option>)}
              </select>
            </label>
          ) : null}
          {removeError ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "remove-stripe" && removing ? (
        <PayoutModal
          title={!balance ? "Remove payout method" : removalRefusal ? `${removingMethod ? methodLabel(removingMethod) : "This account"} can’t be removed` : `Remove ${methodLabel(removingMethod).toLowerCase()}?`}
          eyebrow="Payments"
          onClose={closeModal}
          actions={!balance || (removalRefusal && !(managed && removingMethod))
            ? <button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button>
            : removalRefusal
              // Managed, and the last of its currency: put another in its place.
              ? <><button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button><button className="primary-btn" type="button" data-testid="replace-payout-method" onClick={() => { setReplacing(removingMethod); setModal("add-bank"); }}>Replace with another bank account</button></>
              : <><button className="secondary-btn" type="button" disabled={methodBusy} onClick={() => setModal("manage")}>Cancel</button>
                <button className="primary-btn payout-remove-confirm" type="button" data-testid="confirm-remove-payout" disabled={busy || methodBusy}
                        onClick={() => (managed ? confirmStripeRemoval() : handOver("remove", removingMethod))}>
                  {managed ? (methodBusy ? "Removing…" : "Remove method") : "Continue in Stripe"}
                </button></>}
        >
          <p className="payout-modal-intro" data-testid="payout-remove-reason">{!balance
            ? "Checking your payout accounts…"
            : removalRefusal
              ?? (managed
                ? successor
                  ? `Future withdrawals will go to ${methodLabel(successor).toLowerCase()}. Earnings already in your balance stay there until you withdraw them.`
                  : `Withdrawals will no longer be paid to ${methodLabel(removingMethod).toLowerCase()}.`
                : `Earnings will no longer be paid to ${methodLabel(removingMethod).toLowerCase()}. Stripe’s form opens next: under Payout details, remove the account ending in ${removingMethod.last4}, then choose Done.`)}</p>
          {!removalRefusal && successors.length > 1 ? (
            <label className="payout-country-field">
              <span>Send future withdrawals to</span>
              <select value={successor?.id ?? ""} onChange={(event) => setPromoteId(event.target.value)}>
                {successors.map((method) => <option key={method.id} value={method.id}>{methodLabel(method)}</option>)}
              </select>
            </label>
          ) : null}
          {removeError ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "setup" ? (
        <PayoutModal title={manualEditingId ? isPayoneer(editingManual) ? "Edit Payoneer account" : "Edit bank account" : manualAccounts.length ? "Add a payout method" : "Set up payout method"} eyebrow="Payments" onClose={closeModal} actions={setupActions}>
          {manualError ? <p className="live-stripe-error" role="alert">{manualError.message}</p> : null}
          <p className="payout-modal-intro">Choose where your company is registered. We’ll show the payout method available for that country.</p>
          <label className="payout-country-field">
            <span>Company country</span>
            <select data-field="payout_country" value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="">Choose a country</option>
              {COUNTRIES.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
              <option value={NOT_LISTED}>Other / not listed</option>
            </select>
          </label>
          {country ? supported ? (
            <div className="payout-method-preview">
              <div className="payout-method-icon" aria-hidden="true">S</div>
              <div><strong>Stripe payout account</strong><p>Stripe securely verifies your company and bank details. TSC never stores those details.</p></div>
            </div>
          ) : (
            <>
              <div className="payout-info-callout"><span aria-hidden="true">i</span><p>
                {notListed
                  ? "Stripe pays out only to companies in the US, Canada, the UK, Switzerland and the EEA."
                  : `Stripe can’t pay out to companies in ${countryName(country)}.`}
                {" "}{manualEditingId
                  ? isPayoneer(editingManual)
                    ? "TSC pays your released earnings to your Payoneer account by hand."
                    : "Add your bank account and TSC pays your released earnings to it by bank transfer."
                  : "Choose how TSC pays your released earnings. TSC sends each payment by hand."}
              </p></div>
              {manualEditingId ? null : (
                <div className="payout-method-options" role="group" aria-label="Payout method">
                  <article className="payout-method-option">
                    <div className="payout-option-icon payout-bank-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>
                    </div>
                    <div className="payout-option-copy">
                      <div className="payout-option-title"><strong>Bank account</strong></div>
                      <p>TSC sends a bank transfer to your account.</p>
                    </div>
                    <button className={payoneerForm ? "secondary-btn compact-btn" : "primary-btn compact-btn"} type="button" aria-pressed={!payoneerForm} data-testid="payout-use-bank" onClick={() => { setManualError(null); onManualMethodChange?.("bank"); }}>{payoneerForm ? "Use bank account" : "Selected"}</button>
                  </article>
                  <article className="payout-method-option">
                    <div className="payout-option-icon payout-bank-icon" aria-hidden="true">{PAYONEER_MARK}</div>
                    <div className="payout-option-copy">
                      <div className="payout-option-title"><strong>Payoneer</strong></div>
                      <p>TSC sends a payment to your Payoneer account, using its email.</p>
                    </div>
                    <button className={payoneerForm ? "primary-btn compact-btn" : "secondary-btn compact-btn"} type="button" aria-pressed={payoneerForm} data-testid="payout-use-payoneer" onClick={() => { setManualError(null); onManualMethodChange?.("payoneer"); }}>{payoneerForm ? "Selected" : "Use Payoneer"}</button>
                  </article>
                </div>
              )}
              {payoneerForm ? payoneerFieldsContent : manualFieldsContent}
            </>
          ) : <div className="payout-empty-guidance">Select a country to see the available payout method.</div>}
          {supported ? <p className="payout-security-copy">{STRIPE_FORM_NOTE}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "resume" ? (
        <PayoutModal
          title="Continue your Stripe setup"
          eyebrow="Payments"
          onClose={closeModal}
          actions={<><button className="secondary-btn" type="button" onClick={closeModal}>Not now</button><button className="primary-btn" type="button" disabled={busy} onClick={() => setModal("onboarding")}>Continue</button></>}
        >
          <p className="payout-modal-intro">Your Stripe setup link expired or was already used, so Stripe sent you back here. Continue to pick up where you left off.</p>
          <p className="payout-security-copy">{STRIPE_FORM_NOTE}</p>
        </PayoutModal>
      ) : null}

      {modal === "upgrade" ? (
        <PayoutModal title="Upgrade your payout methods" eyebrow="Payments" onClose={closeModal}
          actions={<><button className="secondary-btn" type="button" disabled={busy} onClick={closeModal}>Not now</button>
            <button className="primary-btn" type="button" disabled={busy} onClick={startUpgrade}>{busy ? "Starting…" : balance?.upgrade ? "Continue verification" : "Start upgrade"}</button>
            {balance?.upgrade ? <button className="secondary-btn" type="button" disabled={busy} onClick={finishUpgrade}>Check and finish upgrade</button> : null}</>}>
          <p className="payout-modal-intro">After a one-time verification, add, replace and remove bank accounts directly on TSC. Stripe requires a new payout account; you will need to confirm your business and bank details again and accept its agreement.</p>
          <p className="payout-security-copy">Your existing balance stays in your current account. Once you start, new earnings are held by TSC until the upgrade finishes. Withdraw any remaining balance using Withdraw to bank and wait for it to arrive. Your payout history is kept.</p>
          {balance?.upgrade ? <p role="status">{balance.upgrade.verified ? "Replacement account verified." : "Complete verification for the replacement account."} {balance.upgrade.unsettled ? "Your old account still has funds or a withdrawal settling. Withdraw available funds and check again after settlement." : "The old account is settled."}</p> : null}
          {removeError ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
        </PayoutModal>
      ) : null}
      {modal === "upgrade-onboarding" ? (
        <PayoutModal wide title="Verify your replacement payout account" eyebrow="Payments" onClose={closeStripeForm}
          actions={<button className="secondary-btn" type="button" onClick={closeStripeForm}>Close</button>}>
          <p className="payout-security-copy">Your current account and balance stay available until this account is verified and the old account has settled.</p>
          <StripeConnectEmbed org={org} upgrade form="onboarding" onExit={closeStripeForm} />
        </PayoutModal>
      ) : null}

      {modal === "onboarding" ? (
        <PayoutModal
          wide
          title="Set up Stripe payouts"
          eyebrow="Payments"
          onClose={closeStripeForm}
          actions={<button className="secondary-btn" type="button" onClick={closeStripeForm}>Close</button>}
        >
          <p className="payout-security-copy">{STRIPE_FORM_NOTE}</p>
          <StripeConnectEmbed org={org} country={supported ? country : undefined} form="onboarding" onExit={closeStripeForm} />
        </PayoutModal>
      ) : null}

      {modal === "account" ? (
        <PayoutModal
          wide
          title="Payout account"
          eyebrow="Payments"
          onClose={closeStripeForm}
          actions={<button className="secondary-btn" type="button" onClick={closeStripeForm}>Done</button>}
        >
          <p className="payout-modal-intro">{handover?.intent === "add"
            ? "Under “Payout details”, add the bank account or card your earnings should be paid to, then choose Done."
            : handover?.intent === "remove"
              ? `Under “Payout details”, remove the account ending in ${handover.target?.last4}, then choose Done.`
              : "Your company and payout details as Stripe holds them."}</p>
          <StripeConnectEmbed org={org} form="account" />
          <p className="payout-security-copy">{managed ? STRIPE_FORM_NOTE : EXPRESS_FORM_NOTE}</p>
        </PayoutModal>
      ) : null}

    </>
  );
}
