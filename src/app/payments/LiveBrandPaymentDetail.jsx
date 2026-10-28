import React, { useEffect, useMemo, useState } from "react";
import { getOrder } from "../../lib/domain/order.js";
import { can } from "../../lib/domain/org.js";
import { chargedCents, getPayment } from "../../lib/domain/payment.js";
import { useAuth } from "../../lib/auth.jsx";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./brand-payment-detail.css";

const STATUS = {
  failed: "Failed",
  processing: "Payment processing",
  sent: "Submitted",
  confirmed: "Funded",
  released: "Paid",
  cancelled: "Cancelled",
  due: "Not paid",
  not_due: "Not due",
};

const date = (value) => value
  ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";

function activityDate(payment) {
  return payment.released_at ?? payment.confirmed_at ?? payment.failed_at ?? payment.processing_at
    ?? payment.sent_at ?? payment.due_at ?? payment.created_at;
}

/**
 * Where the money is, in words that match the step: a payment-only step (a
 * deposit or balance) needs no approval and is paid out once funded; a paid
 * step is held until the brand approves it, then paid out.
 */
function statusExplanation(payment, factory) {
  const step = payment.order_milestones;
  const paymentOnly = step?.kind === "payment_only";
  const approved = Boolean(payment.release_requested_at) || step?.state === "complete";
  switch (payment.state) {
    case "processing":
      return payment.payment_method_type === "us_bank_account"
        ? `Stripe is confirming this bank payment. It can take several business days, and ${factory} has not been paid yet.`
        : `Stripe is confirming this payment. ${factory} has not been paid yet.`;
    case "confirmed":
      if (paymentOnly) return `The payment is complete. This step needs no approval, so TSC pays it out to ${factory}; the payout is on its way.`;
      if (approved) return `The payment is complete and you approved this milestone. TSC is paying it out to ${factory}; the payout is on its way.`;
      return `The payment is complete and TSC is holding the funds. They are released to ${factory} after you approve this milestone.`;
    case "released":
      return paymentOnly
        ? `TSC paid the funds out to ${factory}. This step needed no approval.`
        : `TSC released the funds to ${factory} after the milestone was approved.`;
    case "failed":
      return payment.failure_reason
        ? `The payment was not completed: ${payment.failure_reason}`
        : "The payment was not completed and no funds are being held.";
    case "sent":
      return "This legacy bank transfer was submitted and is waiting for confirmation.";
    case "cancelled":
      return "This payment was cancelled and no funds are due.";
    case "due":
      return paymentOnly
        ? `This step is open and waiting for payment. It needs no approval: once it is paid, TSC pays it to ${factory}.`
        : `This step is open and waiting for payment. TSC holds the payment until you approve the step, then pays ${factory}.`;
    default:
      return "This payment has not been completed.";
  }
}

function methodLabel(payment) {
  if (payment.payment_method_label) return payment.payment_method_label;
  if (payment.payment_method_type === "card") return "Card";
  if (payment.payment_method_type === "us_bank_account") return "Bank account";
  return "—";
}

