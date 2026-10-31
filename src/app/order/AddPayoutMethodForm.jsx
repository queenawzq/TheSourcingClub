import React, { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { CardCvcElement, CardExpiryElement, CardNumberElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
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

const CARD_OPTIONS = {
  style: {
    base: {
      color: "#0b1020",
      fontFamily: "Satoshi, Arial, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      "::placeholder": { color: "#8391a8" },
    },
    invalid: { color: "#c62828" },
  },
};

/**
 * The fields a bank in each country is known by. Stripe's routing_number is
 * the US routing number, the UK sort code, or Canada's transit and
 * institution numbers; everywhere else the IBAN is the whole account.
 */
function bankFieldsFor(country) {
  if (country === "US") {
    return [
      ["routing", "Routing number", "110000000", /^\d{9}$/],
      ["account", "Account number", "000123456789", /^\d{4,17}$/],
    ];
  }
  if (country === "GB") {
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

function BankForm({ org, country, currency, isFirst, onAdded, onClose }) {
  const stripe = useStripe();
  const fields = bankFieldsFor(country);
  const [values, setValues] = useState({});
  const [holder, setHolder] = useState(org.name ?? "");
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const ready = holder.trim() && fields.every(([key, , , pattern]) => pattern.test(clean(values[key])));

  async function save() {
    if (!stripe || !ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { token, error } = await stripe.createToken("bank_account", tokenDetails(country, currency, values, holder));
      if (error) throw new Error(error.message);
      onAdded(await connectAction(org.id, "add_method", { token: token.id, makeDefault: isFirst || makeDefault }));
    } catch (failure) {
      setProblem(failure.message || "The bank account could not be added.");
      setBusy(false);
    }
  }

  return (
    <PayoutModal
      title="Add a bank account"
      eyebrow="Payments"
      onClose={busy ? () => {} : onClose}
      actions={<>
        <button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary-btn" type="button" data-testid="save-bank-account" disabled={!stripe || !ready || busy} onClick={save}>{busy ? "Adding…" : "Add bank account"}</button>
      </>}
    >
      <p className="payout-modal-intro">Withdrawals are paid to this account in {currency.toUpperCase()}. The account must be in your company’s name.</p>
      <div className="payout-manual-fields">
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
            <span>Send my withdrawals to this account</span>
          </label>
        )}
      </div>
      {problem ? <p className="live-stripe-error" role="alert">{problem}</p> : null}
      <p className="payout-security-copy">Your bank details go straight to Stripe, TSC’s payment partner. TSC keeps only the last four digits. Everyone at your company is told when a payout method changes.</p>
    </PayoutModal>
  );
}

function CardForm({ org, currency, onAdded, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [complete, setComplete] = useState({ number: false, expiry: false, cvc: false });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const ready = Object.values(complete).every(Boolean);

  async function save() {
    if (!stripe || !elements || !ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { token, error } = await stripe.createToken(elements.getElement(CardNumberElement), { currency: currency.toLowerCase() });
      if (error) throw new Error(error.message);
      onAdded(await connectAction(org.id, "add_method", { token: token.id }));
    } catch (failure) {
      setProblem(failure.message || "The card could not be added.");
      setBusy(false);
    }
  }

  const field = (key, Element, label, extra = {}) => (
    <label className={`billing-card-field${key === "number" ? " billing-card-number" : ""}`}>
      <span>{label}</span>
      <div className="billing-stripe-input">
        <Element options={{ ...CARD_OPTIONS, ...extra }} onChange={(event) => setComplete((current) => ({ ...current, [key]: event.complete }))} />
      </div>
    </label>
  );

  return (
    <PayoutModal
      title="Add a debit card"
      eyebrow="Payments"
      onClose={busy ? () => {} : onClose}
      actions={<>
        <button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary-btn" type="button" data-testid="save-payout-card" disabled={!stripe || !ready || busy} onClick={save}>{busy ? "Adding…" : "Add debit card"}</button>
      </>}
    >
      <p className="payout-modal-intro">A debit card in your company’s name, for instant payouts where Stripe offers them. Your withdrawals keep going to your default bank account.</p>
      <div className="billing-card-form">
        {field("number", CardNumberElement, "Card number", { showIcon: true })}
        {field("expiry", CardExpiryElement, "Expiration date")}
        {field("cvc", CardCvcElement, "Security code")}
      </div>
      {problem ? <p className="live-stripe-error" role="alert">{problem}</p> : null}
      <p className="payout-security-copy">The card number goes straight to Stripe, TSC’s payment partner. TSC keeps only the last four digits. Everyone at your company is told when a payout method changes.</p>
    </PayoutModal>
  );
}

/** `kind` is "bank" or "card"; onAdded receives the route's { methods, notice }. */
export default function AddPayoutMethodForm({ kind, ...props }) {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <PayoutModal title="Add a payout method" eyebrow="Payments" onClose={props.onClose} actions={<button className="secondary-btn" type="button" onClick={props.onClose}>Close</button>}>
        <p className="live-stripe-error" role="alert">Payouts through Stripe are not set up on this site yet.</p>
      </PayoutModal>
    );
  }
  return (
    <Elements stripe={payoutStripe()}>
      {kind === "card" ? <CardForm {...props} /> : <BankForm {...props} />}
    </Elements>
  );
}
