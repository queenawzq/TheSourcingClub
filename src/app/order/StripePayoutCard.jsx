import { balanceCurrency } from "../../lib/payout-currency.mjs";
import { payoutUsdTotal } from "../../lib/payout-display.mjs";
import { isHandPaid } from "./payment-summary.mjs";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { connectAccountFor, connectAction } from "../../lib/domain/stripe.js";
import { PAYOUT_COUNTRIES } from "../../shared/stripe-payout-countries.mjs";
import StripeConnectEmbed from "./StripeConnectEmbed.jsx";
import AddPayoutMethodForm from "./AddPayoutMethodForm.jsx";
import { PaypalStep, WiseBankStep, readsChinese } from "./PayoutSetupSteps.jsx";
import { bankFieldsFor, normalBankNumber, validBankNumber, validSwift } from "../../shared/bank-fields.mjs";

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

/** A plain letter, not a provider's logo: using that needs their permission. */
const LETTER_MARK = { payoneer: <strong>P</strong>, paypal: <strong>P</strong> };

const isPayoneer = (row) => row?.method === "payoneer";
const isPaypal = (row) => row?.method === "paypal";
const manualComplete = (row) => isPayoneer(row) || isPaypal(row) || Boolean(row?.bank_name?.trim() && row?.account_name?.trim() && row?.number_changed_at);
const BANK_ICON = <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>;

/** Where a factory has a choice, and the words for that list in both languages where it reads Chinese. */
const listWords = (country) => (readsChinese(country) ? {
  title: "Add a withdrawal method 添加提现方式", bank: "Bank transfer 银行转账", setUp: "Set up 设置", country: "Country 国家/地区",
  methods: "Withdrawal methods 提现方式", add: "Add withdrawal method 添加提现方式", toReceive: "Add a withdrawal method to receive earnings. 请添加提现方式以接收收入。",
  edit: "Edit method 编辑", makeDefault: "Make default 设为默认", remove: "Remove method 移除", back: "Back 返回", done: "Done 完成",
  saved: "Withdrawal method saved. 提现方式已保存。", removed: "Withdrawal method removed. 提现方式已移除。",
  recommended: (name) => `Recommended for ${name} ${{ CN: "中国推荐", HK: "香港推荐", TW: "台湾推荐" }[country]}`,
} : {
  title: "Add a withdrawal method", bank: "Bank transfer", setUp: "Set up", country: "Country",
  methods: "Withdrawal methods", add: "Add withdrawal method", toReceive: "Add a withdrawal method to receive earnings.",
  edit: "Edit method", makeDefault: "Make default", remove: "Remove method", back: "Back", done: "Done",
  saved: "Withdrawal method saved.", removed: "Withdrawal method removed.",
  recommended: (name) => `Recommended for ${name}`,
});

