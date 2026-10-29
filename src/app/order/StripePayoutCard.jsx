import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { connectAccountFor, connectAction } from "../../lib/domain/stripe.js";
import { PAYOUT_COUNTRIES } from "../../shared/stripe-payout-countries.mjs";
import PaymentHelp, { PENDING_HELP } from "./PaymentHelp.jsx";
import StripeConnectEmbed from "./StripeConnectEmbed.jsx";

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

// Said wherever Stripe's embedded forms open. They stay on this page, but
// Stripe asks the person to confirm who they are in a small window of its own
// (an Express account cannot turn that off), and may show TSC's registered
// company name rather than The Sourcing Club.
const STRIPE_FORM_NOTE = "Stripe, TSC's payment partner, securely verifies your company and bank details in its form on this page. It may ask you to confirm with a code in a small Stripe window, and may show TSC's registered company name. TSC never stores those details.";

/** Where staff pay by bank, everything they need to pay it. */
const manualComplete = (row) => Boolean(row?.bank_name?.trim() && row?.account_name?.trim());

function OperationsContact() {
  return (
    <>Before your first payout, TSC operations will email you from <a href={`mailto:${OPERATIONS_EMAIL}`}>{OPERATIONS_EMAIL}</a> to confirm the full transfer details.</>
  );
}

/**
 * The currency the balance is shown in. A connected account is credited in its
 * own currency (a UK factory in GBP, a German one in EUR), so reading USD alone
 * shows $0 and disables Withdraw. Prefer money in the account's default
 * currency, then any currency holding money, then the default, then USD.
 */
function balanceCurrency(balance) {
  const available = balance?.available ?? [];
  const preferred = balance?.defaultCurrency?.toUpperCase();
  // Money still on its way counts too: a first earning is pending for days,
  // and choosing by available money alone showed it in another currency as 0.
  const funded = [...available, ...(balance?.pending ?? [])].filter((row) => row.amount > 0);
  const row = funded.find((entry) => entry.currency?.toUpperCase() === preferred) ?? funded[0]
    ?? available.find((entry) => entry.currency?.toUpperCase() === preferred);
  return row?.currency?.toUpperCase() ?? preferred ?? "USD";
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
  return `${method.type === "card" ? "Payout card" : "Bank account"}${method.last4 ? ` ending in ${method.last4}` : ""}`;
}

const stripeDay = (unix) => new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Why a Stripe payout account cannot be removed now, in the factory's words,
 * or null. Stripe itself refuses to remove a currency's default account.
 */
