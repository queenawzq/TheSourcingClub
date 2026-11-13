/**
 * Funding a step: the designed `FundScreen` and `SuccessScreen`, inside the
 * design's `FlowShell` ("Fund first payment", step 6 of quote to contract).
 *
 * The brand pays by card in Stripe's Payment Element, drawn inside the
 * design's card-details section. TSC holds the money
 * until the brand approves the step; the service fee (5% on orders of $5,000
 * and over, 7% under) and the card processing fee are added on top, and the
 * right rail shows step, fees and total as the database computed them
 * (begin_payment_checkout).
 *
 * Only an owner may pay (begin_payment_checkout). A member who opens a due
 * payment is told who can, before anything is started at Stripe.
 *
 * The heading above each screen is always this payment's own: the design's
 * copy is about a sample that needs approval, and a first payment can be a
 * deposit that needs none.
 *
 * Nothing here decides whether a payment went through. After Stripe answers,
 * /api/stripe-sync reads the PaymentIntent back and records it, the same way
 * the webhook does, and this screen shows what was recorded.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { FlowShell, FundScreen, SuccessScreen } from "../../prototype/main.jsx";
import { getOrder } from "../../lib/domain/order.js";
import { getPayment, listPayments } from "../../lib/domain/payment.js";
import { cardReason, plainCardReason } from "../../shared/card-words.mjs";
import { STRIPE_PUBLISHABLE_KEY, startCheckout, syncPayment, withCardAdvice } from "../../lib/domain/stripe.js";
import { formatMoney } from "../../lib/money.js";
import { useAuth } from "../../lib/auth.jsx";
import { can } from "../../lib/domain/org.js";
import { useRouter } from "../../lib/router.jsx";
import { initials, locationLine } from "./order-view.js";
import "./fund.css";

let stripePromise = null;
const stripeClient = () => {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  stripePromise ??= loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
};

/** "Visa ···4242" → "Visa ending in 4242", the design's words. */
const ending = (label) => (label ? label.replace(/\s*···/, " ending in ") : "your payment method");

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

/** The payable states: a step that is due, or a payment that came back. */
export const FUNDABLE = new Set(["due", "failed"]);

export default function LiveFund({ orderId, paymentId, fallback }) {
  const { navigate } = useRouter();
  const { activeOrg } = useAuth();
  // Release funds pays (begin_payment_checkout); the same rule here.
  const isOwner = can(activeOrg, "releaseFunds");
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [order, payment, payments] = await Promise.all([
      getOrder(orderId),
      getPayment(orderId, paymentId),
      listPayments(orderId),
    ]);
    if (!order || !payment) throw new Error("That payment is not available to you.");

    // The order's first paid step is the design's "first payment"; any later
    // one is funded as "Fund <step>".
    const first = [...payments].sort((a, b) => (a.order_milestones?.sort ?? 0) - (b.order_milestones?.sort ?? 0))[0];
    let checkout = null;
    let current = payment;
    if (FUNDABLE.has(payment.state) && !isOwner) {
      // Nothing to start at Stripe: the screen below says who can pay.
      setState({ order, payment, checkout: null, isFirst: false, ownerOnly: true });
      return;
    }
    if (FUNDABLE.has(payment.state)) {
      // No publishable key: no form can be drawn, so start nothing at Stripe.
      if (!STRIPE_PUBLISHABLE_KEY) {
        const failure = new Error("payments are not set up on this site yet");
        failure.status = 503;
        throw failure;
      }
      try {
        checkout = await startCheckout(paymentId);
      } catch (failure) {
        // Already under way (paid in another tab): read it back and show that.
        if (failure.status !== 409) throw failure;
        current = { ...payment, ...(await syncPayment(paymentId)) };
      }
    } else if (payment.state === "processing") {
      current = { ...payment, ...(await syncPayment(paymentId).catch(() => ({}))) };
    }
    setState({ order, payment: current, checkout, isFirst: first?.id === payment.id });
  }, [orderId, paymentId, isOwner]);

  useEffect(() => { load().catch(setError); }, [load]);

  const back = () => navigate(`/orders/${orderId}`);

  // No Stripe keys on this site (a preview without them, or a laptop): say
  // so plainly rather than as an error.
  const notSetUp = (
    <main className="home-page">
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={back}>← Back to the order</button>
        <h1>Payments are not set up on this site yet</h1>
        <p className="muted" data-testid="payments-not-set-up">No payment can be taken on this site.</p>
      </div>
    </main>
  );
  if (error?.status === 503) return notSetUp;

  if (error && !state) {
    return (
      <main className="home-page">
        <div className="rfq-page">
          <button type="button" className="quiet-btn" onClick={back}>← Back to the order</button>
          <h1>Not available</h1>
          <p className="ob-error" role="alert">{error.message}</p>
        </div>
      </main>
    );
  }
  if (!state) return <main className="home-page"><div className="rfq-page"><div className="spinner" aria-hidden="true" /></div></main>;

  const { order, payment, checkout, isFirst, ownerOnly } = state;

  if (ownerOnly) {
    return (
      <main className="home-page">
        <div className="rfq-page">
          <button type="button" className="quiet-btn" onClick={back}>← Back to the order</button>
          <h1>{payment.order_milestones?.title ?? "Payment"}</h1>
          <p className="muted" data-testid="fund-owner-only">
            Only someone with Release funds at {activeOrg?.name || "your company"} can pay for a step. Ask them to fund it from this order, or ask an owner for the permission in Settings.
          </p>
        </div>
      </main>
    );
  }

  // Held, paid out, cancelled, not due or a legacy bank-wire claim: nothing
  // to pay here, so the page says where the payment stands. A payment Stripe
  // is still confirming keeps the success screen's "processing" form.
  if (!checkout && payment.state !== "processing") return fallback;

  const factory = order.factory?.name ?? "the factory";
  const context = {
    order,
    payment,
    isFirst,
    factory,
    // A deposit or balance needs no approval: TSC pays it out once funded.
    paymentOnly: payment.order_milestones?.kind === "payment_only",
    rail: {
      initials: initials(factory),
      factory,
      location: locationLine(order.factory?.factory_profiles),
    },
    onBack: back,
    onMessage: () => navigate(`/orders/${orderId}/messages`),
  };

  if (!checkout) return <Funded {...context} />;

  return (
    <Elements stripe={stripeClient()}>
      <Fund {...context} checkout={checkout} reload={load} />
    </Elements>
  );
}

