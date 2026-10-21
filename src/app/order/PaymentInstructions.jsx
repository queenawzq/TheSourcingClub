/**
 * Where a payment stands, when there is nothing to pay.
 *
 * A due or failed payment is paid on the Fund screen (LiveFund.jsx), by card
 * through Stripe. This page is what the same address
 * shows otherwise: a step not reached yet, a payment held or paid out, one
 * cancelled with the order, and a bank-wire claim made on the old site
 * before payments moved to Stripe, which staff still confirm by hand.
 * Read-only: no bank details and no "I have sent this payment" any more.
 */
import React, { useEffect, useState } from "react";
import { getOrder } from "../../lib/domain/order.js";
import { feeCents, getPayment } from "../../lib/domain/payment.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./order.css";

const HEADING = {
  not_due: "Not due yet",
  sent: "Waiting on us",
  processing: "Payment processing",
  confirmed: "Funded: held by TSC",
  released: "Paid out",
  cancelled: "Cancelled",
};

function explain(payment, factory) {
  switch (payment.state) {
    case "not_due":
      return "Nothing to pay yet. This payment falls due when its step opens, and you fund it then.";
    case "sent":
      return `You marked this sent by bank transfer on ${new Date(payment.sent_at).toLocaleDateString()}. We are checking for it, and will tell ${factory} the moment it arrives.`;
    case "processing":
      return `Stripe is confirming your payment. ${factory} starts when it goes through.`;
    case "confirmed":
      return `TSC holds this payment. ${factory} is paid when you approve the step.`;
    case "released":
      return `Paid on to ${factory}.`;
    case "cancelled":
      return "This payment was cancelled with the order. Nothing is owed.";
    default:
      // Never the raw state name ("not_due") in front of a person.
      return "Nothing to do on this payment right now.";
  }
}

export default function PaymentInstructions({ orderId, paymentId }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getOrder(orderId), getPayment(orderId, paymentId)])
      .then(([order, payment]) => {
        if (!order || !payment) throw new Error("that payment is not available to you");
        setState({ order, payment });
      })
      .catch(setError);
  }, [orderId, paymentId]);

  if (error && !state) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>← Back</button>
        <h1>Not available</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!state) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  const { order, payment } = state;
  const factory = order.factory?.name ?? "the factory";
  const fee = payment.charged_cents ? payment.charged_cents - payment.amount_cents : feeCents(payment);

  return (
    <div className="rfq-page rfq-detail">
      <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>
        ← Back to the order
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>{payment.order_milestones?.title ?? "Payment"}</h1>
          <p>{order.order_number} · {factory}</p>
        </div>
      </header>

      <section className="detail-card">
        <h2>{HEADING[payment.state] ?? "Done"}</h2>
        <dl className="fact-row">
          <div className="fact">
            <dt>Amount</dt>
            <dd data-testid="pay-amount">{formatMoney(payment.amount_cents, payment.currency)}</dd>
          </div>
          <div className="fact">
            <dt>Service fee</dt>
            <dd data-testid="pay-fee">{formatMoney(fee, payment.currency)}</dd>
          </div>
          {payment.payment_method_label ? (
            <div className="fact">
              <dt>Paid with</dt>
              <dd>{payment.payment_method_label}</dd>
            </div>
          ) : null}
        </dl>
        <p className="ob-hint" data-testid="payment-state">{explain(payment, factory)}</p>
      </section>
    </div>
  );
}
