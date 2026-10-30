/**
 * Buying credits: the design's "Get more credits" button and its
 * `CreditPurchaseModal`, wired to Stripe.
 *
 * The modal is Queena's, exported from the factory prototype; live passes it
 * the packs the database sells (credit_packs()), and once a pack is chosen,
 * the card form in place of the packs. The card is collected the way the
 * brand's Fund step collects one (LiveFund.jsx): the company's saved cards,
 * or Stripe's card fields, then confirmCardPayment in place, no redirect.
 *
 * Nothing here decides that credits were bought. After Stripe answers,
 * /api/stripe-credits reads the PaymentIntent back and records it, the same
 * way the webhook does, and the credits appear on the ledger from there.
 *
 * Only an owner buys, as only an owner pays for a step. Anyone else is told
 * who can.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadStripe } from "@stripe/stripe-js";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { CreditPurchaseModal } from "../../factory-prototype/main.jsx";
import { buyCredits, creditPacks, syncCreditPurchase } from "../../lib/domain/credits.js";
import { STRIPE_PUBLISHABLE_KEY, withCardAdvice } from "../../lib/domain/stripe.js";
import { formatMoney } from "../../lib/money.js";
import "./fund.css";
import "./credit-purchase.css";

let stripePromise = null;
const stripeClient = () => {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  stripePromise ??= loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
};

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: "#0b1020",
      fontFamily: "Satoshi, Arial, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      "::placeholder": { color: "#8a98ad" },
    },
    invalid: { color: "#b42318" },
  },
};

const creditsLabel = (credits) => `${Number(credits).toLocaleString("en-US")} credits`;

/**
 * The Credits tab's action. `onPurchased({ credits, state, purchase })` is
 * called once Stripe has charged the card; `state` is "succeeded" when the
 * credits are already on the ledger, "pending" while the record catches up.
 * With `onNotice`, the page shows what happened on a line of its own;
 * without it, the note sits beside the button.
 */
export function CreditPurchaseButton({ orgId, orgName, isOwner = false, onPurchased, onNotice }) {
  const [open, setOpen] = useState(false);
  const [ownNotice, setOwnNotice] = useState(null);
  const notice = onNotice ? null : ownNotice;
  const setNotice = onNotice ?? setOwnNotice;

  if (!isOwner) {
    return (
      <div className="factory-credit-billing-action tsc-credit-buy-action">
        <p className="tsc-credit-buy-note">Ask an owner of {orgName || "your company"} to buy credits.</p>
      </div>
    );
  }

  return (
    <div className="factory-credit-billing-action tsc-credit-buy-action">
      {notice ? <p className="tsc-credit-buy-note" role="status">{notice}</p> : null}
      <button
        className="secondary-btn compact-btn"
        type="button"
        onClick={() => { setNotice(null); setOpen(true); }}
      >
        Get more credits
      </button>
      {open && (
        <Elements stripe={stripeClient()}>
          <CreditPurchaseFlow
            orgId={orgId}
            onClose={() => setOpen(false)}
            onDone={(result) => {
              setOpen(false);
              setNotice(result.state === "succeeded"
                ? `${creditsLabel(result.credits)} added.`
                : `Payment received. Your ${creditsLabel(result.credits)} will appear in a moment.`);
              onPurchased?.(result);
            }}
          />
        </Elements>
      )}
    </div>
  );
}

/**
 * The same purchase, opened from somewhere else (quote review): the page
 * decides when it shows, and stays where it is once the credits are in.
 */
export function CreditPurchaseDialog({ orgId, onClose, onPurchased }) {
  return (
    <Elements stripe={stripeClient()}>
      <CreditPurchaseFlow
        orgId={orgId}
        onClose={onClose}
        onDone={(result) => { onClose(); onPurchased?.(result); }}
      />
    </Elements>
  );
}

// The three packs and the custom amount, as grey blocks of their own size.
function CreditPacksPlaceholder() {
  return (
    <div className="factory-credit-purchase-options tsc-credit-packs-placeholder" role="status" aria-label="Loading credit packs">
      <span />
      <span />
      <span />
      <span className="tsc-credit-custom-placeholder" />
    </div>
  );
}

