import React, { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, useStripe } from "@stripe/react-stripe-js";
import { STRIPE_PUBLISHABLE_KEY, connectAction } from "../../lib/domain/stripe.js";
import { PayoutModal } from "./StripePayoutCard.jsx";

/**
 * TSC's own forms for adding a payout account to a Stripe account TSC
 * manages (api/_stripe-payouts.js managedByTsc). Stripe.js turns the details
 * into a single-use token in the browser, so the numbers go to Stripe and
 * never to TSC's server. No design draws these; they sit in the payout
 * dialogs beside the method list.
 */

let stripePromise = null;
const payoutStripe = () => {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  stripePromise ??= loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
};

/**
 * The fields a bank in each country is known by. Stripe's routing_number is
 * the US routing number, the UK sort code, or Canada's transit and
 * institution numbers; everywhere else the IBAN is the whole account.
 */
function bankFieldsFor(country, currency) {
  if (country === "US") {
    return [
      ["routing", "Routing number", "110000000", /^\d{9}$/],
      ["account", "Account number", "000123456789", /^\d{4,17}$/],
    ];
  }
  if (country === "GB" && currency.toUpperCase() === "GBP") {
    return [
      ["routing", "Sort code", "10-88-00", /^\d{6}$/],
      ["account", "Account number", "00012345", /^\d{8}$/],
    ];
  }
  if (country === "CA") {
    return [
      ["transit", "Transit number", "11000", /^\d{5}$/],
      ["institution", "Institution number", "000", /^\d{3}$/],
      ["account", "Account number", "000123456789", /^\d{7,12}$/],
    ];
  }
  return [["account", "IBAN", `${country}00 0000 0000 0000 0000`, /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/]];
}

const clean = (value) => String(value ?? "").replace(/[\s-]/g, "").toUpperCase();

function tokenDetails(country, currency, values, holder) {
  const routing = country === "CA" ? `${clean(values.transit)}-${clean(values.institution)}`
    : values.routing ? clean(values.routing) : undefined;
  return {
    country,
    currency: currency.toLowerCase(),
    account_number: clean(values.account),
    ...(routing ? { routing_number: routing } : {}),
    account_holder_name: holder.trim(),
    account_holder_type: "company",
  };
}

function BankForm({ org, country: initialCountry, currency: initialCurrency, isFirst, replaceId, onAdded, onClose }) {
  const stripe = useStripe();
  const [country, setCountry] = useState(initialCountry);
  const [currency, setCurrency] = useState(initialCurrency.toUpperCase());
  const [options, setOptions] = useState(null);
  const [optionsError, setOptionsError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setOptionsError(null);
    connectAction(org.id, "bank_options").then((result) => {
      if (!cancelled) setOptions(result);
    }).catch((error) => { if (!cancelled) setOptionsError(error.message); });
    return () => { cancelled = true; };
  }, [org.id, attempt]);
  // Stripe cannot delete the last account for a currency. A replacement
  // must retain that currency; Add allows every supported combination.
  const offeredCurrencies = Object.fromEntries(Object.entries(options?.currencies ?? {})
    .filter(([code]) => !replaceId || code.toUpperCase() === initialCurrency.toUpperCase()));
  const countries = [...new Set(Object.values(offeredCurrencies).flat())]
    .map((code) => ({ code, name: new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const currencies = Object.entries(offeredCurrencies).filter(([, countries]) => countries.includes(country)).map(([code]) => code.toUpperCase());
  const fields = bankFieldsFor(country, currency);
  const supported = Boolean(options?.currencies[currency.toLowerCase()]?.includes(country));
  function selectCountry(nextCountry) {
    setCountry(nextCountry);
    const possible = Object.entries(offeredCurrencies).filter(([, countries]) => countries.includes(nextCountry)).map(([code]) => code.toUpperCase());
    if (!possible.includes(currency)) setCurrency(possible[0] || "");
    setValues({});
    setProblem(null);
  }
  const [values, setValues] = useState({});
  const [holder, setHolder] = useState(org.name ?? "");
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const ready = supported && holder.trim() && fields.every(([key, , , pattern]) => pattern.test(clean(values[key])));

  async function save() {
    if (!stripe || !ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { token, error } = await stripe.createToken("bank_account", tokenDetails(country, currency, values, holder));
      if (error) throw new Error(error.message);
      onAdded(await connectAction(org.id, "add_method", { token: token.id, makeDefault: isFirst || makeDefault, replaceId }));
    } catch (failure) {
      setProblem(failure.message || "The bank account could not be added.");
      setBusy(false);
    }
  }

  return (
    <PayoutModal
      title="Add a bank account"
      keepOpen
      onClose={busy ? () => {} : onClose}
      actions={<>
        <button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Back</button>
        <button className="primary-btn" type="button" data-testid="save-bank-account" disabled={!stripe || !ready || busy} onClick={save}>{busy ? "Adding…" : "Add bank account"}</button>
      </>}
    >
      <div className="payout-manual-fields">
        <label className="payout-country-field">
          <span>Bank account country</span>
          <select aria-label="Bank account country" value={country} disabled={!options || busy} onChange={(event) => selectCountry(event.target.value)}>
            {!options ? <option value={country}>{new Intl.DisplayNames(["en"], { type: "region" }).of(country) || country}</option> : null}
            {countries.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        {currencies.length > 1 ? <label className="payout-country-field">
          <span>Bank account currency</span>
          <select aria-label="Bank account currency" value={currency} disabled={busy} onChange={(event) => { setCurrency(event.target.value); setValues({}); setProblem(null); }}>
            {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label> : null}
        {!options && !optionsError ? <p className="payout-security-copy" role="status">Loading…</p> : null}
        {optionsError ? <p className="live-stripe-error" role="alert">{optionsError} <button type="button" className="secondary-btn compact-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button></p> : null}
        <div className="payout-form-grid">
          <label>
            <span>Account holder name</span>
            <input data-field="payout_holder" value={holder} autoComplete="organization" onChange={(event) => setHolder(event.target.value)} />
          </label>
          {fields.map(([key, label, placeholder]) => (
            <label key={key}>
              <span>{label}</span>
              <input data-field={`payout_${key}`} value={values[key] ?? ""} placeholder={placeholder} inputMode={key === "account" && fields.length === 1 ? "text" : "numeric"} autoComplete="off"
                     onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />
            </label>
          ))}
        </div>
        {isFirst ? null : (
          <label className="payout-default-choice">
            <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
            <span>Make default</span>
          </label>
        )}
      </div>
      {problem ? <p className="live-stripe-error" role="alert">{problem}</p> : null}
    </PayoutModal>
  );
}

/** onAdded receives the route's { methods, notice }. */
export default function AddPayoutMethodForm(props) {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <PayoutModal title="Add a withdrawal method" onClose={props.onClose} actions={<button className="secondary-btn" type="button" onClick={props.onClose}>Close</button>}>
        <p className="live-stripe-error" role="alert">Withdrawals are not set up on this site yet.</p>
      </PayoutModal>
    );
  }
  return (
    <Elements stripe={payoutStripe()}>
      <BankForm {...props} />
    </Elements>
  );
}