function amounts(checkout, currency) {
  return {
    subtotal: formatMoney(checkout.amountCents, currency),
    fee: formatMoney(checkout.feeCents, currency),
    processingFee: Number(checkout.processingFeeCents) ? formatMoney(checkout.processingFeeCents, currency) : null,
    total: formatMoney(checkout.chargedCents, currency),
    feeLabel: `TSC service fee (${Number(checkout.feeBps) / 100}%)`,
  };
}

/**
 * What a brand reads when Stripe.js refuses the card. Its message for a
 * failed bank check already says "try again", which the screen adds too.
 */
const cardProblem = cardReason;

function Fund({ payment, isFirst, paymentOnly, rail, checkout, onBack, onMessage, order, factory }) {
  const stripe = useStripe();
  const elements = useElements();
  const [agreed, setAgreed] = useState([false]);
  const savedCards = checkout.savedCards ?? [];
  const [addingCard, setAddingCard] = useState(savedCards.length === 0);
  const [selectedCardId, setSelectedCardId] = useState(savedCards[0]?.id ?? "");
  const [newCardComplete, setNewCardComplete] = useState({ number: false, expiry: false, cvc: false });
  const [postalCode, setPostalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(payment.state === "failed" ? plainCardReason(payment.failure_reason) : null);
  const [done, setDone] = useState(null);

  const figures = amounts(checkout, checkout.currency ?? payment.currency);
  const paymentMethodReady = addingCard
    ? Boolean(elements && Object.values(newCardComplete).every(Boolean))
    : Boolean(selectedCardId);
  const ready = Boolean(stripe && paymentMethodReady && agreed.every(Boolean) && !busy);
  // The one thing the brand must know before paying is the one box it ticks:
  // a deposit or balance goes straight to the factory, a paid step waits for
  // its approval. The page's other sentences said the same thing again.
  const fundingMilestone = {
    title: checkout.title,
    amount: figures.total,
    railStep: checkout.title,
  };
  const heading = { eyebrow: "FUND" };

  async function fund() {
    if (!ready) return;
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
      // Recorded either way: a decline is a failed payment with its reason.
      const synced = await syncPayment(payment.id).catch(() => null);
      if (result.error) {
        setProblem(cardProblem(result.error));
        return;
      }
      const intent = result.paymentIntent;
      // A failed 3-D Secure check comes back as an intent, not an error: it
      // wants a payment method again. Nothing was charged, so say so here.
      if (synced?.state === "failed" || intent?.status === "requires_payment_method" || intent?.status === "canceled") {
        setProblem(synced?.failure_reason ? plainCardReason(synced.failure_reason) : cardReason(intent?.last_payment_error));
        return;
      }
      if (intent?.status === "requires_action" && intent.next_action?.type === "verify_with_microdeposits") {
        setDone({ state: "verify", label: synced?.payment_method_label });
        return;
      }
      setDone({ state: synced?.state ?? (intent?.status === "processing" ? "processing" : "confirmed"), label: synced?.payment_method_label });
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Funded
        payment={{ ...payment, state: done.state, payment_method_label: done.label, charged_cents: checkout.chargedCents }}
        checkout={checkout}
        isFirst={isFirst}
        paymentOnly={paymentOnly}
        rail={rail}
        factory={factory}
        order={order}
        onBack={onBack}
        onMessage={onMessage}
      />
    );
  }

  return (
    <FlowShell
      screen="fund"
      onBack={onBack}
      onNext={fund}
      primaryLabel={busy ? "Paying…" : undefined}
      primaryDisabled={!ready}
      fundingMilestone={fundingMilestone}
      heading={heading}
      rail={{
        fund: {
          ...rail,
          paymentLabel: checkout.title,
          subtotal: figures.subtotal,
          fee: figures.fee,
          feeLabel: figures.feeLabel,
          processingFee: figures.processingFee,
          processingFeeLabel: "Card processing fee",
          total: figures.total,
          totalLabel: "Total charged",
        },
      }}
    >
      <FundScreen
        live={{
          // A brand with a saved card is asked to choose one, as the design
          // draws it; "Card details" promised a card form that was not there.
          title: addingCard ? "Card details" : "Select billing method",
          agreements: [paymentOnly
            ? `I understand TSC pays this step to ${factory} once it is funded.`
            : "I understand funds are released after I approve this step."],
          agreed,
          onAgree: (index, value) => setAgreed((current) => current.map((item, i) => (i === index ? value : item))),
          paymentElement: (
            <div className="live-payment-element" data-testid="payment-element">
              {problem ? <p className="composer-error" role="alert">{withCardAdvice(problem)}</p> : null}
              {savedCards.length > 0 && (
                <div className="saved-card-list" role="radiogroup" aria-label="Saved cards">
                  {savedCards.map((card) => (
                    <label className={`saved-card-row${!addingCard && selectedCardId === card.id ? " selected" : ""}`} key={card.id}>
                      <input
                        type="radio"
                        name="saved-card"
                        value={card.id}
                        aria-label={`${card.brand} ending in ${card.last4}`}
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
                          options={{ ...CARD_ELEMENT_OPTIONS, showIcon: true, disableLink: true }}
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
                  <p className="muted save-card-note">Saved for future payments.</p>
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
          ),
        }}
      />
    </FlowShell>
  );
}

/** The design's success screen, in the words of what actually happened. */
function Funded({ payment, checkout = null, isFirst, paymentOnly = false, rail, factory, order, onBack, onMessage }) {
  // The card form is long, so paying leaves the page scrolled; the result
  // opens at its heading.
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const currency = checkout?.currency ?? payment.currency;
  const total = formatMoney(checkout?.chargedCents ?? payment.charged_cents ?? payment.amount_cents, currency);
  // Each fee as checkout or the database computed it: the total less the
  // step would put the card fee under the service fee's name.
  const processingFeeCents = Number(checkout?.processingFeeCents ?? payment.processing_fee_cents ?? 0);
  const step = checkout?.title ?? payment.order_milestones?.title ?? "this step";
  // A payment-only step is paid on to the factory as soon as it is funded,
  // so it comes back released, not confirmed: it was charged all the same.
  const paid = payment.state === "confirmed" || payment.state === "released";
  const copy = useMemo(() => {
    if (payment.state === "processing" || payment.state === "verify") {
      return {
        title: payment.state === "verify" ? "Confirm your bank account" : "Payment processing",
        message: payment.state === "verify"
          ? `Two small deposits reach your bank account in 1–2 business days. Confirm their amounts from the email to finish paying ${total}.`
          : `${total} from ${ending(payment.payment_method_label)} is on its way.`,
        next: "If it fails, you can pay again from the order.",
      };
    }
    return {
      title: "Payment received",
      message: `${total} was charged to ${ending(payment.payment_method_label)}.`,
      next: null,
    };
  }, [payment.state, payment.payment_method_label, total, factory, step, isFirst, paymentOnly]);

  return (
    <FlowShell
      screen="success"
      canBack={false}
      fundingMilestone={{ title: step, amount: total, railStep: step }}
      heading={!paid ? {
        eyebrow: "FUND",
        title: "Payment on its way",
      } : {
        eyebrow: "FUND",
        title: `${step} funded`,
      }}
      onBack={onBack}
      onNext={onBack}
      primaryLabel="Go to the order"
      rail={{
        fund: {
          ...rail,
          paymentLabel: step,
          subtotal: formatMoney(checkout?.amountCents ?? payment.amount_cents, currency),
          // The fees as checkout computed them; a payment read back without a
          // checkout (still clearing) reads them from the database.
          fee: formatMoney(checkout?.feeCents ?? payment.service_fee_cents ?? 0, currency),
          feeLabel: "TSC service fee",
          processingFee: processingFeeCents ? formatMoney(processingFeeCents, currency) : null,
          processingFeeLabel: "Card processing fee",
          total,
          totalLabel: paid ? "Paid today" : "Clearing",
        },
      }}
    >
      <SuccessScreen
        live={{
          ...copy,
          dashboardLabel: null,
          onDashboard: onBack,
          onMessage,
        }}
      />
      <span hidden data-testid="fund-result" data-state={payment.state} data-order={order.id} />
    </FlowShell>
  );
}
