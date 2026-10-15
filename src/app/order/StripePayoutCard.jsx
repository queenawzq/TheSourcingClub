import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { connectAccountFor, connectAction } from "../../lib/domain/stripe.js";
import { PAYOUT_COUNTRIES } from "../../shared/stripe-payout-countries.mjs";

const OTHER_COUNTRIES = ["CN", "HK", "TW", "VN", "IN", "BD", "PK", "TR", "ID", "TH", "KH", "LK", "KR", "JP", "MX", "BR", "MA", "EG"];
const names = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = [...new Set([...PAYOUT_COUNTRIES, ...OTHER_COUNTRIES])]
  .map((code) => ({ code, name: names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

const countryName = (code) => (code ? names.of(code) ?? code : "");
const usdAmount = (rows) => rows?.find((row) => row.currency?.toUpperCase() === "USD")?.amount ?? 0;

export function PayoutModal({ children, title, eyebrow, onClose, actions }) {
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
    <div className="brand-profile-modal-layer payout-modal-layer">
      <button className="brand-profile-modal-scrim" type="button" aria-label="Close" onClick={onClose} />
      <section className="brand-profile-modal payout-modal" role="dialog" aria-modal="true" aria-labelledby="payout-modal-title">
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
  manualForm,
  manualFields,
  onManualFieldChange,
  onSaveManual,
  onDeleteManual,
  manualBusy,
  manualSaved,
  renderCard = true,
  initialAction = null,
  onFlowClose,
}) {
  const [account, setAccount] = useState(undefined);
  const [balance, setBalance] = useState(null);
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [methodMenu, setMethodMenu] = useState(null);
  const handledInitialAction = useRef(false);

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

  const load = useCallback(async () => {
    const [saved, { data: profile }] = await Promise.all([
      connectAccountFor(org.id),
      supabase.from("factory_profiles").select("country_code").eq("org_id", org.id).maybeSingle(),
    ]);
    setAccount(saved);
    setCountry((current) => current || saved?.country || profile?.country_code || "");
    if (saved?.transfers_active && isOwner) {
      const nextBalance = await connectAction(org.id, "balance").catch(() => null);
      setBalance(nextBalance);
      onBalanceChange?.(nextBalance);
    } else {
      setBalance(null);
      onBalanceChange?.(null);
    }
  }, [org.id, isOwner, onBalanceChange]);

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
      if (back && isOwner) {
        clean();
        if (back === "refresh") {
          const { url } = await connectAction(org.id, "onboard");
          window.location.assign(url);
          return;
        }
        await connectAction(org.id, "refresh");
      }
      await load();
      if (payoutAction && isOwner) {
        clean();
        const saved = await connectAccountFor(org.id);
        if (saved?.transfers_active) {
          const { url } = await connectAction(org.id, "dashboard");
          window.location.assign(url);
        } else {
          setModal(payoutAction === "remove" && manualAccount ? "remove" : "setup");
        }
      }
    })().catch((failure) => {
      setError(failure);
      setAccount((current) => (current === undefined ? null : current));
    });
  }, [org.id, isOwner, load, manualAccount]);

  const supported = PAYOUT_COUNTRIES.has(country);
  const available = usdAmount(balance?.available);
  const pending = usdAmount(balance?.pending);
  const connectedMethods = balance?.methods ?? [];
  async function go(action, extra) {
    setBusy(true);
    setError(null);
    try {
      const result = await connectAction(org.id, action, extra);
      if (result.url) {
        if (action === "dashboard") {
          setModal(null);
          window.open(result.url, "_blank", "noopener");
          onFlowClose?.();
        } else {
          window.location.assign(result.url);
        }
      }
      if (result.account) setAccount(result.account);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (account === undefined || !initialAction || handledInitialAction.current) return;
    handledInitialAction.current = true;
    if (initialAction === "manage") {
      setModal(account?.transfers_active || manualAccount ? "manage" : "setup");
    } else if (initialAction === "add") {
      setModal(account?.transfers_active ? "add" : "setup");
    } else if (account?.transfers_active) {
      go("dashboard");
    } else {
      setModal(initialAction === "remove" && manualAccount ? "remove" : "setup");
    }
  }, [account, initialAction, manualAccount]);

  if (account === undefined) return null;

  const closeModal = () => {
    if (!busy && !manualBusy) {
      setMethodMenu(null);
      setModal(null);
      onFlowClose?.();
    }
  };

  const setupActions = (
    <>
      <button className="secondary-btn" type="button" onClick={closeModal}>Cancel</button>
      {supported ? (
        <button className="primary-btn" type="button" disabled={busy || !country} onClick={() => go("onboard", { country })}>
          {busy ? "Opening Stripe…" : "Continue to Stripe"}
        </button>
      ) : (
        <button className="primary-btn" type="button" disabled={manualBusy || !country} onClick={onSaveManual}>
          {manualBusy ? "Saving…" : "Save payout method"}
        </button>
      )}
    </>
  );

  const manualFieldsContent = (
    <div className="payout-manual-fields">
      <div className="payout-form-grid">
        {manualFields.map(([key, label, placeholder]) => (
          <label key={key}>
            <span>{label}</span>
            <input value={manualForm[key]} placeholder={placeholder} onChange={onManualFieldChange(key)} />
          </label>
        ))}
      </div>
      <label className="payout-textarea-field">
        <span>Additional transfer instructions</span>
        <textarea rows={3} value={manualForm.instructions} onChange={onManualFieldChange("instructions")} placeholder="Intermediary bank or transfer instructions" />
      </label>
      <p className="payout-security-copy">For security, only add the last four account digits here. TSC staff will confirm full transfer details with you securely.</p>
    </div>
  );

  const providerMethodRows = connectedMethods.length ? connectedMethods : account?.transfers_active ? [{
    id: "connected-account",
    type: "bank_account",
    name: "Connected bank account",
    last4: "",
    currency: "usd",
    default: true,
  }] : [];

  const openSecureManagement = () => go("dashboard");

  async function removeManualMethod() {
    try {
      await onDeleteManual?.();
      setModal(null);
    } catch {
      // The parent displays the Supabase error under the balance.
    }
  }

  return (
    <>
      {renderCard ? <section className="live-payout-method-card live-stripe-payout-card" data-testid="stripe-payout-card">
        <div className="live-payout-balance">
          <span>Available balance</span>
          <strong>{balance ? formatMoney(available, "USD") : "—"}</strong>
          <p>{balance
            ? `${formatMoney(pending, "USD")} pending`
            : account?.details_submitted
              ? "Payout verification in progress"
              : account
                ? "Finish setup to receive earnings"
                : "Add a payout method to receive earnings"}</p>
          {manualSaved ? <p className="live-payment-notice">Payout method saved.</p> : null}
          {error ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
        </div>
        <div className="live-payout-card-action">
          {isOwner ? account?.transfers_active ? (
            <>
              <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={() => setModal("manage")}>Manage payout method</button>
              <button className="primary-btn compact-btn" type="button" disabled={available <= 0} onClick={() => setModal("withdraw")}>Withdraw funds</button>
            </>
          ) : account ? (
            <button className="primary-btn compact-btn" type="button" disabled={busy} onClick={() => go("onboard")}>
              {busy ? "Opening Stripe…" : "Finish setup"}
            </button>
          ) : (
            <button className="primary-btn compact-btn" type="button" onClick={() => setModal(manualAccount ? "manage" : "setup")}>{manualAccount ? "Manage payout method" : "Add payout method"}</button>
          )
          : null}
        </div>
      </section> : null}

      {modal === "manage" ? (
        <PayoutModal
          title="Payout methods"
          eyebrow="Payments"
          onClose={closeModal}
          actions={<button className="secondary-btn" type="button" onClick={closeModal}>Done</button>}
        >
          <div className="payout-methods-heading">
            <p className="payout-modal-intro">Choose where released earnings are sent.</p>
            <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={() => setModal(account ? "add" : "setup")}>+ Add payout method</button>
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
                {method.default ? <span className="payout-method-default">Default</span> : null}
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label={`More actions for ${method.type === "card" ? "payout card" : "bank account"}`} aria-expanded={methodMenu === method.id} disabled={busy} onClick={() => setMethodMenu((open) => open === method.id ? null : method.id)}>...</button>
                  {methodMenu === method.id ? (
                    <div className="payout-method-popover" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); openSecureManagement(); }}>Edit method</button>
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMethodMenu(null); openSecureManagement(); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            )) : manualAccount ? (
              <article className="payout-method-row">
                <div className="payout-bank-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M3 9h18M5 9v8m4-8v8m6-8v8m4-8v8M3 18h18M12 3l9 4H3l9-4Z" /></svg>
                </div>
                <div className="payout-method-name"><strong>Bank account{manualAccount.account_number_last4 ? ` ending in ${manualAccount.account_number_last4}` : ""}</strong><span>{manualAccount.bank_name || "Manual bank transfer"}</span></div>
                <span className="payout-method-default">Default</span>
                <div className="payout-method-menu">
                  <button className="rfq-more payout-more-button" type="button" aria-label="More actions for bank account" aria-expanded={methodMenu === "manual"} onClick={() => setMethodMenu((open) => open === "manual" ? null : "manual")}>...</button>
                  {methodMenu === "manual" ? (
                    <div className="payout-method-popover" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMethodMenu(null); setModal("setup"); }}>Edit method</button>
                      <button className="danger" type="button" role="menuitem" onClick={() => { setMethodMenu(null); setModal("remove"); }}>Remove method</button>
                    </div>
                  ) : null}
                </div>
              </article>
            ) : <div className="payout-empty-guidance">No payout method added yet.</div>}
          </div>
          {account ? <p className="payout-security-copy">For security, adding, editing, or removing bank details continues in your secure payout account.</p> : null}
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
              <button className="primary-btn compact-btn" type="button" disabled={busy} onClick={openSecureManagement}>{busy ? "Opening…" : "Set up"}</button>
            </article>
            <article className="payout-method-option">
              <div className="payout-option-icon payout-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
              </div>
              <div className="payout-option-copy">
                <div className="payout-option-title"><strong>Instant payout card</strong></div>
                <p>Receive eligible payouts on a supported debit card. Stripe confirms availability, timing, and fees.</p>
              </div>
              <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={openSecureManagement}>{busy ? "Opening…" : "Set up"}</button>
            </article>
          </div>
          <p className="payout-security-copy">You’ll continue to Stripe to enter the selected payout details securely.</p>
        </PayoutModal>
      ) : null}

      {modal === "remove" ? (
        <PayoutModal
          title="Remove payout method?"
          eyebrow="Payments"
          onClose={closeModal}
          actions={<><button className="secondary-btn" type="button" onClick={() => setModal("manage")}>Cancel</button><button className="primary-btn payout-remove-confirm" type="button" disabled={manualBusy} onClick={removeManualMethod}>{manualBusy ? "Removing…" : "Remove method"}</button></>}
        >
          <p className="payout-modal-intro">You won’t be able to withdraw released earnings until another payout method is added.</p>
        </PayoutModal>
      ) : null}

      {modal === "setup" ? (
        <PayoutModal title="Set up payout method" eyebrow="Payments" onClose={closeModal} actions={setupActions}>
          <p className="payout-modal-intro">Choose where your company is registered. We’ll show the payout method available for that country.</p>
          <label className="payout-country-field">
            <span>Company country</span>
            <select value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="">Choose a country</option>
              {COUNTRIES.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
            </select>
          </label>
          {country ? supported ? (
            <div className="payout-method-preview">
              <div className="payout-method-icon" aria-hidden="true">S</div>
              <div><strong>Stripe payout account</strong><p>Stripe securely verifies your company and bank details on its own pages. TSC never stores those details.</p></div>
            </div>
          ) : (
            <>
              <div className="payout-info-callout"><span aria-hidden="true">i</span><p>Stripe payouts are not available in {countryName(country)}. Add a bank account for manual payouts from TSC staff.</p></div>
              {manualFieldsContent}
            </>
          ) : <div className="payout-empty-guidance">Select a country to see the available payout method.</div>}
        </PayoutModal>
      ) : null}

      {modal === "withdraw" ? (
        <PayoutModal
          title="Withdraw funds"
          eyebrow="Payments"
          onClose={closeModal}
          actions={<><button className="secondary-btn" type="button" onClick={closeModal}>Cancel</button><button className="primary-btn" type="button" disabled={busy || available <= 0} onClick={() => go("dashboard")}>{busy ? "Opening Stripe…" : "Continue to Stripe"}</button></>}
        >
          <div className="payout-balance-block"><span>Available balance</span><strong>{formatMoney(available, "USD")}</strong>{pending > 0 ? <p>{formatMoney(pending, "USD")} pending release from Stripe</p> : null}</div>
          <div className="payout-method-preview"><div className="payout-method-icon" aria-hidden="true">S</div><div><span>Payout method</span><strong>Stripe payout account · {countryName(account.country)}</strong></div></div>
          <div className="payout-info-callout"><span aria-hidden="true">i</span><p>Stripe will show the destination bank, arrival estimate, and any applicable fees before you confirm.</p></div>
          <fieldset className="payout-amount-choice"><legend>Amount</legend><label><input type="radio" checked readOnly /><span><strong>Full available balance</strong><small>{formatMoney(available, "USD")}</small></span></label></fieldset>
        </PayoutModal>
      ) : null}
    </>
  );
}