function stripeRemovalRefusal(method, methods, payoutsOnTheirWay) {
  if (methods.length <= 1) {
    return "This is your only payout account. Add another one first, so your earnings have somewhere to go.";
  }
  if (method.default || method.payoutsFor) {
    return `${methodLabel(method)} is your default ${method.payoutsFor ? `${method.payoutsFor.toUpperCase()} ` : ""}payout account. In Stripe’s form, make another account the default first, then remove this one.`;
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

export default function StripePayoutCard({
  org,
  isOwner,
  onBalanceChange,
  manualAccount,
  manualAccounts = manualAccount ? [manualAccount] : [],
  manualEditingId = null,
  onStartManual,
  onMakePrimaryManual,
  manualForm,
  manualFields,
  onManualFieldChange,
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
  // after SLOW_BALANCE_MS), "failed" or "ready". The card said "We could not
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
    if (saved?.transfers_active && isOwner) {
      setBalanceStatus("loading");
      const nextBalance = await connectAction(org.id, "balance");
      setBalance(nextBalance);
      setBalanceStatus("ready");
      onBalanceChange?.(nextBalance);
      return nextBalance;
    }
    setBalance(null);
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
  const arrivesOn = availableFrom(balance);
  // A Stripe-paid owner whose balance is on its way from Stripe: the card
  // keeps its shape (a placeholder) until it arrives; a slow answer still
  // says so, and a failure says it failed.
  const balanceWaiting = !balance && isOwner && Boolean(account?.transfers_active)
    && (balanceStatus === "loading" || balanceStatus === "slow");
  const connectedMethods = balance?.methods ?? [];
  async function withdraw() {
    if (busy || !withdrawal) return;
    setBusy(true);
    setError(null);
    try {
      await connectAction(org.id, "withdraw", withdrawal);
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
    setBusy(true);
    setError(null);
    try {
      // No account means the form never got as far as creating one.
      if (await connectAccountFor(org.id)) await connectAction(org.id, "refresh");
      const next = await load();
      if (handover) setMethodNotice(handoverResult(handover, next?.methods ?? []));
      setHandover(null);
    } catch (failure) {
      setError(failure);
      setBalanceStatus("failed");
    } finally {
      setBusy(false);
    }
  }

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
      setModal(account?.transfers_active || manualAccount ? "manage" : "setup");
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

  if (account === undefined) return null;

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
  const manualReady = Boolean(
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
    ? stripeRemovalRefusal(removingMethod, connectedMethods, balance?.payoutsOnTheirWay ?? [])
    : balance ? "That payout account is no longer listed. It may have been removed already." : null;

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
      setMethodNotice(`TSC now pays ${methodLabel({ type: "bank_account", last4: row.account_number_last4 }).toLowerCase()}.`);
    } catch (failure) {
      setManualError(failure);
    }
  }

  // Which bank account is being removed, and why it may not be yet.
  const otherManual = removingManual ? manualAccounts.filter((row) => row.id !== removingManual.id) : [];
  const manualRemovalRefusal = !removingManual ? null
    : removingManual.is_primary && otherManual.length ? PRIMARY_REFUSAL
    : removingManual.is_primary && bankOwed.length ? `${bankOwedSentence(bankOwed)} You can change the details with Edit, but not remove the account until that payment is sent.`
    : null;

  async function removeManualMethod() {
    setRemoveError(null);
    try {
      await onDeleteManual?.(removingManual);
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
          <span className="payment-metric-label">{!account && manualAccount ? "Payouts" : arriving ? "Balance on its way" : "Available balance"}
            {arriving
              ? <PaymentHelp label="Balance on its way">{PENDING_HELP}</PaymentHelp>
              : <PaymentHelp label="Available balance">Money you can withdraw to your bank now. This is your overall balance across all clients.</PaymentHelp>}
          </span>
          <strong data-testid="payout-balance">{balance ? formatMoney(arriving ? pending : available, currency)
            // A placeholder the size of the amount, so the card does not
            // jump when Stripe answers (a sentence said "checking" before).
            : balanceWaiting ? <span className="payout-balance-placeholder" role="status" aria-label="Loading balance" />
            : !account && manualAccount ? "By bank transfer" : "—"}</strong>
          {balanceStatus === "loading" && balanceWaiting ? (
            <p className="payout-balance-line payout-balance-placeholder-lines" aria-hidden="true"><span /><span /></p>
          ) : <p className={balance || balanceWaiting ? "payout-balance-line" : undefined}>{balance
            ? arriving
              // Orders are in USD; Stripe credits an account in its own currency.
              ? `Stripe is processing your earnings. You can withdraw them ${arrivesOn ? `from ${arrivesOn}` : "once processing finishes"}.${currency !== "USD" ? ` Stripe converts them to ${currency}, your account's currency.` : ""}`
              : pending > 0
              ? <>{formatMoney(pending, currency)} pending <PaymentHelp label="Pending balance">{PENDING_HELP}</PaymentHelp></>
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
                  : manualAccount && manualComplete(manualAccount)
                    ? <>Bank details on file{manualAccount.account_number_last4 ? ` (account ending in ${manualAccount.account_number_last4})` : ""}. TSC pays your released earnings to this account by bank transfer. <OperationsContact /></>
                    : manualAccount
                      ? "Your bank details are incomplete. Add the bank and the account name so TSC can pay you."
                      : isOwner ? "Add a payout method to receive earnings" : "No payout method yet."}</p>}
          {manualSaved ? <p className="live-payment-notice">Payout method saved.</p> : null}
          {withdrawn ? <p className="live-payment-notice" role="status">Withdrawal requested. Your bank is processing the payout.</p> : null}
          {methodNotice ? <p className="live-payment-notice" role="status" data-testid="payout-method-notice">{methodNotice}</p> : null}
          {balance || balanceWaiting ? <p className="payment-provider-note">Payments securely processed by Stripe.</p> : null}
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
          <p>Send {formatMoney(withdrawal.amount, withdrawal.currency)} to your default payout account. Bank processing time depends on your bank and country.</p>
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
                  <strong>{method.type === "card" ? "Payout card" : "Bank account"}{method.last4 ? ` ending in ${method.last4}` : ""}</strong>
                  <span>{[method.name, method.currency?.toUpperCase(), method.country && countryName(method.country)].filter(Boolean).join(" · ")}</span>
                </div>
                {method.default ? <span className="payout-method-default">Default</span>
                  : method.payoutsFor ? <span className="payout-method-default">For {method.payoutsFor.toUpperCase()} payouts</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${method.type === "card" ? "payout card" : "bank account"}`} aria-expanded={methodMenu === method.id} disabled={busy} onClick={() => setMethodMenu((open) => open === method.id ? null : method.id)}>...</button>
                  {methodMenu === method.id ? (
                    <div className="payout-method-popover" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); openSecureManagement(); }}>Edit method</button>
                      <button className="danger" type="button" role="menuitem" disabled={method.id === "connected-account"} onClick={() => { setMethodMenu(null); setRemoving(method); setModal("remove-stripe"); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            )) : manualAccounts.length ? manualAccounts.map((row) => (
              <article className="payout-method-row" key={row.id}>
                <div className="payout-bank-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>
                </div>
                <div className="payout-method-name"><strong>{methodLabel({ type: "bank_account", last4: row.account_number_last4 })}</strong><span>{row.bank_name || "Manual bank transfer"}</span></div>
                {row.is_primary ? <span className="payout-method-default">Default</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${methodLabel({ type: "bank_account", last4: row.account_number_last4 }).toLowerCase()}`} aria-expanded={methodMenu === row.id} disabled={manualBusy} onClick={() => setMethodMenu((open) => open === row.id ? null : row.id)}>...</button>
                  {methodMenu === row.id ? (
                    <div className="payout-method-popover" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); openManual(row); }}>Edit method</button>
                      {!row.is_primary ? <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); makePrimary(row); }}>Pay this account</button> : null}
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMethodMenu(null); setRemovingManual(row); setRemoveError(null); setModal("remove"); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            )) : <div className="payout-empty-guidance">No payout method added yet.</div>}
          </div>
          {account
            ? <p className="payout-security-copy">For security, Stripe's form on this page holds the bank details: Add, Edit and Remove each finish there.</p>
            : manualAccounts.length > 1 ? <p className="payout-security-copy">TSC pays your default bank account. To have another one paid, choose “Pay this account” on it.</p> : null}
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
          <p className="payout-modal-intro">Choose how you’d like to receive your funds. Stripe will securely collect and verify the account details.</p>
          <div className="payout-method-options">
            <article className="payout-method-option recommended">
              <div className="payout-option-icon payout-bank-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>
              </div>
              <div className="payout-option-copy">
                <div className="payout-option-title"><strong>Bank account</strong><span>Recommended</span></div>
                <p>Standard payouts directly to your bank. Timing and availability depend on your country.</p>
              </div>
              <button className="primary-btn compact-btn" type="button" disabled={busy} onClick={() => handOver("add")}>Set up</button>
            </article>
            <article className="payout-method-option">
              <div className="payout-option-icon payout-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
              </div>
              <div className="payout-option-copy">
                <div className="payout-option-title"><strong>Instant payout card</strong></div>
                <p>Receive eligible payouts on a supported debit card. Stripe confirms availability, timing, and fees.</p>
              </div>
              <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={() => handOver("add")}>Set up</button>
            </article>
          </div>
          <p className="payout-security-copy">{STRIPE_FORM_NOTE}</p>
        </PayoutModal>
      ) : null}

      {modal === "remove" && removingManual ? (
        <PayoutModal
          title={manualRemovalRefusal
            ? `${methodLabel({ type: "bank_account", last4: removingManual.account_number_last4 })} can’t be removed yet`
            : `Remove ${methodLabel({ type: "bank_account", last4: removingManual.account_number_last4 }).toLowerCase()}?`}
          eyebrow="Payments"
          onClose={closeModal}
          actions={manualRemovalRefusal
            ? <button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button>
            : <><button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Cancel</button><button className="primary-btn payout-remove-confirm" type="button" disabled={manualBusy} onClick={removeManualMethod}>{manualBusy ? "Removing…" : "Remove method"}</button></>}
        >
          <p className="payout-modal-intro" data-testid="payout-remove-reason">{manualRemovalRefusal
            ?? (removingManual.is_primary
              ? "TSC can’t pay out your released earnings until another payout method is added."
              : "TSC will no longer keep these details. Your earnings still go to your default account.")}</p>
          {removeError ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "remove-stripe" && removing ? (
        <PayoutModal
          title={!balance ? "Remove payout method" : removalRefusal ? `${removingMethod ? methodLabel(removingMethod) : "This account"} can’t be removed` : `Remove ${methodLabel(removingMethod).toLowerCase()}?`}
          eyebrow="Payments"
          onClose={closeModal}
          actions={!balance || removalRefusal
            ? <button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button>
            : <><button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Cancel</button><button className="primary-btn payout-remove-confirm" type="button" disabled={busy} onClick={() => handOver("remove", removingMethod)}>Continue in Stripe</button></>}
        >
          <p className="payout-modal-intro" data-testid="payout-remove-reason">{!balance
            ? "Checking your payout accounts…"
            : removalRefusal
              ?? `Earnings will no longer be paid to ${methodLabel(removingMethod).toLowerCase()}. Stripe’s form opens next: under Payout details, remove the account ending in ${removingMethod.last4}, then choose Done.`}</p>
        </PayoutModal>
      ) : null}

      {modal === "setup" ? (
        <PayoutModal title={manualEditingId ? "Edit bank account" : manualAccounts.length ? "Add a payout method" : "Set up payout method"} eyebrow="Payments" onClose={closeModal} actions={setupActions}>
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
                {" "}Add your bank account and TSC pays your released earnings to it by bank transfer.
              </p></div>
              {manualFieldsContent}
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
              : "Change the bank account your earnings are paid to under “Payout details”."}</p>
          <StripeConnectEmbed org={org} form="account" />
          <p className="payout-security-copy">{STRIPE_FORM_NOTE}</p>
        </PayoutModal>
      ) : null}

    </>
  );
}
