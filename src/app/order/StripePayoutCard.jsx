import { balanceCurrency } from "../../lib/payout-currency.mjs";
import { owedToTscCents, owedToTscLine, parseWithdrawAmount, pendingParts, withdrawFeeLine, withdrawReach } from "./payment-summary.mjs";
import { minimumWithdrawalSentence, stripeMinimumWithdrawal, withdrawalFee } from "../../shared/withdrawal-fees.mjs";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SIGN_IN_ENDED, supabase } from "../../lib/supabase.js";
import { useUiLanguage } from "../../lib/ui-language.js";
import { countryNameZh, wholeEntry } from "../live-zh.js";
import { formatMoney } from "../../lib/money.js";
import { connectAccountFor, connectAction } from "../../lib/domain/stripe.js";
import { PAYOUT_COUNTRIES } from "../../shared/stripe-payout-countries.mjs";
import { chooserMethod, paidByWise, payoutMethodLines, payoutMethodFeeUrl } from "../../shared/payout-method-info.mjs";
import StripeConnectEmbed from "./StripeConnectEmbed.jsx";
import { forgetStripeConnect } from "../../lib/stripe-connect-embed.js";
import AddPayoutMethodForm from "./AddPayoutMethodForm.jsx";
import PaymentHelp, { PENDING_HELP } from "./PaymentHelp.jsx";

import { PaypalStep, WiseBankStep } from "./PayoutSetupSteps.jsx";
import { CancelWithdrawalsForm, WithdrawForm, WithdrawalStatus, usable, useWithdrawalBalance, withdrawOptionLabel } from "./WithdrawFromBalance.jsx";
import { methodProviderOn, providerOnFor, usePayoutProviders } from "./payout-providers.js";

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
// What a new method saves as its country: "ZZ" (ISO's unknown) for not listed.
const savedCountry = (code) => (code === NOT_LISTED ? "ZZ" : code || null);

const OPERATIONS_EMAIL = "operations@contact.sourcing-club.com";

/** A plain letter, not a provider's logo: using that needs their permission. */
const LETTER_MARK = { paypal: <strong>P</strong> };

const isPaypal = (row) => row?.method === "paypal";
const manualComplete = (row) => isPaypal(row) || Boolean(row?.bank_name?.trim() && row?.account_name?.trim() && row?.number_changed_at);
/** A list's rows, its default first; the others keep their order (sort is stable). */
const defaultFirst = (entries) => [...entries].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((entry) => entry.node);
const BANK_ICON = <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>;

/** The words for the list of withdrawal methods. The factory's screens are English, so these are too. */
const LIST_WORDS = {
  title: "Add a withdrawal method", bank: "Bank transfer", setUp: "Set up", country: "Country",
  methods: "Withdrawal methods", add: "Add withdrawal method", toReceive: "Add a withdrawal method to receive earnings.",
  edit: "Edit method", makeDefault: "Make default", remove: "Remove method", back: "Back", done: "Done",
  saved: "Withdrawal method saved.", removed: "Withdrawal method removed.",
  recommended: (name) => `Recommended for ${name}`,
  available: "Available",
  bankUnavailable: "A bank transfer isn't available right now. You can set up PayPal instead.",
  setUpPaypal: "Set up PayPal",
  noneAvailable: "No withdrawal method is available for this country right now.",
};

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

/** Why money already earned cannot be withdrawn yet: Stripe's date for it. */
export const availableOnWords = (day) => `Available to withdraw on ${day}`;

const endingIn = (name, last4) => `${name}${last4 ? ` ····${last4}` : ""}`;

/** "Bank account ····2345", the name it was added under, wherever it is drawn. */
function methodLabel(method) {
  return endingIn(method.type === "card" ? "Debit card" : "Bank account", method.last4);
}

/** The list's name for a saved method: the chooser's, provider included ("Bank account (Stripe) ····2345"). */
function listLabel(method) {
  return method.type === "card" ? methodLabel(method) : endingIn("Bank account (Stripe)", method.last4);
}

/** The same in the page's language, for the Withdraw dialog's options: the language layer never rewrites a select. */
const listLabelIn = (method, language) => (language !== "zh" ? listLabel(method)
  : endingIn(method.type === "card" ? "借记卡" : wholeEntry("Bank account (Stripe)") ?? "Bank account (Stripe)", method.last4));

/** Where a country has two bank options, this one needs telling from "Bank account". */
// A US bank is paid US$ to US$ at home: a bank transfer, not an international one.
export const transferName = (country) => (PAYOUT_COUNTRIES.has(country) && country !== "US" ? "International bank transfer" : LIST_WORDS.bank);

/** "Re-enter IBAN", "Re-enter account number": the second field says what the first one is. */
export const reEnter = (label) => `Re-enter ${/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label}`;

/**
 * Why the default could not change, in the factory's words. The database's
 * sentence about a payout in progress is written for staff.
 */
function defaultRefusal(failure) {
  const refused = failure?.cause ?? failure;
  if (refused?.code !== "22023") return failure;
  return new Error(/pending payout/i.test(refused.message ?? "") ? "You can change your default once the current payout finishes." : refused.message);
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

const FOCUS_STOPS = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])';

