/**
 * Funding a step: the designed `FundScreen` and `SuccessScreen`, inside the
 * design's `FlowShell` ("Fund first payment", step 6 of quote to contract).
 *
 * The brand pays by card or US bank account in Stripe's Payment Element,
 * drawn inside the design's "Select billing method" card. TSC holds the money
 * until the brand approves the step; the service fee (5% on orders of $5,000
 * and over, 7% under) is added on top, and the right rail shows step, fee and
 * total as the database computed them (begin_payment_checkout).
 *
 * Nothing here decides whether a payment went through. After Stripe answers,
 * /api/stripe-sync reads the PaymentIntent back and records it, the same way
 * the webhook does, and this screen shows what was recorded: a card is held
 * at once, a bank payment clears in about 4 business days and can still fail.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
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
  // to pay here, so the page says where the payment stands. A bank payment
  // still clearing keeps the success screen's "processing" form.
  if (!checkout && payment.state !== "processing") return fallback;

  const factory = order.factory?.name ?? "the factory";
  const context = {
    order,
    payment,
    isFirst,
    factory,
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
    <Elements
      stripe={stripeClient()}
      options={{
        clientSecret: checkout.clientSecret,
        appearance: {
          theme: "stripe",
          variables: { colorPrimary: "#1a4df2", colorText: "#0b1020", borderRadius: "10px" },
        },
      }}
    >
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

function Fund({ payment, isFirst, rail, checkout, onBack, onMessage, order, factory }) {
  const stripe = useStripe();
  const elements = useElements();
  const [agreed, setAgreed] = useState([false, false]);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(payment.state === "failed" ? payment.failure_reason || "The last payment did not go through." : null);
  const [done, setDone] = useState(null);

  const figures = amounts(checkout, checkout.currency ?? payment.currency);
  const ready = Boolean(stripe && elements && complete && agreed.every(Boolean) && !busy);
  const fundingMilestone = isFirst ? null : { title: checkout.title, amount: figures.total };

  async function fund() {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });
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
          cta: busy ? "Paying…" : fundingMilestone ? "Fund milestone" : "Fund payment & start",
          onSubmit: fund,
          disabled: !ready,
        },
      }}
    >
      <FundScreen
        live={{
          agreed,
          onAgree: (index, value) => setAgreed((current) => current.map((item, i) => (i === index ? value : item))),
          paymentElement: (
            <div className="live-payment-element" data-testid="payment-element">
              {problem ? <p className="composer-error" role="alert">{problem} Try again, or use another card or bank account.</p> : null}
              <PaymentElement
                options={{ layout: "tabs", wallets: { applePay: "never", googlePay: "never" } }}
                onChange={(event) => setComplete(event.complete)}
              />
              <p className="muted live-payment-note">
                Card or US bank account. TSC holds this payment and pays {factory} only when you approve the step.
                A bank payment takes about 4 business days to clear.
              </p>
            </div>
          ),
        }}
      />
    </FlowShell>
  );
}

/** The design's success screen, in the words of what actually happened. */
function Funded({ payment, checkout = null, isFirst, rail, factory, order, onBack, onMessage }) {
  const currency = checkout?.currency ?? payment.currency;
  const total = formatMoney(checkout?.chargedCents ?? payment.charged_cents ?? payment.amount_cents, currency);
  const step = checkout?.title ?? payment.order_milestones?.title ?? "this step";
  const copy = useMemo(() => {
    if (payment.state === "processing" || payment.state === "verify") {
      return {
        title: payment.state === "verify" ? "Confirm your bank account" : "Bank payment processing",
        message: payment.state === "verify"
          ? `Stripe will send two small deposits to your bank account in 1–2 business days. Confirm their amounts from Stripe's email to finish paying ${total}.`
          : `${total} from ${ending(payment.payment_method_label)} is on its way. Bank payments take about 4 business days to clear.`,
        next: `${factory} is told now and starts ${step.toLowerCase()} when the payment clears. If the bank sends it back, you can pay again from the order.`,
      };
    }
    return {
      title: isFirst ? "Payment received" : `${step} funded`,
      message: `${total} was charged to ${ending(payment.payment_method_label)}. ${factory} has been told that ${step.toLowerCase()} is ready to begin.`,
      next: `TSC holds this payment until you approve the step, then pays ${factory}. You can message the factory or follow its updates from the order.`,
    };
  }, [payment.state, payment.payment_method_label, total, factory, step, isFirst]);

  return (
    <FlowShell
      screen="success"
      heading={payment.state !== "confirmed" ? {
        title: "Bank payment on its way",
        description: "Your bank payment is clearing. The factory starts when it clears, and funds are only released after you approve the step.",
      } : isFirst ? null : {
        title: `${step} funded`,
        description: `TSC holds this payment. ${factory} can start, and it is only released after you approve the step.`,
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