export default function LiveBrandPaymentDetail({ orderId, paymentId }) {
  const { navigate } = useRouter();
  const { activeOrg } = useAuth();
  const [state, setState] = useState({ loading: true, order: null, payment: null, error: null });

  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
    let cancelled = false;
    Promise.all([getOrder(orderId), getPayment(orderId, paymentId)]).then(
      ([order, payment]) => {
        if (!order || !payment) throw new Error("That transaction is not available to you.");
        if (!cancelled) setState({ loading: false, order, payment, error: null });
      },
      (error) => !cancelled && setState({ loading: false, order: null, payment: null, error }),
    );
    return () => { cancelled = true; };
  }, [orderId, paymentId]);

  const content = useMemo(() => {
    if (!state.payment || !state.order) return null;
    const { payment, order } = state;
    const total = chargedCents(payment);
    const fee = Math.max(0, total - Number(payment.amount_cents));
    return {
      title: payment.order_milestones?.title ?? "Payment",
      orderTitle: order.rfqs?.title ?? order.order_number,
      factory: order.factory?.name ?? "Factory",
      status: STATUS[payment.state] ?? "Payment",
      statusKey: payment.state === "released" ? "paid" : payment.state === "confirmed" ? "funded" : payment.state,
      explanation: statusExplanation(payment, order.factory?.name ?? "the factory"),
      date: date(activityDate(payment)),
      method: methodLabel(payment),
      milestone: formatMoney(payment.amount_cents, payment.currency),
      fee: formatMoney(fee, payment.currency),
      total: formatMoney(total, payment.currency),
    };
  }, [state]);

  if (state.loading) {
    return <main className="billing-page-shell brand-payment-detail-page"><div className="spinner" aria-hidden="true" /></main>;
  }

  if (state.error || !content) {
    return (
      <main className="billing-page-shell brand-payment-detail-page">
        <button className="brand-payment-back" type="button" onClick={() => navigate("/payments")}>← Back to payments</button>
        <section className="brand-payment-detail-card"><h1>Transaction unavailable</h1><p>{state.error?.message}</p></section>
      </main>
    );
  }

  const { order, payment } = state;
  // A due payment, or one that came back, is paid on the Fund screen, which
  // only an owner may use (begin_payment_checkout), and only on an active
  // order. A member is told who can, rather than sent to a refusal.
  const payable = (payment.state === "due" || payment.state === "failed") && order.status === "active";
  const canPay = payable && can(activeOrg, "releaseFunds");
  const ownerOnly = payable && !canPay
    ? `Only someone with Release funds at ${activeOrg?.name || "your company"} can pay for a step.`
    : null;
  return (
    <main className="billing-page-shell brand-payment-detail-page">
      <button className="brand-payment-back" type="button" onClick={() => navigate("/payments")}>← Back to payments</button>

      <header className="brand-payment-detail-header">
        <div>
          <span>Transaction details</span>
          <h1>{content.title}</h1>
          <p>{content.factory} · {content.orderTitle}</p>
        </div>
        <div className="brand-payment-detail-total">
          <span>Total</span>
          <strong>{content.total}</strong>
        </div>
      </header>

      <section className="brand-payment-detail-card brand-payment-status-card">
        <div>
          <span className={`billing-status payout-status-${content.statusKey}`}>{content.status}</span>
          <h2>{content.status}</h2>
          <p>{content.explanation}</p>
          {canPay ? (
            <button
              className="primary-btn compact-btn brand-payment-pay-again"
              type="button"
              onClick={() => navigate(`/orders/${order.id}/payments/${payment.id}`)}
            >
              {payment.state === "failed" ? "Pay again" : "Pay now"}
            </button>
          ) : null}
          {ownerOnly ? <p data-testid="payment-owner-only">{ownerOnly}</p> : null}
        </div>
        <dl className="brand-payment-facts">
          <div><dt>Date</dt><dd>{content.date}</dd></div>
          <div><dt>Vendor</dt><dd>{content.factory}</dd></div>
          <div><dt>Payment method</dt><dd>{content.method}</dd></div>
          <div><dt>Transaction ID</dt><dd>{payment.id}</dd></div>
        </dl>
      </section>

      <section className="brand-payment-detail-card">
        <div className="brand-payment-card-heading">
          <div><h2>Payment breakdown</h2><p>{content.title} for {content.orderTitle}</p></div>
          <button className="secondary-btn compact-btn" type="button" onClick={() => navigate(`/orders/${order.id}`)}>View order</button>
        </div>
        <dl className="brand-payment-breakdown">
          <div><dt>Milestone amount</dt><dd>{content.milestone}</dd></div>
          <div><dt>TSC service fee</dt><dd>{content.fee}</dd></div>
          <div className="total"><dt>Total charged</dt><dd>{content.total}</dd></div>
        </dl>
      </section>
    </main>
  );
}
