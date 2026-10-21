/**
 * Funding a step: the designed `FundScreen` and `SuccessScreen`, inside the
 * design's `FlowShell` ("Fund first payment", step 6 of quote to contract).
 *
 * The brand pays by card in Stripe's Payment Element, drawn inside the
 * design's card-details section. TSC holds the money
 * until the brand approves the step; the service fee (5% on orders of $5,000
 * and over, 7% under) is added on top, and the right rail shows step, fee and
 * total as the database computed them (begin_payment_checkout).
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
import { STRIPE_PUBLISHABLE_KEY, startCheckout, syncPayment } from "../../lib/domain/stripe.js";
import { formatMoney } from "../../lib/money.js";
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
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [order, payment, payments] = await Promise.all([
      getOrder(orderId),
      getPayment(orderId, paymentId),
      listPayments(orderId),
    ]);
    if (!order || !payment) throw new Error("that payment is not available to you");

    // The order's first paid step is the design's "first payment"; any later
    // one is funded as "Fund <step>".
    const first = [...payments].sort((a, b) => (a.order_milestones?.sort ?? 0) - (b.order_milestones?.sort ?? 0))[0];
    let checkout = null;
    let current = payment;
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
  }, [orderId, paymentId]);

  useEffect(() => { load().catch(setError); }, [load]);

  const back = () => navigate(`/orders/${orderId}`);

  // No Stripe keys on this site (a preview without them, or a laptop): say
  // so plainly rather than as an error.
  const notSetUp = (
    <main className="home-page">
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={back}>← Back to the order</button>
        <h1>Payments are not set up on this site yet</h1>
        <p className="muted" data-testid="payments-not-set-up">This site has no Stripe keys, so no payment can be taken here.</p>
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

  const { order, payment, checkout, isFirst } = state;

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
    total: formatMoney(checkout.chargedCents, currency),
    feeLabel: `TSC service fee (${Number(checkout.feeBps) / 100}%)`,
  };
}

function Fund({ payment, isFirst, paymentOnly, rail, checkout, onBack, onMessage, order, factory }) {
  const stripe = useStripe();
  const elements = useElements();
  const [agreed, setAgreed] = useState([false, false]);
  const savedCards = checkout.savedCards ?? [];
  const [addingCard, setAddingCard] = useState(savedCards.length === 0);
  const [selectedCardId, setSelectedCardId] = useState(savedCards[0]?.id ?? "");
  const [newCardComplete, setNewCardComplete] = useState({ number: false, expiry: false, cvc: false });
  const [postalCode, setPostalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(payment.state === "failed" ? payment.failure_reason || "The last payment did not go through." : null);
  const [done, setDone] = useState(null);

  const figures = amounts(checkout, checkout.currency ?? payment.currency);
  const paymentMethodReady = addingCard
    ? Boolean(elements && Object.values(newCardComplete).every(Boolean))
    : Boolean(selectedCardId);
  const ready = Boolean(stripe && paymentMethodReady && agreed.every(Boolean) && !busy);
  // FlowShell words a later step as "Funds stay protected until the related
  // step is approved", which a payment-only step never is: it gets its own
  // note (fundNote), and the first payment its own heading.
  const paymentOnlyNote = `Add ${figures.total} for ${checkout.title.toLowerCase()}. This step needs no approval: TSC pays it to ${factory} once it is funded.`;
  const fundingMilestone = isFirst ? null : {
    title: checkout.title,
    amount: figures.total,
    ...(paymentOnly ? { fundNote: paymentOnlyNote } : {}),
  };
  const heading = paymentOnly && isFirst ? { description: paymentOnlyNote } : null;

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
        setProblem(result.error.message || "The payment did not go through.");
        return;
      }
      const intent = result.paymentIntent;
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
      centerText={`${figures.total} incl. ${figures.feeLabel.replace("TSC service fee", "service fee")}`}
      rail={{
        fund: {
          ...rail,
          paymentLabel: checkout.title,
          subtotal: figures.subtotal,
          fee: figures.fee,
          feeLabel: figures.feeLabel,
          total: figures.total,
          totalLabel: "Total charged",
          cta: busy ? "Paying…" : isFirst ? "Fund payment & start" : "Fund milestone",
          onSubmit: fund,
          disabled: !ready,
        },
      }}
    >
      <FundScreen
        live={{
          // The design's two promises are about approval; a payment-only
          // step is paid on as soon as it is funded.
          agreements: paymentOnly
            ? [`I understand TSC pays this step to ${factory} once it is funded.`, "TSC may hold funds if the payment is disputed."]
            : null,
          agreed,
          onAgree: (index, value) => setAgreed((current) => current.map((item, i) => (i === index ? value : item))),
          paymentElement: (
            <div className="live-payment-element" data-testid="payment-element">
              {problem ? <p className="composer-error" role="alert">{problem} Try again, or use another card.</p> : null}
              {savedCards.length > 0 && (
                <div className="saved-card-list" role="radiogroup" aria-label="Saved cards">
                  {savedCards.map((card) => (
                    <label className={`saved-card-row${!addingCard && selectedCardId === card.id ? " selected" : ""}`} key={card.id}>
                      <input
                        type="radio"
                        name="saved-card"
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
              <p className="muted live-payment-note">
                {paymentOnly
                  ? `This step needs no approval: once your payment goes through, TSC pays it to ${factory}.`
                  : `TSC holds this card payment and pays ${factory} only when you approve the step.`}
              </p>
            </div>
          ),
        }}
      />
    </FlowShell>
  );
}

/** The design's success screen, in the words of what actually happened. */
function Funded({ payment, checkout = null, isFirst, paymentOnly = false, rail, factory, order, onBack, onMessage }) {
  const currency = checkout?.currency ?? payment.currency;
  const total = formatMoney(checkout?.chargedCents ?? payment.charged_cents ?? payment.amount_cents, currency);
  const step = checkout?.title ?? payment.order_milestones?.title ?? "this step";
  const copy = useMemo(() => {
    if (payment.state === "processing" || payment.state === "verify") {
      return {
        title: payment.state === "verify" ? "Confirm your bank account" : "Payment processing",
        message: payment.state === "verify"
          ? `Stripe will send two small deposits to your bank account in 1–2 business days. Confirm their amounts from Stripe's email to finish paying ${total}.`
          : `${total} from ${ending(payment.payment_method_label)} is on its way. Stripe is still confirming it.`,
        next: `${factory} is told now and starts ${step.toLowerCase()} when the payment goes through. If it fails, you can pay again from the order.`,
      };
    }
    return {
      title: isFirst ? "Payment received" : `${step} funded`,
      message: `${total} was charged to ${ending(payment.payment_method_label)}. ${factory} has been told that ${step.toLowerCase()} is ready to begin.`,
      next: paymentOnly
        ? `This step needs no approval, so TSC pays it to ${factory} now that it is funded. You can message the factory or follow its updates from the order.`
        : `TSC holds this payment until you approve the step, then pays ${factory}. You can message the factory or follow its updates from the order.`,
    };
  }, [payment.state, payment.payment_method_label, total, factory, step, isFirst, paymentOnly]);

  return (
    <FlowShell
      screen="success"
      heading={payment.state !== "confirmed" ? {
        title: "Payment on its way",
        description: paymentOnly
          ? `Stripe is confirming your payment. This step needs no approval: TSC pays it to ${factory} once it goes through.`
          : "Stripe is confirming your payment. The factory starts when it goes through, and funds are only released after you approve the step.",
      } : isFirst ? null : {
        title: `${step} funded`,
        description: paymentOnly
          ? `This step needs no approval, so TSC pays it to ${factory} now that it is funded.`
          : `TSC holds this payment. ${factory} can start, and it is only released after you approve the step.`,
      }}
      onBack={onBack}
      onNext={onBack}
      primaryLabel="Go to the order"
      rail={{
        fund: {
          ...rail,
          paymentLabel: step,
          subtotal: formatMoney(payment.amount_cents, currency),
          fee: formatMoney((checkout?.chargedCents ?? payment.charged_cents ?? payment.amount_cents) - payment.amount_cents, currency),
          feeLabel: "TSC service fee",
          total,
          totalLabel: payment.state === "confirmed" ? "Paid today" : "Clearing",
        },
      }}
    >
      <SuccessScreen
        live={{
          ...copy,
          dashboardLabel: "Go to the order",
          onDashboard: onBack,
          onMessage,
        }}
      />
      <span hidden data-testid="fund-result" data-state={payment.state} data-order={order.id} />
    </FlowShell>
  );
}