export function PayoutModal({ children, title, onClose, actions, wide = false, className = "", keepOpen = false }) {
  const dialog = useRef(null);
  // Into the dialog on opening, and back where it was on closing. One step
  // replacing another hands on the same element, since this runs per mount.
  useEffect(() => {
    const before = document.activeElement;
    dialog.current?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  }, []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    const onKeyDown = (event) => {
      // An open "..." menu takes the Esc (the list closes it); a form with
      // typed details is left only by its own buttons.
      if (event.key === "Escape" && !keepOpen && !document.querySelector(".payout-method-popover")) onClose();
      // Tab stays in the dialog: the page behind it is not in use.
      if (event.key !== "Tab" || !dialog.current) return;
      const stops = [...dialog.current.querySelectorAll(FOCUS_STOPS)].filter((element) => element.getClientRects().length);
      if (!stops.length) return;
      const active = document.activeElement;
      const outside = !dialog.current.contains(active);
      if (event.shiftKey ? outside || active === dialog.current || active === stops[0] : outside || active === stops[stops.length - 1]) {
        event.preventDefault();
        (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, keepOpen]);

  return createPortal(
    <div className={`brand-profile-modal-layer payout-modal-layer${wide ? " tsc-connect-layer" : ""}`}>
      <button className="brand-profile-modal-scrim" type="button" aria-label="Close" onClick={keepOpen ? undefined : onClose} />
      <section ref={dialog} tabIndex={-1} className={`brand-profile-modal payout-modal${wide ? " tsc-connect-modal" : ""} ${className}`} role="dialog" aria-modal="true" aria-labelledby="payout-modal-title">
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
 * A message in a payout dialog: first in its body, in TSC's box (red for an
 * error; blue for a success or information), scrolled into view when it
 * appears, since a form can be taller than its dialog.
 */
export function ModalMessage({ tone = "error", children, ...rest }) {
  const box = useRef(null);
  useEffect(() => { box.current?.scrollIntoView?.({ block: "nearest" }); }, [children]);
  return <div ref={box} className={tone === "error" ? "payout-modal-error" : "payout-modal-notice"} role={tone === "error" ? "alert" : "status"} {...rest}>{children}</div>;
}

/** A method's fee and timing, under its name (src/shared/payout-method-info.mjs). */
const MethodLines = ({ method }) => <ul>{payoutMethodLines(method).map((line, index) => <li key={line}>{line}{index === 0 && payoutMethodFeeUrl(method) ? <> · <a href={payoutMethodFeeUrl(method)} target="_blank" rel="noopener noreferrer">Full fee details</a></> : null}</li>)}</ul>;

/** Presentation only; the live payout flow owns every setup action. */
export function PayoutOptions({ country, onCountryChange, supported, notListed, busy, onBank, onWise, onPaypal, providers = null }) {
  const words = LIST_WORDS;
  // The country list in the page's language: the language layer never rewrites a select.
  const zh = useUiLanguage() === "zh";
  const countries = zh ? COUNTRIES.map((item) => ({ ...item, name: countryNameZh(item.code) ?? item.name })).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")) : COUNTRIES;
  // Staff switch PayPal and Wise per region; the picked country decides the
  // region (usePayoutProviders). None passed is all on.
  const paypalOnFor = (code) => providerOnFor(providers, "paypal", savedCountry(code));
  const wiseOnFor = (code) => providerOnFor(providers, "wise", savedCountry(code));
  // A country is listed only while some method can pay there.
  const listed = (code) => PAYOUT_COUNTRIES.has(code) || (wiseOnFor(code) && paidByWise(code)) || paypalOnFor(code);
  const shownCountries = countries.filter((item) => listed(item.code));
  const otherListed = listed(NOT_LISTED);
  // A saved or company country no longer listed starts blank.
  const picked = country && listed(country) ? country : "";
  const paypalOn = paypalOnFor(picked);
  const wiseOn = wiseOnFor(picked);
  // TSC pays only through Stripe, Wise, PayPal or Tazapay: where neither Stripe
  // nor Wise has a bank route, PayPal is the one option.
  const bankRoute = supported || (wiseOn && paidByWise(picked));
  const paypalOption = (primary) => (
                <article className="payout-method-option">
                  <div className="payout-option-icon payout-bank-icon" aria-hidden="true"><img src="/assets/paypal-mark.jpg" alt="" width="32" height="20" /></div>
                  <div className="payout-option-copy"><div className="payout-option-title"><strong>PayPal</strong></div><MethodLines method={chooserMethod("paypal", { supported, country: picked })} /></div>
                  <button className={`${primary ? "primary-btn" : "secondary-btn"} compact-btn`} type="button" data-testid="payout-set-up-paypal" disabled={busy}
                          onClick={onPaypal}>{words.setUp}</button>
                </article>
  );
  return <>
            <label className="payout-country-field">
              <span>{words.country}</span>
              <select data-field="payout_country" value={picked} onChange={(event) => onCountryChange(event.target.value)}>
                <option value="" />
                {shownCountries.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
                {otherListed ? <option value={NOT_LISTED}>{zh ? "其他 / 未列出" : "Other / not listed"}</option> : null}
              </select>
            </label>
            {picked && !bankRoute && !paypalOn ? (
              <p className="payout-modal-intro" data-testid="payout-none-available">{words.noneAvailable}</p>
            ) : picked && !bankRoute ? (
              <div className="payout-options-columns">
              <section className="payout-options-section">
              <h3 className="payout-recommended">{notListed ? words.available : words.recommended(countryName(picked))}</h3>
              <div className="payout-method-options" role="group" aria-label={notListed ? words.available : words.recommended(countryName(picked))}>
                {paypalOption(true)}
              </div>
              </section>
              </div>
            ) : picked ? <>
              <div className="payout-options-columns">
              <section className="payout-options-section">
              <h3 className="payout-recommended">{notListed ? words.bank : words.recommended(countryName(picked))}</h3>
              <div className="payout-method-options" role="group" aria-label={notListed ? words.bank : words.recommended(countryName(picked))}>
                <article className="payout-method-option">
                  <div className="payout-option-icon payout-bank-icon" aria-hidden="true">{BANK_ICON}</div>
                  <div className="payout-option-copy"><div className="payout-option-title"><strong>{supported ? "Bank account (Stripe)" : paidByWise(picked) ? `${words.bank} (Wise)` : words.bank}</strong></div><MethodLines method={chooserMethod("bank", { supported, country: picked })} /></div>
                  <button className="primary-btn compact-btn" type="button" data-testid="payout-set-up-bank" disabled={busy}
                          onClick={onBank}>{words.setUp}</button>
                </article>
              </div>
              </section>
              {(supported && wiseOn) || paypalOn ? <section className="payout-options-section">
              <h3 className="payout-recommended">Also available</h3>
              <div className="payout-method-options" role="group" aria-label="Also available">
                {supported && wiseOn ? (
                  <article className="payout-method-option">
                    <div className="payout-option-icon payout-bank-icon" aria-hidden="true">{BANK_ICON}</div>
                    <div className="payout-option-copy"><div className="payout-option-title"><strong>{transferName(picked)} (Wise)</strong></div><MethodLines method={chooserMethod("wise", { supported, country: picked })} /></div>
                    <button className="secondary-btn compact-btn" type="button" data-testid="payout-set-up-wise" disabled={busy}
                            onClick={onWise}>{words.setUp}</button>
                  </article>
                ) : null}
                {paypalOn ? paypalOption(false) : null}
              </div>
              </section> : null}
              </div>
            </> : null}
  </>;
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
        <strong><span className="payout-balance-placeholder" role="status" aria-label="Loading withdrawals" /></strong>
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
  // The one balance (the page's figures, all clients): null while they load,
  // undefined where the card is mounted for its dialogs only (Settings).
  figures = undefined,
  figuresFailed = false,
  manualAccount,
  manualAccounts = manualAccount ? [manualAccount] : [],
  manualEditingId = null,
  onStartManual,
  onMakePrimaryManual,
  manualForm,
  onManualFieldChange,
  onSaveWise,
  onSavePaypal,
  onDeleteManual,
  // Read the saved methods again (one removed in another tab meanwhile).
  onMethodsChanged,
  manualBusy,
  manualSaved,
  manualOwed = [],
  problem = null,
  // The page's Pending figure (all clients, US$ cents): the card's "$X pending" is read from it.
  pendingTotal = null,
  // Old step-by-step payouts still being sent (legacyOnItsWayCents): said on their own line.
  onItsWayCents = 0,
  renderCard = true,
  initialAction = null,
  initialMethodId = null,
  onFlowClose,
}) {
  const [account, setAccount] = useState(undefined);
  // The saved method a Withdraw opened on, when chosen in the other dialog.
  const [withdrawFromId, setWithdrawFromId] = useState(null);
  const [balance, setBalance] = useState(null);
  const uiLanguage = useUiLanguage();
  // Where reading Stripe's balance stands: "loading", "slow" (still loading
  // after SLOW_BALANCE_MS), "failed", "ready", or "none" when it is not read
  // (not an owner, no active Stripe account). The card said "We could not
  // show your balance" for the two seconds a normal read takes.
  const [balanceStatus, setBalanceStatus] = useState("loading");
  const [country, setCountry] = useState("");
  const [payoutRoute, setPayoutRoute] = useState("stripe");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [methodMenu, setMethodMenu] = useState(null);
  // A notice said in Withdrawal methods only (a new default), not on the card.
  const shownInDialogOnly = useRef(null);
  const [withdrawal, setWithdrawal] = useState(null);
  // Paid by Wise, PayPal or bank transfer: the balance the factory withdraws from.
  const fromBalance = useWithdrawalBalance(org.id, figures !== undefined && renderCard, manualAccount?.id);
  // PayPal and Wise as staff have switched them for this company's region.
  const providers = usePayoutProviders(org.id, isOwner);
  const [withdrawalError, setWithdrawalError] = useState(null);
  const [cancelFirst, setCancelFirst] = useState(null);
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
  // What each method can reach, read again after anything that moves money
  // (a withdrawal, a cancel, an approval, a method change) and when Withdraw
  // is opened: the balance read's `reach` is only as new as that read.
  const [freshReach, setFreshReach] = useState(null);
  const withdrawing = useRef(false);
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
    const closeOnEscape = (event) => { if (event.key === "Escape") setMethodMenu(null); };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [methodMenu]);

  const manualCountry = manualAccount?.bank_country?.trim() || "";
  // The step a saved method opens on. Every bank account is on Wise's form:
  // TSC no longer pays one by hand.
  const stepFor = (row) => {
    if (!row) return "setup";
    if (isPaypal(row)) return "setup-paypal";
    return "setup-wise";
  };
  const load = useCallback(async () => {
    const [saved, { data: profile }, preference] = await Promise.all([
      connectAccountFor(org.id),
      supabase.from("factory_profiles").select("country_code").eq("org_id", org.id).maybeSingle(),
      supabase.from("factory_payout_preferences").select("route").eq("org_id", org.id).maybeSingle(),
    ]);
    if (preference.error) throw new Error("Could not load your default withdrawal method. Try again.");
    // The database's rule (uses_stripe_payout): an account that can't take transfers pays nobody.
    setPayoutRoute(saved?.transfers_active && preference.data?.route !== "manual" ? "stripe" : "manual");
    setAccount(saved);
    accountKnown.current = true;
    setCountry((current) => current || saved?.country || manualCountry || profile?.country_code || "");
    if (saved && isOwner) {
      setBalanceStatus("loading");
      try {
        const nextBalance = await connectAction(org.id, "balance");
        setBalance(nextBalance);
        setFreshReach(null);
        setBalanceStatus("ready");
        onBalanceChange?.(nextBalance);
        return nextBalance;
      } catch (failure) {
        // Reading a legacy balance is separate from saving a payout preference.
        // Stripe unreachable: the server still answers with the database's
        // figures (failure.details.figures), shown rather than a blank card.
        setBalance(null);
        setBalanceStatus("failed");
        onBalanceChange?.(null, failure?.details?.figures ?? null);
        return null;
      }
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
  const recoveryCurrency = balanceCurrency(balance?.recovery);
  const recoveryAvailable = amountIn(balance?.recovery?.available, recoveryCurrency);
  const connectedMethods = balance?.methods ?? [];
  // Where TSC adds and removes payout accounts itself, rather than Stripe's form.
  const managed = Boolean(balance?.managedByTsc);
  useEffect(() => {
    // Started before it left the page: it must still be finished, or new
    // earnings stay held. Nobody starts one any more.
    if (balance?.upgrade && !balance.managedByTsc && (modal === "remove-stripe" || modal === "account")) setModal("upgrade");
  }, [balance, modal]);

  async function withdraw() {
    // A second click before `busy` reaches the button would ask again with the
    // same request id, and Stripe's "already being processed" answer was then
    // left on the card under a withdrawal that went through.
    if (withdrawing.current || busy || !withdrawal || !(withdrawal.amount > 0) || (withdrawal.max != null && withdrawal.amount > withdrawal.max) || stripeMinimumProblem) return;
    withdrawing.current = true;
    setBusy(true);
    setError(null);
    try {
      const { amount: sendAmount, currency: sendCurrency, requestId, destination } = withdrawal;
      await connectAction(org.id, withdrawal.previous ? "withdraw_previous" : "withdraw",
        { amount: sendAmount, currency: sendCurrency, requestId, ...(withdrawal.previous || !destination ? {} : { destination }) });
      setWithdrawal(null);
      setModal(null);
      // Never leave an already-withdrawn amount available if refreshing fails.
      setBalance(null);
      onBalanceChange?.(undefined);
      await load();
    } catch (failure) {
      // Signed out meanwhile (in another tab): say so, not "try again".
      const signedOut = failure?.status === 401 || !(await supabase.auth.getSession()).data?.session;
      setError(signedOut ? new Error(SIGN_IN_ENDED) : failure);
      // Refused ("You can withdraw up to $X."), perhaps because another owner
      // withdrew first: read the balance again at once, Stripe part included,
      // so the card and this dialog's Available show what is left now.
      if (!signedOut) {
        setFreshReach(null);
        fromBalance.load();
        await load().catch(() => null);
      }
    } finally {
      withdrawing.current = false;
      setBusy(false);
    }
  }
  // Stripe's embedded forms save as the factory goes, so closing one is
  // finishing it: read the account back (which also pays out anything owed
  // once transfers are on) and the payout methods with it.
  function closeStripeForm() {
    setModal(null);
    onFlowClose?.();
    readBackStripeForm(handover);
  }
  // Back to the step the form was chosen from: saved so far stays saved.
  function backFromStripeForm(step) {
    setModal(step);
    readBackStripeForm(null);
  }
  async function readBackStripeForm(wentToDo) {
    setError(null);
    // Not `busy`: the balance on screen stays usable while Stripe is read
    // back (several seconds), and Stripe refuses a withdrawal it cannot pay.
    try {
      // No account means the form never got as far as creating one.
      if (await connectAccountFor(org.id)) await connectAction(org.id, "refresh");
      // Finished just now: a new method becomes the default, unless a payout is under way.
      if (!account?.transfers_active && (await connectAccountFor(org.id))?.transfers_active) {
        await supabase.rpc("choose_payout_method", { target_org: org.id, target_account: null });
      }
      const next = await load();
      if (wentToDo) setMethodNotice(handoverResult(wentToDo, next?.methods ?? []));
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
    const chosenManual = initialMethodId ? manualAccounts.find((row) => row.id === initialMethodId) : manualAccount;
    if (initialAction === "manage") {
      setModal(account || manualAccount ? "manage" : "setup");
    } else if (initialAction === "add") {
      // Add always adds: a bank-paid factory's new account never overwrites one.
      if (account?.transfers_active) setModal("add");
      else { onStartManual?.(null); setModal("setup"); }
    } else if (initialAction === "remove" && chosenManual) {
      setRemovingManual(chosenManual);
      setRemoveError(null);
      setModal("remove");
    } else if (initialAction === "edit" && chosenManual) {
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
  const readReach = useCallback(async () => {
    if (!isOwner || !account?.transfers_active) return null;
    try {
      const { reach: next } = await connectAction(org.id, "figures");
      if (next) setFreshReach(next);
      return next ?? null;
    } catch (failure) {
      if (failure?.details?.reach) setFreshReach(failure.details.reach);
      return failure?.details?.reach ?? null;
    }
  }, [org.id, isOwner, account?.transfers_active]);
  const movedKey = `${fromBalance.available}|${fromBalance.rows?.length}|${(fromBalance.opens ?? []).length}|${figures?.available_cents}|${figures?.pending_cents}|${figures?.processing_cents}|${figures?.paid_out_cents}|${manualAccounts.length}`;
  const movedSeen = useRef(null);
  useEffect(() => {
    if (movedSeen.current === null) { movedSeen.current = movedKey; return; }
    if (movedSeen.current === movedKey) return;
    movedSeen.current = movedKey;
    readReach();
  }, [movedKey, readReach]);
  // An open Stripe dialog follows: its Available is never older than the card.
  const liveStripeMax = (freshReach ?? balance?.reach)?.stripe_cents;
  useEffect(() => {
    if (modal !== "withdraw" || !withdrawal || withdrawal.previous || liveStripeMax == null || liveStripeMax === withdrawal.max) return;
    setWithdrawal((was) => (was ? { ...was, max: liveStripeMax } : was));
  }, [modal, withdrawal, liveStripeMax]);

  if (account === undefined) return renderCard ? <PayoutCardPlaceholder isOwner={isOwner} /> : null;

  const closeModal = () => {
    if (!busy && !manualBusy) {
      setMethodMenu(null);
      setError(null);
      setModal(null);
      onFlowClose?.();
    }
  };

  const notListed = country === NOT_LISTED;

  // Back from a step: to the list when adding; when editing, to where it came from.
  const backFromStep = () => {
    setManualError(null);
    if (manualEditingId) {
      if (renderCard) setModal("manage");
      else closeModal();
    } else setModal("setup");
  };
  const stepRow = manualAccounts.find((row) => row.id === manualEditingId) ?? null;
  // Settings opens a removal straight from its own row, with no list behind it.
  // A failure belongs to the step that had it: going back leaves it behind.
  const backToList = () => { setRemoveError(null); setManualError(null); return renderCard ? setModal("manage") : closeModal(); };


  // An account still being set up pays nobody: it has its own row, to finish it.
  const providerMethodRows = !account?.transfers_active ? [] : connectedMethods.length ? connectedMethods : [{
    id: "connected-account",
    type: "bank_account",
    name: "",
    last4: "",
    currency: currency.toLowerCase(),
    default: true,
  }];

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
  // Money being sent to a saved method now, by account (useManualPayouts).
  const bankOwed = manualOwed;
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

  const makeStripeDefault = async (method) => {
    setMethodBusy(true);
    setRemoveError(null);
    setManualError(null);
    try {
      if (!method.default && !await changeMethod("default_method", { methodId: method.id })) return;
      const result = await supabase.rpc("choose_payout_method", { target_org: org.id, target_account: null });
      if (result.error) throw result.error;
      setPayoutRoute("stripe");
      await load().catch(setError);
      shownInDialogOnly.current = `${methodLabel(method)} is now your default.`;
      setMethodNotice(shownInDialogOnly.current);
    } catch (failure) { setRemoveError(defaultRefusal(failure)); }
    finally { setMethodBusy(false); }
  };

  // A new account is in (and, for a Replace, the old one out: the server
  // does both in one request). Adding never changes the default: the factory
  // chooses one with Make default.
  function methodAdded(result) {
    // Stripe's first bank is Stripe's default, but TSC still pays the saved
    // method the factory chose, so the notice must not call it the default.
    applyMethods(payoutRoute === "manual" && result.notice
      ? { ...result, notice: result.notice.replace(" and is now the default.", ".") } : result);
    setReplacing(null);
    setModal("manage");
  }

  const startAdd = () => {
    setMethodNotice(null);
    setRemoveError(null);
    if (managed) setModal("add-bank");
    else handOver("add");
  };

  // Bank account (Stripe), chosen under Add. An active account with nothing
  // due adds a bank; any other opens Stripe's form where the setup was left,
  // which asks only for what is still needed. A setup left halfway for
  // another country is replaced first if it was never used (stripe-connect
  // `restart`); otherwise the server says to choose another method.
  async function chooseStripeBank() {
    setManualError(null);
    setRemoveError(null);
    onStartManual?.(null);
    if (account?.transfers_active && (paused || (account.payouts_enabled && !needsMore))) { startAdd(); return; }
    if (account && !account.transfers_active && String(account.country ?? "").toUpperCase() !== country) {
      setBusy(true);
      try {
        const { restarted } = await connectAction(org.id, "restart", { country });
        if (restarted) {
          forgetStripeConnect(org.id);
          await load();
        }
      } catch (failure) {
        setRemoveError(failure);
        return;
      } finally {
        setBusy(false);
      }
    }
    setModal("onboarding-chosen");
  }

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
    onStartManual?.(row);
    setModal(stepFor(row));
  };

  async function makePrimary(row) {
    setManualError(null);
    setRemoveError(null);
    try {
      await onMakePrimaryManual?.(row);
      setPayoutRoute("manual");
      await load().catch(setError);
      shownInDialogOnly.current = `${manualLabel(row)} is now your default.`;
      setMethodNotice(shownInDialogOnly.current);
    } catch (failure) {
      setManualError(defaultRefusal(failure));
    }
  }

  // Which bank account is being removed, and why it may not be yet.
  const otherManual = removingManual ? manualAccounts.filter((row) => row.id !== removingManual.id) : [];
  // Any method may go (the default: another takes its place, or the last one
  // and TSC holds the earnings). Only money TSC is sending to it now keeps it;
  // the database's payout_owed refusal is the backstop (payoutRemovalError).
  const sendingToRemoved = removingManual ? bankOwed.filter((row) => row.accountId === removingManual.id) : [];
  const manualRemovalRefusal = !removingManual ? null
    : sendingToRemoved.length ? `${bankOwedSentence(sendingToRemoved)} Remove it after that payment is sent.`
    : null;
  const manualSuccessor = removingManual?.is_primary && otherManual.length
    ? otherManual.find((row) => row.id === promoteId) ?? otherManual[0]
    : null;
  // Removing the last manual method hands payouts back to the banks below it.
  const otherProviderMethods = account?.transfers_active ? providerMethodRows : [];
  // Where a Stripe withdrawal can go this once: the account's own, in the balance's
  // currency, taking standard payouts. Choosing one never changes the default.
  const stripeWithdrawTargets = connectedMethods.filter((m) => m.id !== "connected-account"
    && String(m.currency ?? "").toLowerCase() === currency.toLowerCase() && m.standard !== false);
  const nextProviderMethod = otherProviderMethods.find((method) => method.default && method.last4) ?? null;
  const manualLabel = (row) => (isPaypal(row) ? `PayPal ${row.paypal_email}` : endingIn(transferName(row.bank_country), row.account_number_last4));
  // A bank Wise pays says so, as in the chooser. Wise pays a bank row only with a
  // Wise recipient on it (the server's rule, 20261108163459); without one, staff
  // pay it by bank, China included.
  const manualListLabel = (row) => (row?.method === "bank" && row.wise_recipient_type ? endingIn(`${transferName(row.bank_country)} (Wise)`, row.account_number_last4) : manualLabel(row));

  const manualRemovalLine = !removingManual ? null : manualRemovalRefusal
    ?? (manualSuccessor
      ? `${manualLabel(manualSuccessor)}${manualSuccessor.bank_name ? ` (${manualSuccessor.bank_name})` : ""} becomes your default.`
      : !removingManual.is_primary
        ? null
        : !otherProviderMethods.length
          ? "You'll have no withdrawal method. Earnings wait until you add one."
          : payoutRoute === "manual" && nextProviderMethod
            ? `${methodLabel(nextProviderMethod)} becomes your default.`
            : null);

  async function removeManualMethod() {
    setRemoveError(null);
    try {
      await onDeleteManual?.(removingManual, manualSuccessor);
      // Back to the list, as a Stripe method's removal does: the message is said there.
      setModal(renderCard ? "manage" : null);
      setMethodNotice(LIST_WORDS.removed);
    } catch (failure) {
      // Said in the dialog, where the factory is looking; what is being sent
      // to it is read again, so the dialog turns to its refusal (Back only).
      setRemoveError(failure);
      onMethodsChanged?.();
    }
  }

  // Only the page's Earnings card passes figures (null while they load);
  // Settings mounts this for its dialogs and passes none.
  const onPage = figures !== undefined;
  // Only an owner reads the balance; for anyone else it is not "in progress".
  const cardWords = LIST_WORDS;
  // Something is due on a set-up account (the webhook also emails this):
  // the factory must act, so it is never "in progress".
  const needsMore = Boolean(account?.details_submitted && account.requirements_due?.length);
  // Withdrawals stopped with nothing due: under review, nothing to finish.
  const paused = Boolean(account?.transfers_active && !account.payouts_enabled && !account.requirements_due?.length);
  // What is saved is what TSC pays, whatever unfinished account sits beside it.
  const savedMethod = Boolean(manualAccount && manualComplete(manualAccount));
  const verifying = Boolean(account?.details_submitted && !needsMore);
  const payoutSetupLine = account?.transfers_active
    // The account is known a moment before its balance arrives: that is
    // loading, and only a real failure says it failed. When the balance
    // came back without Stripe, its figures are shown and say nothing more.
    ? isOwner && !(figures && balanceStatus === "failed") ? BALANCE_STATUS_TEXT[balanceStatus] ?? "" : ""
    // A saved method needs no line: the withdrawals below say where money went.
    : savedMethod
      ? ""
      : verifying
        ? "Verification in progress"
        // A setup left halfway starts again under Add, so it reads as none.
        : manualAccount
            ? isOwner ? "Add your full account number." : ""
            : isOwner ? cardWords.toReceive : "No withdrawal method yet.";
  // Owed money that bounced: what this person must do next, on the card.
  const failedLine = !problem ? null : isOwner || !problem.fixable ? problem.line : null;

  // The one balance (D3): the big number is the server's Available, for
  // every factory, however it withdraws. The page's four figures are the
  // same read, so the two never disagree.
  // What each method can reach, from the server: the balance read's `reach`
  // (owners with a Stripe account), else my_withdrawal_balance(), which
  // request_withdrawal() checks.
  // Money held now in the Stripe account in another currency: only then are the USD figures estimates.
  const heldElsewhere = [...(balance?.available ?? []), ...(balance?.pending ?? [])]
    .find((row) => String(row.currency ?? "").toUpperCase() !== "USD" && Number(row.amount) !== 0);
  const heldCurrency = heldElsewhere ? String(heldElsewhere.currency).toUpperCase() : null;
  // Someone who reads no Stripe balance (a member) is told the same by the
  // server's figures: converted, and money sitting in the Stripe account now.
  const estimatedLabel = Boolean(heldCurrency) || (!balance && Boolean(figures?.estimated)
    && (Number(figures?.stripe?.available_cents) || 0) + (Number(figures?.stripe?.pending_cents) || 0) + (Number(figures?.stripe?.processing_cents) || 0) > 0);
  const reach = withdrawReach(figures, freshReach ?? balance?.reach ?? null, fromBalance.available);
  // The earliest day money still clearing can be withdrawn: a card payment
  // TSC holds (the database's), or Stripe's for money in the factory's own
  // Stripe account, whichever comes first.
  const clearsOn = figures?.next_cleared_at ? new Date(figures.next_cleared_at) : null;
  const stripeClears = Math.min(...(balance?.pendingEarnings ?? []).map((row) => Number(row.available_on)).filter(Boolean));
  const arrivesOn = clearsOn && !Number.isNaN(clearsOn.getTime()) && !(Number.isFinite(stripeClears) && stripeClears * 1000 < clearsOn.getTime())
    ? clearsOn.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : availableFrom(balance);
  // "$X pending": only card payments still clearing, with the day they can be withdrawn.
  const pendingWords = (cents) => (cents > 0 ? <>{`${formatMoney(cents, "USD")} pending. ${arrivesOn ? `${availableOnWords(arrivesOn)}.` : "You can withdraw once processing finishes."}`} <PaymentHelp label="Pending balance">{PENDING_HELP}</PaymentHelp></> : null);
  // The Pending and Processing figures in their lines: money clearing ("$X
  // pending. Available to withdraw on …"), withdrawals and old payouts on
  // their way ("$Y on its way"), disputed steps ("$Z on hold"). A withdrawal
  // waiting for staff is said by its own row only.
  // A withdrawal on its way is never called available to withdraw.
  const pendingLines = pendingParts(figures, fromBalance.opens) ?? { clearing: 0, onItsWay: 0, onHold: 0, waiting: 0 };
  const cardPending = pendingLines.clearing;
  const onHoldCents = pendingLines.onHold;
  const onItsWayLine = pendingLines.onItsWay;

  // One balance, one Withdraw (D5). Every saved method withdraws from it;
  // Withdraw opens on the default, and "Withdraw to" lists every method,
  // each dialog showing what its method can reach (withdrawReach).
  const balanceChoices = manualAccounts.filter((row) => usable(row) && methodProviderOn(providers, row));
  // Saved, but its provider is switched off by staff: the Withdraw dialog
  // lists it and says it is not available, never leaves it out silently.
  const balanceOff = manualAccounts.filter((row) => usable(row) && !methodProviderOn(providers, row));
  const stripeReachable = Boolean(balance && account?.transfers_active && account.payouts_enabled && stripeWithdrawTargets.length);
  const stripeCan = stripeReachable && reach.stripe > 0;
  const balanceCan = (balanceChoices.length > 0 || balanceOff.length > 0) && reach.balance > 0;
  const openStripeWithdraw = (destination = null, latest = reach) => {
    setError(null);
    const max = latest.stripe ?? 0;
    setWithdrawal({ amount: max, max, amountText: (max / 100).toFixed(2), currency: "usd", estimated: latest.estimated, requestId: crypto.randomUUID(),
      destination: destination ?? stripeWithdrawTargets.find((m) => m.default)?.id ?? stripeWithdrawTargets[0]?.id ?? null });
    setModal("withdraw");
  };
  const openBalanceWithdraw = (methodId = null) => {
    setWithdrawalError(null);
    setWithdrawFromId(methodId);
    setModal("withdraw-balance");
  };
  // The Stripe dialog's amount, as typed, and its fee before asking (the
  // published Stripe fee, in US$; an estimate where the account is not US$).
  const amountProblem = withdrawal && !withdrawal.previous && withdrawal.amountText
    ? parseWithdrawAmount(withdrawal.amountText, withdrawal.max, (most) => formatMoney(most, withdrawal.currency)).problem : null;
  const stripeFee = withdrawal && !withdrawal.previous && withdrawal.amount > 0 && !amountProblem
    ? withdrawalFee({ provider: "stripe", amountCents: withdrawal.amount, currency: "USD", country: String(account?.country ?? "").toUpperCase() }) : null;
  // Stripe's smallest payout, checked as the amount is typed, in the server's
  // own sentence (api/_stripe-withdrawals.js), so a withdrawal that would be
  // refused is never asked for: the server would first move the money to the
  // Stripe account and then take it back. Where the account's currency has no
  // display rate, the server still decides.
  const stripeMinimumProblem = (() => {
    if (!withdrawal || withdrawal.previous || !(withdrawal.amount > 0) || amountProblem) return null;
    const local = String(balance?.defaultCurrency ?? currency ?? "USD").toUpperCase();
    const usdPer = local === "USD" ? 1 : Number(balance?.displayFx?.rates?.[local]);
    if (!(usdPer > 0)) return null;
    const leastLocal = stripeMinimumWithdrawal({ currency: local, country: String(account?.country ?? "").toUpperCase(), localPerUsd: 1 / usdPer });
    return withdrawal.amount < Math.ceil(leastLocal * usdPer) ? minimumWithdrawalSentence(leastLocal, local) : null;
  })();
  const stripeFeeLine = stripeFee && !stripeFee.refused && !stripeMinimumProblem ? withdrawFeeLine(stripeFee.feeCents, stripeFee.receivesCents, "USD") : null;
  // Opens on the default; when the default's method can reach nothing and
  // another can, on that one, so it never opens at $0.
  const openWithdraw = async () => {
    // What each method reaches now, not at the last balance read.
    setBusy(true);
    const [server] = await Promise.all([readReach(), fromBalance.load()]).catch(() => [null]);
    setBusy(false);
    const latest = server ? withdrawReach(figures, server, fromBalance.available) : reach;
    const preferBalance = payoutRoute === "manual" || !stripeReachable;
    const canStripe = stripeReachable && latest.stripe > 0;
    if (balanceCan && (preferBalance || !canStripe)) openBalanceWithdraw(manualAccount && balanceChoices.some((row) => row.id === manualAccount.id) ? manualAccount.id : null);
    else openStripeWithdraw(null, latest);
  };
  // Withdraw when the factory has a method it can withdraw to (has_method,
  // D6); a Stripe account still being finished keeps its Withdraw, off,
  // saying what is missing.
  // Until the figures answer, a usable saved method decides, so the button
  // does not change once they do.
  // A method saved just now counts at once, before the figures are read again.
  const showWithdraw = Boolean(account?.transfers_active) || Boolean(figures?.has_method) || balanceChoices.length > 0 || balanceOff.length > 0;
  const withdrawTitle = stripeCan || balanceCan ? undefined
    : paused ? "Withdrawals paused"
    : account?.transfers_active && !account.payouts_enabled && !figures?.has_method ? "Finish setup to withdraw"
    : arrivesOn && Number(figures?.pending_cents) > 0 ? availableOnWords(arrivesOn)
    : "Nothing to withdraw yet";

  return (
    <>
      {renderCard ? <section className="live-payout-method-card live-stripe-payout-card" data-testid="stripe-payout-card">
        <div className="live-payout-balance">
          <span className="payment-metric-label">{estimatedLabel ? "Available balance (estimated USD)" : "Available balance (USD)"} <PaymentHelp label="Available balance">Money you can withdraw to your bank now. This is your overall balance across all clients.</PaymentHelp></span>
          <strong data-testid="payout-balance">{figures ? formatMoney(Number(figures.available_cents) || 0, "USD")
            // A placeholder the size of the amount, so the card does not
            // jump when the figures answer.
            : onPage && !figuresFailed ? <span className="payout-balance-placeholder" role="status" aria-label="Loading balance" />
            : "—"}</strong>
          {!figures && onPage && !figuresFailed ? (
            <p className="payout-balance-line payout-balance-placeholder-lines" aria-hidden="true"><span /><span /></p>
          ) : figures ? (
            <p className="payout-balance-line" data-testid="payout-balance-line">{[
              "Earnings stay in your balance until you withdraw them.",
              // Its "?" sits right after it, not on a line of its own.
              pendingWords(cardPending ?? 0),
              // Orders are in USD; an account is credited in its own currency.
              heldCurrency ? `Part of your balance is held in ${heldCurrency}, so USD amounts are estimates.` : null,
              paused ? "Withdrawals paused" : account?.transfers_active && (!account.payouts_enabled || needsMore) ? "Finish setup to withdraw" : null,
            ].filter(Boolean).map((part, index) => <React.Fragment key={index}>{index ? " · " : ""}{part}</React.Fragment>)}</p>
          ) : null}
          {figures && onItsWayLine > 0 ? <p data-testid="payout-on-its-way">{`${formatMoney(onItsWayLine, "USD")} on its way`}</p> : null}
          {figures && onHoldCents > 0 ? <p data-testid="payout-on-hold">{`${formatMoney(onHoldCents, "USD")} on hold`}</p> : null}
          {/* Refunded after it was withdrawn: Available above already counts it, and can read below zero. */}
          {figures && owedToTscCents(figures) > 0 ? <p data-testid="payout-owed-to-tsc">{owedToTscLine(owedToTscCents(figures), formatMoney)}</p> : null}
          {payoutSetupLine ? <p data-testid="payout-how-paid">{payoutSetupLine}</p> : null}
          {withdrawalError || fromBalance.error ? <p className="live-stripe-error" role="alert">{withdrawalError ?? fromBalance.error}</p> : null}
          {balance?.recovery && [...balance.recovery.available, ...balance.recovery.pending].some(row => row.amount !== 0) ? <div role="alert">
            <p>Your previous payout account still has funds.</p>
            {recoveryAvailable > 0 && balance.recovery.payoutsEnabled ? <button className="secondary-btn compact-btn" disabled={busy} onClick={() => {
              setWithdrawal({ previous: true, amount: recoveryAvailable, currency: recoveryCurrency.toLowerCase(), requestId: crypto.randomUUID() });
              setModal("withdraw");
            }}>Withdraw previous balance</button> : <p>Contact <a href={`mailto:${OPERATIONS_EMAIL}`}>TSC operations</a>.</p>}
          </div> : null}
          {failedLine ? <p className="live-stripe-error" role="alert" data-testid="payout-failed">{failedLine}</p> : null}
          {manualSaved && !failedLine ? <p className="live-payment-notice">{cardWords.saved}</p> : null}
          {/* "Your bank is processing the payout." is said on that withdrawal's own row (companyStripeRows). */}
          {/* A new default is said in Withdrawal methods, where it was chosen, and not again here. */}
          {methodNotice && methodNotice !== shownInDialogOnly.current ? <p className="live-payment-notice" role="status" data-testid="payout-method-notice">{methodNotice}</p> : null}
          {error && modal !== "withdraw" ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
        </div>
        <div className="live-payout-card-action">
          {isOwner ? showWithdraw ? (
            <>
            <button className="primary-btn compact-btn" type="button" data-testid="withdraw-balance"
              disabled={busy || !(stripeCan || balanceCan)}
              title={figures ? withdrawTitle : undefined}
              onClick={openWithdraw}>Withdraw</button>
            <button className="secondary-btn compact-btn" type="button" data-testid={account?.transfers_active ? undefined : "add-payout-method"} disabled={busy} onClick={openManage}>{cardWords.methods}</button>
            </>
          ) : manualAccount && !savedMethod ? (
            <button className="primary-btn compact-btn" type="button" data-testid="add-payout-method" onClick={() => openManual(manualAccount)}>Add account number</button>
          ) : (
            <button className="primary-btn compact-btn" type="button" data-testid="add-payout-method" onClick={() => (manualAccount ? openManage() : openManual(null))}>{manualAccount ? cardWords.methods : cardWords.add}</button>
          )
          : <>
            {showWithdraw ? <button className="primary-btn compact-btn" type="button" data-testid="withdraw-balance" disabled title="Only a company owner can withdraw">Withdraw</button> : null}
            <button className={`${showWithdraw ? "secondary-btn" : "primary-btn"} compact-btn`} type="button" disabled title="Only an owner can set up or change payouts">{account?.transfers_active || manualAccount ? cardWords.methods : cardWords.add}</button>
          </>}
        </div>
        <div className="payout-withdrawal-status-row"><WithdrawalStatus open={fromBalance.open} opens={fromBalance.opens} last={fromBalance.last} isOwner={isOwner}
          refunded={new Map(((figures?.tsc ?? figures)?.withdrawals ?? figures?.withdrawals ?? []).map((w) => [w.id, (w.parts ?? []).filter((part) => part.word === "refunded").reduce((sum, part) => sum + (Number(part.amount_cents) || 0), 0)]))}
          words={new Map(((figures?.tsc ?? figures)?.withdrawals ?? figures?.withdrawals ?? []).filter((w) => w.word === "on_hold" || Number(w.held_cents) > 0 || (w.parts ?? []).some((part) => part.word === "on_hold")).map((w) => [w.id, "on_hold"]))} onCancel={(row) => {
              setWithdrawalError(null);
              // Cancelling is asked first, like any step that can't be undone:
              // the dialog that chooses among several, with this one ticked.
              setCancelFirst(row.id);
              setModal("cancel-withdrawals");
            }} /></div>
      </section> : null}

      {modal === "cancel-withdrawals" ? (
        <CancelWithdrawalsForm opens={fromBalance.opens} first={cancelFirst} returnable={fromBalance.returnable} Modal={PayoutModal} onClose={closeModal}
          onDone={() => { closeModal(); fromBalance.load(); readReach(); }} onChanged={() => { fromBalance.load(); readReach(); }} />
      ) : null}

      {modal === "withdraw-balance" && reach.balance != null ? (
        <WithdrawForm orgId={org.id} available={reach.balance} methods={manualAccounts} defaultId={withdrawFromId ?? manualAccount?.id} country={country} providers={providers}
          others={stripeReachable ? stripeWithdrawTargets.map((method) => ({ id: method.id, label: listLabelIn(method, uiLanguage) })) : []}
          onOther={(id) => openStripeWithdraw(id)}
          onRefused={() => { fromBalance.load(); readReach(); onMethodsChanged?.(); }}
          Modal={PayoutModal} onClose={closeModal} onDone={() => { closeModal(); fromBalance.load(); readReach(); }} />
      ) : null}

      {modal === "withdraw" && withdrawal ? (
        <PayoutModal title="Withdraw" className="withdraw-form-modal" onClose={closeModal} actions={<>
          <button className="secondary-btn" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
          <button className="primary-btn" type="button" data-testid="stripe-withdraw-confirm" disabled={busy || !(withdrawal.amount > 0) || Boolean(stripeMinimumProblem)} onClick={withdraw}>{busy ? "Withdrawing…" : withdrawal.amount > 0 ? `Withdraw ${formatMoney(withdrawal.amount, withdrawal.currency)}` : "Withdraw"}</button>
        </>}>
          {withdrawal.previous ? (
            <p>Send {formatMoney(withdrawal.amount, withdrawal.currency)} to your previous account’s bank account. Bank processing time depends on your bank and country.</p>
          ) : (
            <div className="withdraw-form-fields">
              {stripeWithdrawTargets.length ? (
                <label className="payout-country-field withdraw-method-field">
                  <span>Withdraw to</span>
                  <select name="Withdraw to" value={withdrawal.destination ?? ""} disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      // A saved method is withdrawn from TSC's balance, in its own dialog.
                      if (value.startsWith("balance:")) openBalanceWithdraw(value.slice(8));
                      else setWithdrawal((was) => ({ ...was, destination: value }));
                    }}>
                    {stripeWithdrawTargets.map((method) => <option key={method.id} value={method.id}>{listLabelIn(method, uiLanguage)}</option>)}
                    {reach.balance != null ? balanceChoices.map((row) => <option key={row.id} value={`balance:${row.id}`}>{withdrawOptionLabel(row, uiLanguage)}</option>) : null}
                    {reach.balance != null ? balanceOff.map((row) => <option key={row.id} value={`balance:${row.id}`} disabled>{withdrawOptionLabel(row, uiLanguage)}</option>) : null}
                  </select>
                </label>
              ) : null}
              <div className="withdraw-amount-field payout-form-grid">
                <div className="withdraw-amount-heading">
                  <label htmlFor="stripe-withdraw-amount">{withdrawal.estimated ? "Amount (estimated USD)" : `Amount (${withdrawal.currency.toUpperCase()})`}</label>
                  <button className="secondary-btn" type="button" disabled={busy}
                    onClick={() => setWithdrawal((was) => ({ ...was, amount: was.max, amountText: (was.max / 100).toFixed(2) }))}>Withdraw full amount</button>
                </div>
                <input id="stripe-withdraw-amount" name="Amount" inputMode="decimal" value={withdrawal.amountText} disabled={busy} aria-describedby="stripe-withdraw-available"
                  onChange={(event) => {
                    // Read as typed, never changed under the person: more than available is said.
                    const text = event.target.value;
                    const { cents, problem } = parseWithdrawAmount(text, withdrawal.max, (most) => formatMoney(most, withdrawal.currency));
                    setWithdrawal((was) => ({ ...was, amountText: text, amount: problem ? 0 : cents }));
                  }} />
                <p id="stripe-withdraw-available" className="withdraw-available">{`Available: ${formatMoney(withdrawal.max, withdrawal.currency)}`}</p>
                {stripeFeeLine ? <p className="withdraw-available" data-testid="withdraw-fee">{stripeFeeLine}</p> : null}
              </div>
            </div>
          )}
          {/* One message: the server's refusal, when there is one, is the truth. */}
          {!error && !withdrawal.previous && withdrawal.amountText && amountProblem ? <p className="live-stripe-error" role="alert">{amountProblem}</p> : null}
          {!error && stripeMinimumProblem ? <p className="live-stripe-error" role="alert" data-testid="stripe-withdraw-minimum">{stripeMinimumProblem}</p> : null}
          {error ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
        </PayoutModal>
      ) : null}

      {modal === "manage" ? (
        <PayoutModal
          title={cardWords.methods}
          className="payout-methods-modal"
          onClose={closeModal}
          actions={<button className="secondary-btn" type="button" onClick={closeModal}>{cardWords.done}</button>}
        >
          {/* Messages first, in TSC's box, where they are seen at once. */}
          {removeError ? <ModalMessage>{removeError.message}</ModalMessage> : null}
          {manualError ? <ModalMessage>{manualError.message}</ModalMessage> : null}
          {/* A failure after a success replaces it: never both at once. */}
          {methodNotice && !removeError && !manualError ? <ModalMessage tone="notice">{methodNotice}</ModalMessage> : null}
          <div className="payout-methods-heading">
            {/* Add always adds: a new method sits beside the others. */}
            <button className="secondary-btn compact-btn" type="button" disabled={busy || manualBusy} onClick={() => (account ? setModal("add") : openManual(null))}>+ {cardWords.add}</button>
          </div>
          <div className="payout-method-list">
            {/* A setup left halfway is not listed: it starts again under Add. */}
            {account && !account.transfers_active && verifying ? (
              <article className="payout-method-row" data-testid="payout-unfinished-bank">
                <div className="payout-bank-icon" aria-hidden="true">{BANK_ICON}</div>
                <div className="payout-method-name"><strong>Bank account (Stripe)</strong><span>Verification in progress</span></div>
              </article>
            ) : null}
            {/* The default first, the rest in their usual order. */}
            {defaultFirst([
            ...(account ? providerMethodRows.map((method) => ({ isDefault: Boolean(method.default && payoutRoute === "stripe"), node: (
              <article className="payout-method-row" key={method.id}>
                <div className="payout-bank-icon" aria-hidden="true">
                  {BANK_ICON}
                </div>
                <div className="payout-method-name">
                  <strong>{listLabel(method)}</strong>
                  {method.name && !/stripe/i.test(method.name) ? <span>{method.name}</span> : null}
                </div>
                {method.default && payoutRoute === "stripe" ? <span className="payout-method-default">Default</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${methodLabel(method)}`} aria-expanded={methodMenu === method.id} disabled={busy || methodBusy} onClick={() => setMethodMenu((open) => open === method.id ? null : method.id)}>...</button>
                  {methodMenu === method.id ? (
                    <div className="payout-method-popover" role="menu">
                      {(method.default ? payoutRoute !== "stripe" : managed) && method.standard !== false ? <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); makeStripeDefault(method); }}>Make default</button> : null}
                      <button className="danger" type="button" role="menuitem" disabled={method.id === "connected-account"} onClick={() => { setMethodMenu(null); setRemoving(method); setPromoteId(null); setRemoveError(null); setModal("remove-stripe"); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            ) })) : []),
            ...manualAccounts.map((row) => ({ isDefault: Boolean(row.is_primary && payoutRoute === "manual"), node: (
              <article className="payout-method-row" key={row.id}>
                <div className="payout-bank-icon" aria-hidden="true">
                  {isPaypal(row) ? <img src="/assets/paypal-mark.jpg" alt="" width="32" height="20" /> : LETTER_MARK[row.method] ?? BANK_ICON}
                </div>
                <div className="payout-method-name">{isPaypal(row)
                  ? <><strong>PayPal</strong><span>{row.paypal_email}</span></>
                  : <><strong>{manualListLabel(row)}</strong><span>{row.number_changed_at ? row.bank_name : "Add your full account number."}</span></>}</div>
                {row.is_primary && payoutRoute === "manual" ? <span className="payout-method-default">Default</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${manualLabel(row)}`} aria-expanded={methodMenu === row.id} disabled={manualBusy} onClick={() => setMethodMenu((open) => open === row.id ? null : row.id)}>...</button>
                  {methodMenu === row.id ? (
                    <div className="payout-method-popover" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); openManual(row); }}>{cardWords.edit}</button>
                      {!row.is_primary || payoutRoute !== "manual" ? <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); makePrimary(row); }}>{cardWords.makeDefault}</button> : null}
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMethodMenu(null); setRemovingManual(row); setPromoteId(null); setRemoveError(null); setModal("remove"); onMethodsChanged?.(); }}>{cardWords.remove}</button>
                    </div>
                  ) : null}
                </div>
              </article>
            ) })),
            ])}
            {!manualAccounts.length && (!account || (!account.transfers_active && !verifying)) ? <div className="payout-empty-guidance">No withdrawal method yet.</div> : null}
          </div>
          {/* Only one already started, which must finish: nobody starts one here. */}
          {account && balance?.upgrade && !managed ? (
            <div className="payout-info-callout"><p>
              Confirm your payout details.
              {" "}<button className="secondary-btn compact-btn" type="button" onClick={() => setModal("upgrade")}>Continue</button>
            </p></div>
          ) : null}
        </PayoutModal>
      ) : null}

      {modal === "add-bank" ? (
        <AddPayoutMethodForm
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
            ? <button className="secondary-btn" type="button" onClick={backToList}>Back</button>
            : <><button className="secondary-btn" type="button" onClick={backToList}>Cancel</button><button className="primary-btn payout-remove-confirm" type="button" disabled={manualBusy} onClick={removeManualMethod}>{manualBusy ? "Removing…" : "Remove method"}</button></>}
        >
          {/* Once the refusal is known it is the dialog's one line. */}
          {removeError && !manualRemovalRefusal ? <ModalMessage>{removeError.message}</ModalMessage> : null}
          {manualRemovalLine ? <p className="payout-modal-intro" data-testid="payout-remove-reason">{manualRemovalLine}</p> : null}
          {!manualRemovalRefusal && otherManual.length > 1 && removingManual.is_primary ? (
            <label className="payout-country-field">
              <span>New default</span>
              <select value={manualSuccessor?.id ?? ""} onChange={(event) => setPromoteId(event.target.value)}>
                {otherManual.map((row) => <option key={row.id} value={row.id}>{manualLabel(row)}{row.bank_name ? ` · ${row.bank_name}` : ""}</option>)}
              </select>
            </label>
          ) : null}
        </PayoutModal>
      ) : null}

      {modal === "remove-stripe" && removing ? (
        <PayoutModal
          title={!balance ? "Remove withdrawal method" : removalRefusal ? `${removingMethod ? methodLabel(removingMethod) : "This account"} can’t be removed` : `Remove ${methodLabel(removingMethod)}?`}
          onClose={closeModal}
          actions={!balance || (removalRefusal && !(managed && removingMethod))
            ? <button className="secondary-btn" type="button" onClick={backToList}>Back</button>
            : removalRefusal
              // Managed, and the last of its currency: put another in its place.
              ? <><button className="secondary-btn" type="button" onClick={backToList}>Back</button><button className="primary-btn" type="button" data-testid="replace-payout-method" onClick={() => { setReplacing(removingMethod); setModal("add-bank"); }}>Replace with another bank account</button></>
              : <><button className="secondary-btn" type="button" disabled={methodBusy} onClick={backToList}>Cancel</button>
                <button className="primary-btn payout-remove-confirm" type="button" data-testid="confirm-remove-payout" disabled={busy || methodBusy}
                        onClick={() => (managed ? confirmStripeRemoval() : handOver("remove", removingMethod))}>
                  {managed ? (methodBusy ? "Removing…" : "Remove method") : "Continue"}
                </button></>}
        >
          {removeError ? <ModalMessage>{removeError.message}</ModalMessage> : null}
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
        </PayoutModal>
      ) : null}

      {modal === "setup" || modal === "add" ? (() => {
        const words = LIST_WORDS;
        return (
          <PayoutModal title={words.title} onClose={closeModal} className="payout-options-modal"
            actions={<button className="secondary-btn" type="button" onClick={() => (renderCard && (account || manualAccounts.length) ? setModal("manage") : closeModal())}>{words.back}</button>}>
            {removeError && (modal === "add" || modal === "setup") ? <ModalMessage>{removeError.message}</ModalMessage> : null}
            <p className="payout-modal-intro">Earnings stay in your balance until you withdraw them.</p>
            <PayoutOptions country={country} onCountryChange={setCountry} supported={supported} notListed={notListed} busy={busy} providers={providers} onBank={() => { if (supported) { chooseStripeBank(); return; } setManualError(null); onStartManual?.(null); setModal("setup-wise"); }} onWise={() => { setManualError(null); onStartManual?.(null); setModal("setup-wise"); }} onPaypal={() => { setManualError(null); onStartManual?.(null); setModal("setup-paypal"); }} />
          </PayoutModal>
        );
      })() : null}

      {modal === "setup-wise" ? (
        <WiseBankStep row={stepRow} country={stepRow?.bank_country ?? country} busy={manualBusy} saveWise={(details) => onSaveWise?.({ ...details, payoutCountry: stepRow ? null : savedCountry(country) })} onBack={backFromStep} onClose={closeModal} onUnavailable={() => setModal("bank-unavailable")} />
      ) : null}

      {modal === "bank-unavailable" ? (
        // Wise's form could not be had: TSC no longer pays by hand, so PayPal is
        // offered, only while staff have it on for the picked country.
        providerOnFor(providers, "paypal", savedCountry(country)) ? (
        <PayoutModal title={LIST_WORDS.title} onClose={closeModal} actions={<>
          <button className="secondary-btn" type="button" onClick={backFromStep}>{LIST_WORDS.back}</button>
          <button className="primary-btn" type="button" data-testid="bank-unavailable-paypal" disabled={busy}
                  onClick={() => { setManualError(null); onStartManual?.(null); setModal("setup-paypal"); }}>{LIST_WORDS.setUpPaypal}</button>
        </>}>
          <p className="payout-modal-intro" data-testid="bank-unavailable">{LIST_WORDS.bankUnavailable}</p>
        </PayoutModal>
        ) : (
        <PayoutModal title={LIST_WORDS.title} onClose={closeModal} actions={
          <button className="secondary-btn" type="button" onClick={backFromStep}>{LIST_WORDS.back}</button>
        }>
          <p className="payout-modal-intro" data-testid="payout-none-available">{LIST_WORDS.noneAvailable}</p>
        </PayoutModal>
        )
      ) : null}

      {modal === "setup-paypal" && manualForm ? (
        <PaypalStep row={stepRow} country={stepRow?.bank_country ?? country} form={manualForm} busy={manualBusy} onField={onManualFieldChange} savePaypal={() => onSavePaypal?.(stepRow ? null : savedCountry(country))} onBack={backFromStep} onClose={closeModal} />
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
        <PayoutModal title="Confirm your payout details" onClose={closeModal}
          actions={<><button className="secondary-btn" type="button" disabled={busy} onClick={closeModal}>Not now</button>
            <button className="primary-btn" type="button" disabled={busy} onClick={startUpgrade}>{busy ? "Starting…" : "Continue verification"}</button>
            <button className="secondary-btn" type="button" disabled={busy} onClick={finishUpgrade}>Check and finish</button></>}>
          {removeError ? <ModalMessage>{removeError.message}</ModalMessage> : null}
          {balance?.upgrade ? <ModalMessage tone="notice">{balance.upgrade.verified ? "Replacement account verified." : "Complete verification for the replacement account."} {balance.upgrade.unsettled ? "Your old account still has funds or a withdrawal settling. Withdraw what's available, then check again." : "The old account is settled."}</ModalMessage> : null}
          <p className="payout-modal-intro">After a one-time verification, add, replace and remove bank accounts directly on TSC. Confirm your business and bank details again and accept the payment partner’s agreement.</p>
          <p className="payout-security-copy">Your existing balance stays in your current account. New earnings are held by TSC until verification finishes. Withdraw any remaining balance and wait for it to arrive. Your payout history is kept.</p>
        </PayoutModal>
      ) : null}
      {modal === "upgrade-onboarding" ? (
        <PayoutModal wide title="Verify your replacement payout account" onClose={closeStripeForm}
          actions={<button className="secondary-btn" type="button" onClick={closeStripeForm}>Close</button>}>
          <p className="payout-security-copy">Your current account and balance stay available until this account is verified and the old account has settled. Your bank details go directly to our payment partner.</p>
          <StripeConnectEmbed org={org} upgrade form="onboarding" onExit={closeStripeForm} />
        </PayoutModal>
      ) : null}

      {modal === "onboarding" || modal === "onboarding-chosen" ? (
        <PayoutModal
          wide
          title="Bank account"
          onClose={closeStripeForm}
          actions={modal === "onboarding-chosen"
            ? <button className="secondary-btn" type="button" onClick={() => backFromStripeForm("setup")}>Back</button>
            : <button className="secondary-btn" type="button" onClick={closeStripeForm}>Close</button>}
        >
          <p className="payout-security-copy">Our payment partner securely verifies your company and bank details in this form. TSC never stores these bank details. The form may show TSC’s registered company name.</p>
          <StripeConnectEmbed org={org} country={supported ? country : undefined} form="onboarding" onExit={closeStripeForm} />
        </PayoutModal>
      ) : null}

      {modal === "account" ? (
        <PayoutModal
          wide
          title="Payout account"
          onClose={closeStripeForm}
          actions={<>
            {handover?.intent === "add" ? <button className="secondary-btn" type="button" onClick={() => { setHandover(null); backFromStripeForm("add"); }}>Back</button> : null}
            <button className="secondary-btn" type="button" onClick={closeStripeForm}>Done</button>
          </>}
        >
          {handover ? <p className="payout-modal-intro">{handover.intent === "add"
            ? "Under “Payout details”, add the bank account or card, then choose Done."
            : `Under “Payout details”, remove the account ending in ${handover.target?.last4}, then choose Done.`}</p> : null}
          <p className="payout-security-copy">Your company and bank details stay with our payment partner. You may be asked to confirm with a code in a small window.</p>
          <StripeConnectEmbed org={org} form="account" />
        </PayoutModal>
      ) : null}

    </>
  );
}