function CreditPurchaseFlow({ orgId, onClose, onDone }) {
  const stripe = useStripe();
  const elements = useElements();
  const [packs, setPacks] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [addingCard, setAddingCard] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [newCardComplete, setNewCardComplete] = useState({ number: false, expiry: false, cvc: false });
  const [postalCode, setPostalCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    creditPacks()
      .then((rows) => {
        if (cancelled) return;
        setPacks(rows.map((pack) => ({
          credits: pack.credits,
          label: creditsLabel(pack.credits),
          value: formatMoney(pack.amountCents, pack.currency, { whole: pack.amountCents % 100 === 0 }),
        })));
      })
      .catch((failure) => {
        if (cancelled) return;
        setPacks([]);
        setProblem(failure.message);
      });
    return () => { cancelled = true; };
  }, []);

  const savedCards = checkout?.savedCards ?? [];
  const amount = checkout ? formatMoney(checkout.amountCents, checkout.currency, { whole: checkout.amountCents % 100 === 0 }) : null;
  const cardReady = addingCard
    ? Boolean(elements && Object.values(newCardComplete).every(Boolean))
    : Boolean(selectedCardId);

  async function choose(pack) {
    if (!pack || busy) return;
    // No publishable key: no card form can be drawn, so start nothing.
    if (!STRIPE_PUBLISHABLE_KEY) {
      setProblem("Payments are not set up on this site yet.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const started = await buyCredits(orgId, pack.credits);
      setCheckout(started);
      setAddingCard(!(started.savedCards ?? []).length);
      setSelectedCardId(started.savedCards?.[0]?.id ?? "");
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!stripe || !cardReady || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = addingCard
        ? await stripe.confirmCardPayment(checkout.clientSecret, {
            payment_method: {
              card: elements.getElement(CardNumberElement),
              billing_details: postalCode.trim() ? { address: { postal_code: postalCode.trim() } } : undefined,
            },
          })
        : await stripe.confirmCardPayment(checkout.clientSecret, { payment_method: selectedCardId });
      // Recorded either way: a decline is a failed purchase with its reason.
      const synced = await syncCreditPurchase(checkout.purchaseId).catch(() => null);
      if (result.error) {
        const reason = result.error.code === "payment_intent_authentication_failure"
          ? "Your bank did not confirm this payment, so nothing was charged."
          : result.error.message || "The payment did not go through.";
        setProblem(withCardAdvice(reason));
        return;
      }
      // A failed 3-D Secure check comes back as an intent, not an error.
      const intent = result.paymentIntent;
      if (synced?.state === "failed" || intent?.status === "requires_payment_method" || intent?.status === "canceled") {
        setProblem(withCardAdvice(synced?.failure_reason || intent?.last_payment_error?.message));
        return;
      }
      onDone({ credits: checkout.credits, state: synced?.state ?? "pending", purchase: synced });
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const paymentElement = checkout ? (
    <div className="live-payment-element tsc-credit-buy-payment" data-testid="credit-payment-element">
      {savedCards.length > 0 && (
        <div className="saved-card-list" role="radiogroup" aria-label="Saved cards">
          {savedCards.map((card) => (
            <label className={`saved-card-row${!addingCard && selectedCardId === card.id ? " selected" : ""}`} key={card.id}>
              <input
                type="radio"
                name="credit-saved-card"
                value={card.id}
                checked={!addingCard && selectedCardId === card.id}
                onChange={() => { setSelectedCardId(card.id); setAddingCard(false); }}
              />
              <span className="saved-card-icon" aria-hidden="true">▰</span>
              <span className="saved-card-copy">
                <strong>{card.brand} ending in {card.last4}</strong>
                <small>Expires {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {addingCard ? (
        <div className="new-card-fields">
          {savedCards.length > 0 && <h3>Add a new card</h3>}
          <div className="tsc-card-form">
            <label className="tsc-card-field tsc-card-number">
              <span>Card number</span>
              <div className="tsc-stripe-input">
                <CardNumberElement
                  options={{ ...CARD_ELEMENT_OPTIONS, showIcon: true }}
                  onChange={(event) => setNewCardComplete((current) => ({ ...current, number: event.complete }))}
                />
              </div>
            </label>
            <label className="tsc-card-field">
              <span>Expiration date</span>
              <div className="tsc-stripe-input">
                <CardExpiryElement
                  options={CARD_ELEMENT_OPTIONS}
                  onChange={(event) => setNewCardComplete((current) => ({ ...current, expiry: event.complete }))}
                />
              </div>
            </label>
            <label className="tsc-card-field">
              <span>Security code</span>
              <div className="tsc-stripe-input">
                <CardCvcElement
                  options={CARD_ELEMENT_OPTIONS}
                  onChange={(event) => setNewCardComplete((current) => ({ ...current, cvc: event.complete }))}
                />
              </div>
            </label>
            <label className="tsc-card-field tsc-card-postal">
              <span>ZIP / postal code</span>
              <input
                type="text"
                autoComplete="postal-code"
                inputMode="text"
                value={postalCode}
                placeholder="ZIP / postal code"
                onChange={(event) => setPostalCode(event.target.value)}
              />
            </label>
          </div>
          <p className="muted save-card-note">This card will be saved securely to your company for future payments.</p>
        </div>
      ) : null}
      {savedCards.length > 0 && (
        <button
          className="billing-add-btn live-add-card-btn"
          type="button"
          onClick={() => {
            setAddingCard((current) => !current);
            setNewCardComplete({ number: false, expiry: false, cvc: false });
          }}
        >
          {addingCard ? "Use a saved card" : "+ Add a new card"}
        </button>
      )}
    </div>
  ) : null;

  // Mounted on <body>: inside the page, an ancestor makes the fixed layer as
  // tall as the page, and the dialog was centred below the fold.
  return createPortal((
    <CreditPurchaseModal
      language="en"
      className="tsc-credit-buy-modal"
      layerClassName="factory-invite-modal-layer"
      packs={packs ?? []}
      // Until the packs arrive, grey rows the size of the list, rather than
      // an empty list that fills in.
      paymentElement={paymentElement ?? (packs === null ? <CreditPacksPlaceholder /> : null)}
      busy={checkout ? busy || !stripe || !cardReady : busy || packs === null}
      error={problem}
      description={checkout
        ? `${creditsLabel(checkout.credits)} for ${amount}, paid by card. The credits are added as soon as the payment goes through.`
        : "Choose a pack or enter a custom amount. 10 credits = $1. Minimum 50 credits."}
      customMinimumCredits={50}
      customRateCents={10}
      continueLabel={checkout ? (busy ? "Paying…" : `Pay ${amount}`) : busy ? "Starting…" : undefined}
      onContinue={checkout ? pay : choose}
      // Not while Stripe is charging the card: the answer would have nowhere
      // to land (the webhook still records it).
      onClose={() => { if (!busy) onClose(); }}
    />
  ), document.body);
}

export default CreditPurchaseButton;