const SLOW_BALANCE_MS = 8000;
const BALANCE_STATUS_TEXT = {
  slow: "Still loading.",
  failed: "Couldn't load your balance. Try again shortly.",
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

/** "Bank ····2345", the words the method list uses. */
function methodLabel(method) {
  return `${method.type === "card" ? "Debit card" : "Bank"}${method.last4 ? ` ····${method.last4}` : ""}`;
}

const stripeDay = (unix) => new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Why a payout account cannot be removed now, in the factory's words, or null.
 * The provider refuses to remove a currency's default account, so where TSC
 * manages the account another one becomes the default first, and only the last
 * one in its currency stays (the dialog offers Replace).
 */
function stripeRemovalRefusal(method, methods, payoutsOnTheirWay, managed) {
  const sameCurrency = methods.filter((other) => other.id !== method.id && other.currency === method.currency && other.standard !== false);
  if (methods.length <= 1) {
    return managed ? "This is your only withdrawal method. Replace it instead." : "This is your only withdrawal method. Add another one first.";
  }
  if ((method.default || method.payoutsFor) && (!managed || !sameCurrency.length)) {
    return managed
      ? "This is your only method in its currency. Replace it instead."
      : "This is your default method. Make another one the default first.";
  }
  const onItsWay = payoutsOnTheirWay.find((payout) => payout.destination === method.id);
  if (onItsWay) {
    return `${formatMoney(onItsWay.amount, onItsWay.currency.toUpperCase())} is on its way to this account${onItsWay.arrival_date ? ` (${stripeDay(onItsWay.arrival_date)})` : ""}. Remove it after that.`;
  }
  return null;
}

/** What closing Stripe's form did, after an Add or a Remove. */
function handoverResult({ intent, target, before }, after) {
  if (intent === "add") {
    const added = after.filter((method) => !before.includes(method.id));
    return added.length
      ? `Added ${added.map((method) => methodLabel(method)).join(" and ")}.`
      : "No withdrawal method was added.";
  }
  return after.some((method) => method.id === target?.id)
    ? `${methodLabel(target)} is still there.`
    : `Removed ${methodLabel(target)}.`;
}

/**
 * The database's refusal to remove a bank account TSC is about to pay
 * (20261029000300), in words with the amount; any other failure as it was.
 */
export function payoutRemovalError(failure) {
  if (failure?.cause?.hint === "payout_primary") return new Error(PRIMARY_REFUSAL);
  if (failure?.cause?.hint !== "payout_owed") return failure;
  const [cents, currency] = String(failure.cause.details ?? "").split(" ");
  return new Error(`${bankOwedSentence([{ amount: Number(cents) || 0, currency: currency || "USD" }])} Remove it after that payment is sent.`);
}

const PRIMARY_REFUSAL = "This is your default method. Make another one the default first.";

/** "TSC is about to pay $1,248.00 to this account." */
export function bankOwedSentence(owed) {
  const totals = new Map();
  for (const { amount, currency } of owed) totals.set(currency, (totals.get(currency) ?? 0) + Number(amount));
  return `TSC is about to pay ${[...totals].map(([currency, amount]) => formatMoney(amount, currency)).join(" and ")} to this account.`;
}

export function PayoutModal({ children, title, onClose, actions, wide = false }) {
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
          <h2 id="payout-modal-title">{title}</h2>
        </header>
        <div className="payout-modal-body">{children}</div>
        {actions ? <footer className="brand-profile-modal-actions payout-modal-actions">{actions}</footer> : null}
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
  handFigures,
  earnings,
  manualAccount,
  manualAccounts = manualAccount ? [manualAccount] : [],
  manualEditingId = null,
  onStartManual,
  onMakePrimaryManual,
  manualForm,
  onManualFieldChange,
  onSaveManual,
  onSaveWise,
  onSavePaypal,
  onDeleteManual,
  manualBusy,
  manualSaved,
  manualOwed = [],
  problem = null,
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
  // The staff-paid form's Save, pressed with something missing.
  const [manualPressed, setManualPressed] = useState(false);
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
  // The step a saved method opens on, and the bank form it uses: Wise's for a
  // bank in China or one set up on it, the staff-paid form elsewhere.
  const stepFor = (row) => {
    if (!row) return "setup";
    if (isPaypal(row)) return "setup-paypal";
    return row.wise_recipient_type || (row.bank_country ?? country) === "CN" ? "setup-wise" : "setup-bank";
  };
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
            setModal(payoutAction === "add" ? "setup" : stepFor(manualAccount));
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
  // Nothing to withdraw yet, but money coming: that is the balance to show,
  // with the day it can be withdrawn, rather than a bare 0.00.
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
    // Started before it left the page: it must still be finished, or new
    // earnings stay held. Nobody starts one any more.
    if (balance?.upgrade && !balance.managedByTsc && (modal === "remove-stripe" || modal === "account")) setModal("upgrade");
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
    if (account !== undefined) onAccountKnown?.(account);
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
      setModal(stepFor(chosenManual));
    } else if (account?.transfers_active && initialAction === "remove" && initialMethodId) {
      // Settings' Remove on one account: straight to its removal dialog.
      setRemoving({ id: initialMethodId });
      setModal("remove-stripe");
    } else if (account?.transfers_active) {
      setModal("manage");
    } else {
      onStartManual?.(manualAccount ?? null);
      setModal(stepFor(manualAccount));
    }
  }, [account, initialAction, initialMethodId, manualAccount, manualAccounts, onStartManual]);

  // The card's shape while the account is read, so it does not appear late
  // and push the page down.
  if (account === undefined) return renderCard ? <PayoutCardPlaceholder isOwner={isOwner} /> : null;

  const closeModal = () => {
    if (!busy && !manualBusy) {
      setMethodMenu(null);
      setManualPressed(false);
      setModal(null);
      onFlowClose?.();
    }
  };

  // Staff cannot pay a bank with no name, an account with no holder, or a
  // country nobody named; a country not listed is named in the instructions.
  const notListed = country === NOT_LISTED;
  const bankFields = bankFieldsFor(notListed ? null : country);
  const editingBank = manualAccounts.find((row) => row.id === manualEditingId) ?? null;
  const hasStoredNumber = Boolean(editingBank?.number_changed_at);
  const typedNumber = normalBankNumber(manualForm?.account_number);
  const numberMismatch = typedNumber !== normalBankNumber(manualForm?.account_number_again) && Boolean(manualForm?.account_number_again);
  const manualReady = Boolean(
    country
    && manualForm?.bank_name?.trim()
    && manualForm?.account_name?.trim()
    && validSwift(manualForm?.swift)
    && (!bankFields.branch.required || manualForm?.branch?.trim())
    && (typedNumber ? validBankNumber(typedNumber) && !numberMismatch : hasStoredNumber && !numberMismatch)
    && (!notListed || manualForm?.instructions?.trim()),
  );

  // Back from a step: to the list when adding; when editing, to where it came from.
  const backFromStep = () => {
    setManualError(null);
    setManualPressed(false);
    if (manualEditingId) {
      if (renderCard) setModal("manage");
      else closeModal();
    } else setModal("setup");
  };
  const stepRow = manualAccounts.find((row) => row.id === manualEditingId) ?? null;

  const manualFieldsContent = manualForm ? (
    <div className="payout-manual-fields">
      <div className="payout-form-grid">
        <label>
          <span>Account holder *</span>
          <input data-field="payout_account_name" value={manualForm.account_name} required onChange={onManualFieldChange("account_name")} />
        </label>
        <label>
          <span>Bank *</span>
          <input data-field="payout_bank_name" value={manualForm.bank_name} required onChange={onManualFieldChange("bank_name")} />
        </label>
        <label>
          <span>{bankFields.numberLabel}{hasStoredNumber ? "" : " *"}</span>
          <input data-field="payout_account_number" autoComplete="off" spellCheck={false} value={manualForm.account_number} required={!hasStoredNumber} onChange={onManualFieldChange("account_number")}
                 placeholder={hasStoredNumber ? `Ending ${editingBank.account_number_last4}` : ""} />
        </label>
        <label>
          <span>Re-enter it{hasStoredNumber && !typedNumber ? "" : " *"}</span>
          <input data-field="payout_account_number_again" autoComplete="off" spellCheck={false} value={manualForm.account_number_again} required={!hasStoredNumber || Boolean(typedNumber)} onChange={onManualFieldChange("account_number_again")} />
        </label>
        <label>
          <span>SWIFT / BIC *</span>
          <input data-field="payout_swift" value={manualForm.swift} required onChange={onManualFieldChange("swift")} />
        </label>
        <label>
          <span>{bankFields.branch.label}{bankFields.branch.required ? " *" : " (optional)"}</span>
          <input data-field="payout_branch" value={manualForm.branch} placeholder={bankFields.branch.placeholder} required={Boolean(bankFields.branch.required)} onChange={onManualFieldChange("branch")} />
        </label>
      </div>
      {numberMismatch ? <p className="live-stripe-error" role="alert">The two account numbers don't match.</p> : null}
      {typedNumber && !validBankNumber(typedNumber) ? <p className="live-stripe-error" role="alert">Enter the account number with letters and digits only, 5 to 34 characters.</p> : null}
      {manualForm.swift && !validSwift(manualForm.swift) ? <p className="live-stripe-error" role="alert">A SWIFT / BIC is 8 or 11 letters and digits.</p> : null}
      <label className="payout-textarea-field">
        <span>{notListed ? "Bank country and transfer instructions *" : "Transfer instructions (optional)"}</span>
        <textarea data-field="payout_instructions" rows={2} value={manualForm.instructions} required={notListed} onChange={onManualFieldChange("instructions")} />
      </label>
      {manualPressed && !manualReady ? <p className="live-stripe-error" role="alert">Fill in the fields marked *.</p> : null}
    </div>
  ) : null;

  const providerMethodRows = connectedMethods.length ? connectedMethods : account?.transfers_active ? [{
    id: "connected-account",
    type: "bank_account",
    name: "",
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
    : balance ? "This method is no longer listed." : null;

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
    else handOver("add");
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
  // One notice at a time, and only about what just happened.
  const openManage = () => {
    setMethodNotice(null);
    setRemoveError(null);
    setModal("manage");
  };

  const openManual = (row) => {
    setManualError(null);
    setMethodNotice(null);
    setManualPressed(false);
    onStartManual?.(row);
    setModal(stepFor(row));
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
      setMethodNotice(`${manualLabel(row)} is now your default.`);
    } catch (failure) {
      setManualError(failure);
    }
  }

  // Which bank account is being removed, and why it may not be yet.
  const otherManual = removingManual ? manualAccounts.filter((row) => row.id !== removingManual.id) : [];
  // The one TSC pays may go: another takes its place, or (the last one)
  // TSC holds the earnings. Only money TSC is sending to it now keeps it.
  const manualRemovalRefusal = !removingManual ? null
    : removingManual.is_primary && !otherManual.length && bankOwed.length ? `${bankOwedSentence(bankOwed)} Remove it after that payment is sent.`
    : null;
  const manualSuccessor = removingManual?.is_primary && otherManual.length
    ? otherManual.find((row) => row.id === promoteId) ?? otherManual[0]
    : null;
  const manualLabel = (row) => (isPayoneer(row) ? `Payoneer ${row.payoneer_email}` : isPaypal(row) ? `PayPal ${row.paypal_email}` : methodLabel({ type: "bank_account", last4: row.account_number_last4 }));

  async function removeManualMethod() {
    setRemoveError(null);
    try {
      await onDeleteManual?.(removingManual, manualSuccessor);
      setModal(null);
      setMethodNotice(listWords(country).removed);
    } catch (failure) {
      // Said in the dialog, where the factory is looking.
      setRemoveError(failure);
    }
  }

  // Only the page's Earnings card passes figures; Settings mounts this for its dialogs.
  const handPaid = Boolean(handFigures) && isHandPaid(account, earnings);
  // Only an owner reads the balance; for anyone else it is not "in progress".
  const cardWords = listWords(country);
  // Something is due on a set-up account (the webhook also emails this):
  // the factory must act, so it is never "in progress".
  const needsMore = Boolean(account?.details_submitted && account.requirements_due?.length);
  const payoutSetupLine = account?.transfers_active
    // The account is known a moment before its balance arrives:
    // that is loading, and only a real failure says it failed.
    ? isOwner ? BALANCE_STATUS_TEXT[balanceStatus] ?? "" : "Only a company owner can see the available balance."
    : account?.details_submitted && !needsMore
      ? "Verification in progress"
      : account
        ? isOwner ? "Finish setup to receive earnings." : "Ask a company owner to finish setup."
        : manualAccount && manualComplete(manualAccount)
          ? manualLabel(manualAccount)
          : manualAccount
            ? isOwner ? "Add your full account number." : "Ask a company owner to add the full account number."
            : isOwner ? cardWords.toReceive : "No withdrawal method yet.";
  // Owed money that bounced: what this person must do next, on the card.
  const failedLine = !problem ? null : isOwner || !problem.fixable ? problem.line : "Ask a company owner to check the withdrawal details.";
  const failedLineZh = !problem || !readsChinese(country) ? null : isOwner || !problem.fixable ? problem.zh : "请联系公司所有者检查提现信息。";

  return (
    <>
      {renderCard ? <section className="live-payout-method-card live-stripe-payout-card" data-testid="stripe-payout-card">
        <div className="live-payout-balance">
          {handPaid ? <>
            {/* Nothing rests in Stripe: the figures are the payments' own
                states, the same as the staff board's. */}
            <span className="payment-metric-label">Balance (USD)</span>
            <strong data-testid="payout-balance">{handFigures.balance ? formatMoney(payoutUsdTotal(handFigures.balance), "USD")
              : handFigures.failed ? "—" : <span className="payout-balance-placeholder" role="status" aria-label="Loading balance" />}</strong>
            {handFigures.onItsWay?.length && !failedLine ? <p data-testid="payout-on-its-way">{formatMoney(payoutUsdTotal(handFigures.onItsWay), "USD")} on its way</p> : null}
            <p data-testid="payout-how-paid">{payoutSetupLine}</p>
          </> : <>
          <span className="payment-metric-label">{currency !== "USD" ? "Available balance (estimated USD)" : "Available balance (USD)"}</span>
          <strong data-testid="payout-balance">{balance ? formatMoney(payoutUsdTotal(balance.available, balance.displayFx), "USD")
            // A placeholder the size of the amount, so the card does not
            // jump when the provider answers.
            : balanceWaiting ? <span className="payout-balance-placeholder" role="status" aria-label="Loading balance" />
            : "—"}</strong>
          {balanceStatus === "loading" && balanceWaiting ? (
            <p className="payout-balance-line payout-balance-placeholder-lines" aria-hidden="true"><span /><span /></p>
          ) : <p className={balance || balanceWaiting ? "payout-balance-line" : undefined}>{balance
            ? [
              // Paid, and not in the balance yet. Not a withdrawal: it has no row until one is made.
              pending > 0 ? `${currency !== "USD" ? "≈" : ""}${formatMoney(payoutUsdTotal(balance.pending, balance.displayFx), "USD")} ${arrivesOn ? `available ${arrivesOn}` : "not available yet"}` : null,
              // Orders are in USD; an account is credited in its own currency.
              currency !== "USD" ? `Paid in ${currency}` : null,
              account?.transfers_active && (!account.payouts_enabled || needsMore) ? "Finish setup to withdraw" : null,
            ].filter(Boolean).join(" · ")
            : payoutSetupLine}</p>}
          </>}
          {balance?.recovery && [...balance.recovery.available, ...balance.recovery.pending].some(row => row.amount !== 0) ? <div role="alert">
            <p>Your previous payout account still has funds.</p>
            {recoveryAvailable > 0 && balance.recovery.payoutsEnabled ? <button className="secondary-btn compact-btn" disabled={busy} onClick={() => {
              setWithdrawal({ previous: true, amount: recoveryAvailable, currency: recoveryCurrency.toLowerCase(), requestId: crypto.randomUUID() });
              setModal("withdraw");
            }}>Withdraw previous balance</button> : <p>Contact <a href={`mailto:${OPERATIONS_EMAIL}`}>TSC operations</a>.</p>}
          </div> : null}
          {failedLine ? <p className="live-stripe-error" role="alert" data-testid="payout-failed">{failedLine}{failedLineZh ? ` ${failedLineZh}` : ""}</p> : null}
          {manualSaved && !failedLine ? <p className="live-payment-notice">{cardWords.saved}</p> : null}
          {withdrawn ? <p className="live-payment-notice" role="status">Withdrawal requested.</p> : null}
          {methodNotice ? <p className="live-payment-notice" role="status" data-testid="payout-method-notice">{methodNotice}</p> : null}
          {error ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
        </div>
        <div className="live-payout-card-action">
          {isOwner ? account?.transfers_active ? (
            <>
            <button className="primary-btn compact-btn" type="button" data-testid="withdraw-balance" disabled={busy || !balance || available <= 0 || !account.payouts_enabled}
              title={!balance ? undefined : !account.payouts_enabled ? "Finish setup to withdraw" : available > 0 ? undefined : pending > 0 ? `Nothing to withdraw yet${arrivesOn ? `. Available ${arrivesOn}` : ""}` : "Nothing to withdraw yet"} onClick={() => {
              setError(null);
              setWithdrawal({ amount: available, currency: currency.toLowerCase(), requestId: crypto.randomUUID() });
              setModal("withdraw");
            }}>Withdraw to bank</button>
            {account.payouts_enabled && !needsMore ? null : <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={() => setModal("onboarding")}>Finish setup</button>}
            <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={openManage}>{cardWords.methods}</button>
            </>
          ) : account ? (
            <button className="primary-btn compact-btn" type="button" disabled={busy} onClick={() => setModal("onboarding")}>Finish setup</button>
          ) : manualAccount && !manualComplete(manualAccount) ? (
            <button className="primary-btn compact-btn" type="button" data-testid="add-payout-method" onClick={() => openManual(manualAccount)}>Add account number</button>
          ) : (
            <button className="primary-btn compact-btn" type="button" data-testid="add-payout-method" onClick={() => (manualAccount ? openManage() : openManual(null))}>{manualAccount ? cardWords.methods : cardWords.add}</button>
          )
          : <button className="primary-btn compact-btn" type="button" disabled title="Only an owner can set up or change payouts">{account?.transfers_active || manualAccount ? cardWords.methods : cardWords.add}</button>}
        </div>
      </section> : null}

      {modal === "withdraw" && withdrawal ? (
        <PayoutModal title="Withdraw to bank" onClose={closeModal} actions={<>
          <button className="secondary-btn" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
          <button className="primary-btn" type="button" disabled={busy} onClick={withdraw}>{busy ? "Withdrawing…" : `Withdraw ${formatMoney(withdrawal.amount, withdrawal.currency)}`}</button>
        </>}>
          <p>Send {formatMoney(withdrawal.amount, withdrawal.currency)} to your {withdrawal.previous ? "previous account’s" : "default"} bank account.</p>
          {error ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "manage" ? (
        <PayoutModal
          title={cardWords.methods}
          onClose={closeModal}
          actions={<button className="secondary-btn" type="button" onClick={closeModal}>{cardWords.done}</button>}
        >
          <div className="payout-methods-heading">
            {/* Add always adds: a new method sits beside the others. */}
            <button className="secondary-btn compact-btn" type="button" disabled={busy || manualBusy} onClick={() => (account ? setModal("add") : openManual(null))}>+ {cardWords.add}</button>
          </div>
          <div className="payout-method-list">
            {account ? providerMethodRows.map((method) => (
              <article className="payout-method-row" key={method.id}>
                <div className="payout-bank-icon" aria-hidden="true">
                  {BANK_ICON}
                </div>
                <div className="payout-method-name">
                  <strong>{methodLabel(method)}</strong>
                  {method.name && !/stripe/i.test(method.name) ? <span>{method.name}</span> : null}
                </div>
                {method.default ? <span className="payout-method-default">Default</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${methodLabel(method)}`} aria-expanded={methodMenu === method.id} disabled={busy || methodBusy} onClick={() => setMethodMenu((open) => open === method.id ? null : method.id)}>...</button>
                  {methodMenu === method.id ? (
                    <div className="payout-method-popover" role="menu">
                      {managed && !method.default && method.standard !== false ? <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); makeStripeDefault(method); }}>Make default</button> : null}
                      <button className="danger" type="button" role="menuitem" disabled={method.id === "connected-account"} onClick={() => { setMethodMenu(null); setRemoving(method); setPromoteId(null); setRemoveError(null); setModal("remove-stripe"); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            )) : manualAccounts.length ? manualAccounts.map((row) => (
              <article className="payout-method-row" key={row.id}>
                <div className="payout-bank-icon" aria-hidden="true">
                  {LETTER_MARK[row.method] ?? BANK_ICON}
                </div>
                <div className="payout-method-name">{isPayoneer(row)
                  ? <><strong>Payoneer</strong><span>{row.payoneer_email}</span></>
                  : isPaypal(row) ? <><strong>PayPal</strong><span>{row.paypal_email}</span></>
                  : <><strong>{manualLabel(row)}</strong><span>{row.number_changed_at ? row.bank_name : "Add your full account number."}</span></>}</div>
                {row.is_primary ? <span className="payout-method-default">Default</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${manualLabel(row)}`} aria-expanded={methodMenu === row.id} disabled={manualBusy} onClick={() => setMethodMenu((open) => open === row.id ? null : row.id)}>...</button>
                  {methodMenu === row.id ? (
                    <div className="payout-method-popover" role="menu">
                      {isPayoneer(row) ? null : <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); openManual(row); }}>{cardWords.edit}</button>}
                      {!row.is_primary ? <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); makePrimary(row); }}>{cardWords.makeDefault}</button> : null}
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMethodMenu(null); setRemovingManual(row); setPromoteId(null); setRemoveError(null); setModal("remove"); }}>{cardWords.remove}</button>
                    </div>
                  ) : null}
                </div>
              </article>
            )) : <div className="payout-empty-guidance">No withdrawal method yet.</div>}
          </div>
          {/* Only one already started, which must finish: nobody starts one here. */}
          {account && balance?.upgrade && !managed ? (
            <div className="payout-info-callout"><p>
              Finish updating your payout account.
              {" "}<button className="secondary-btn compact-btn" type="button" onClick={() => setModal("upgrade")}>Continue</button>
            </p></div>
          ) : null}
          {removeError && modal === "manage" ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
          {methodNotice && modal === "manage" ? <p className="live-payment-notice" role="status">{methodNotice}</p> : null}
          {manualError ? <p className="live-stripe-error" role="alert">{manualError.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "add" ? (
        <PayoutModal title="Add a withdrawal method" onClose={closeModal}>
          <div className="payout-method-options">
            <article className="payout-method-option">
              <div className="payout-option-icon payout-bank-icon" aria-hidden="true">{BANK_ICON}</div>
              <div className="payout-option-copy"><div className="payout-option-title"><strong>Bank account</strong></div></div>
              <button className="primary-btn compact-btn" type="button" data-testid="add-bank-account" disabled={busy} onClick={() => startAdd("bank")}>Set up</button>
            </article>
            <article className="payout-method-option">
              <div className="payout-option-icon payout-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
              </div>
              <div className="payout-option-copy"><div className="payout-option-title"><strong>Debit card</strong></div></div>
              <button className="secondary-btn compact-btn" type="button" data-testid="add-payout-card" disabled={busy} onClick={() => startAdd("card")}>Set up</button>
            </article>
          </div>
          {removeError ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
          <button className="secondary-btn compact-btn payout-back" type="button" onClick={() => setModal("manage")}>Back</button>
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
            : `Remove ${manualLabel(removingManual)}?`}
          onClose={closeModal}
          actions={manualRemovalRefusal
            ? <button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button>
            : <><button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Cancel</button><button className="primary-btn payout-remove-confirm" type="button" disabled={manualBusy} onClick={removeManualMethod}>{manualBusy ? "Removing…" : "Remove method"}</button></>}
        >
          <p className="payout-modal-intro" data-testid="payout-remove-reason">{manualRemovalRefusal
            ?? (manualSuccessor
              ? `${manualLabel(manualSuccessor)}${manualSuccessor.bank_name ? ` (${manualSuccessor.bank_name})` : ""} becomes your default.`
              : removingManual.is_primary
                ? "You'll have no withdrawal method. Earnings wait until you add one."
                : null)}</p>
          {!manualRemovalRefusal && otherManual.length > 1 && removingManual.is_primary ? (
            <label className="payout-country-field">
              <span>New default</span>
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
          title={!balance ? "Remove withdrawal method" : removalRefusal ? `${removingMethod ? methodLabel(removingMethod) : "This account"} can’t be removed` : `Remove ${methodLabel(removingMethod)}?`}
          onClose={closeModal}
          actions={!balance || (removalRefusal && !(managed && removingMethod))
            ? <button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button>
            : removalRefusal
              // Managed, and the last of its currency: put another in its place.
              ? <><button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Back</button><button className="primary-btn" type="button" data-testid="replace-payout-method" onClick={() => { setReplacing(removingMethod); setModal("add-bank"); }}>Replace with another bank account</button></>
              : <><button className="secondary-btn" type="button" disabled={methodBusy} onClick={() => setModal("manage")}>Cancel</button>
                <button className="primary-btn payout-remove-confirm" type="button" data-testid="confirm-remove-payout" disabled={busy || methodBusy}
                        onClick={() => (managed ? confirmStripeRemoval() : handOver("remove", removingMethod))}>
                  {managed ? (methodBusy ? "Removing…" : "Remove method") : "Continue"}
                </button></>}
        >
          <p className="payout-modal-intro" data-testid="payout-remove-reason">{!balance
            ? "Loading…"
            : removalRefusal
              ?? (managed
                ? successor ? `${methodLabel(successor)} becomes your default.` : null
                : `Under Payout details, remove the account ending in ${removingMethod.last4}, then choose Done.`)}</p>
          {!removalRefusal && successors.length > 1 ? (
            <label className="payout-country-field">
              <span>New default</span>
              <select value={successor?.id ?? ""} onChange={(event) => setPromoteId(event.target.value)}>
                {successors.map((method) => <option key={method.id} value={method.id}>{methodLabel(method)}</option>)}
              </select>
            </label>
          ) : null}
          {removeError ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "setup" ? (() => {
        const words = listWords(country);
        return (
          <PayoutModal title={words.title} onClose={closeModal}>
            <label className="payout-country-field">
              <span>{words.country}</span>
              <select data-field="payout_country" value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="" />
                {COUNTRIES.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
                <option value={NOT_LISTED}>Other / not listed</option>
              </select>
            </label>
            {country ? <>
              {notListed ? null : <h3 className="payout-recommended">{words.recommended(countryName(country))}</h3>}
              <div className="payout-method-options" role="group" aria-label={words.title}>
                <article className="payout-method-option">
                  <div className="payout-option-icon payout-bank-icon" aria-hidden="true">{BANK_ICON}</div>
                  <div className="payout-option-copy"><div className="payout-option-title"><strong>{supported ? "Bank account" : words.bank}</strong></div></div>
                  <button className="primary-btn compact-btn" type="button" data-testid="payout-set-up-bank" disabled={busy}
                          onClick={() => { setManualError(null); onStartManual?.(null); setModal(supported ? "onboarding" : country === "CN" ? "setup-wise" : "setup-bank"); }}>{words.setUp}</button>
                </article>
                {supported ? null : (
                  <article className="payout-method-option">
                    <div className="payout-option-icon payout-bank-icon" aria-hidden="true">{LETTER_MARK.paypal}</div>
                    <div className="payout-option-copy"><div className="payout-option-title"><strong>PayPal</strong></div></div>
                    <button className="secondary-btn compact-btn" type="button" data-testid="payout-set-up-paypal" disabled={busy}
                            onClick={() => { setManualError(null); onStartManual?.(null); setModal("setup-paypal"); }}>{words.setUp}</button>
                  </article>
                )}
              </div>
            </> : null}
            {/* To the list when there is one; a first method came from the page. */}
            <button className="secondary-btn compact-btn payout-back" type="button" onClick={() => (renderCard && (account || manualAccounts.length) ? setModal("manage") : closeModal())}>{words.back}</button>
          </PayoutModal>
        );
      })() : null}

      {modal === "setup-wise" ? (
        <WiseBankStep row={stepRow} country="CN" busy={manualBusy} saveWise={onSaveWise} onBack={backFromStep} onClose={closeModal} />
      ) : null}

      {modal === "setup-paypal" && manualForm ? (
        <PaypalStep row={stepRow} country={stepRow?.bank_country ?? country} form={manualForm} busy={manualBusy} onField={onManualFieldChange} savePaypal={onSavePaypal} onBack={backFromStep} onClose={closeModal} />
      ) : null}

      {modal === "setup-bank" ? (
        <PayoutModal title={manualEditingId ? "Edit bank account" : "Bank transfer"} onClose={closeModal} actions={<>
          {/* In the footer, beside Save: this form can be taller than its dialog. */}
          {manualError ? <p className="live-stripe-error payout-modal-refusal" role="alert">{manualError.message}</p> : null}
          <button className="secondary-btn" type="button" onClick={backFromStep}>Back</button>
          <button className="primary-btn" type="button" data-testid="save-payout" disabled={manualBusy}
                  onClick={() => { setManualPressed(true); if (manualReady) saveManual({ bank_country: notListed ? null : country }); }}>
            {manualBusy ? "Saving…" : "Save"}
          </button>
        </>}>
          {manualFieldsContent}
        </PayoutModal>
      ) : null}

      {modal === "resume" ? (
        <PayoutModal
          title="Continue your setup"
          onClose={closeModal}
          actions={<><button className="secondary-btn" type="button" onClick={closeModal}>Not now</button><button className="primary-btn" type="button" disabled={busy} onClick={() => setModal("onboarding")}>Continue</button></>}
        >
          <p className="payout-modal-intro">Your setup link expired. Continue where you left off.</p>
        </PayoutModal>
      ) : null}

      {modal === "upgrade" ? (
        <PayoutModal title="Finish updating your payout account" onClose={closeModal}
          actions={<><button className="secondary-btn" type="button" disabled={busy} onClick={closeModal}>Not now</button>
            <button className="primary-btn" type="button" disabled={busy} onClick={startUpgrade}>{busy ? "Starting…" : "Continue verification"}</button>
            <button className="secondary-btn" type="button" disabled={busy} onClick={finishUpgrade}>Check and finish</button></>}>
          {balance?.upgrade ? <p role="status">{balance.upgrade.verified ? "Replacement account verified." : "Complete verification for the replacement account."} {balance.upgrade.unsettled ? "Your old account still has funds or a withdrawal settling. Withdraw what's available, then check again." : "The old account is settled."}</p> : null}
          {removeError ? <p className="live-stripe-error" role="alert">{removeError.message}</p> : null}
        </PayoutModal>
      ) : null}
      {modal === "upgrade-onboarding" ? (
        <PayoutModal wide title="Verify your replacement payout account" onClose={closeStripeForm}
          actions={<button className="secondary-btn" type="button" onClick={closeStripeForm}>Close</button>}>
          <StripeConnectEmbed org={org} upgrade form="onboarding" onExit={closeStripeForm} />
        </PayoutModal>
      ) : null}

      {modal === "onboarding" ? (
        <PayoutModal
          wide
          title="Bank account"
          onClose={closeStripeForm}
          actions={<button className="secondary-btn" type="button" onClick={closeStripeForm}>Close</button>}
        >
          <StripeConnectEmbed org={org} country={supported ? country : undefined} form="onboarding" onExit={closeStripeForm} />
        </PayoutModal>
      ) : null}

      {modal === "account" ? (
        <PayoutModal
          wide
          title="Payout account"
          onClose={closeStripeForm}
          actions={<button className="secondary-btn" type="button" onClick={closeStripeForm}>Done</button>}
        >
          {handover ? <p className="payout-modal-intro">{handover.intent === "add"
            ? "Under “Payout details”, add the bank account or card, then choose Done."
            : `Under “Payout details”, remove the account ending in ${handover.target?.last4}, then choose Done.`}</p> : null}
          <StripeConnectEmbed org={org} form="account" />
        </PayoutModal>
      ) : null}

    </>
  );
}
