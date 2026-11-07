import React, { useEffect, useMemo, useState } from "react";
import { getOrder } from "../../lib/domain/order.js";
import { can, permissionHint } from "../../lib/domain/org.js";
import { chargedCents, getPayment } from "../../lib/domain/payment.js";
import { useAuth } from "../../lib/auth.jsx";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { paymentStatusWord } from "./brand-payments-view.js";
import "../order/payout.css";
import "./brand-payment-detail.css";

/** The list's word, plus the states the list leaves out. */
const statusWord = (payment) => paymentStatusWord(payment)
  ?? ({ cancelled: "Cancelled", not_due: "Not due" })[payment.state]
  ?? "Payment";

const date = (value) => value
  ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";

function activityDate(payment) {
  return payment.released_at ?? payment.confirmed_at ?? payment.failed_at ?? payment.processing_at
    ?? payment.sent_at ?? payment.due_at ?? payment.created_at;
}

/** Only a failure needs words: what went wrong. The status says the rest. */
function failureLine(payment) {
  if (payment.state !== "failed") return null;
  return payment.failure_reason
    ? `The payment was not completed: ${payment.failure_reason}`
    : "The payment was not completed.";
}

function methodLabel(payment) {
  if (payment.payment_method_label) return payment.payment_method_label;
  if (payment.payment_method_type === "card") return "Card";
  if (payment.payment_method_type === "us_bank_account") return "Bank account";
  return null;
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
      status: statusWord(payment),
      statusKey: statusWord(payment).toLowerCase().replaceAll(" ", "-"),
      failure: failureLine(payment),
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
          {content.failure ? <p role="alert" className="brand-payment-failure">{content.failure}</p> : null}
          {payable ? (
            <button
              className="primary-btn compact-btn brand-payment-pay-again"
              type="button"
              disabled={canPay ? undefined : true}
              title={canPay ? undefined : permissionHint(activeOrg, "releaseFunds")}
              onClick={() => navigate(`/orders/${order.id}/payments/${payment.id}`)}
            >
              {payment.state === "failed" ? "Pay again" : "Pay now"}
            </button>
          ) : null}
        </div>
        <dl className="brand-payment-facts">
          <div><dt>Date</dt><dd>{content.date}</dd></div>
          <div><dt>Vendor</dt><dd>{content.factory}</dd></div>
          {content.method ? <div><dt>Payment method</dt><dd>{content.method}</dd></div> : null}
          <div><dt>Order</dt><dd>{order.order_number}</dd></div>
        </dl>
      </section>

      <section className="brand-payment-detail-card">
        <div className="brand-payment-card-heading">
          <div><h2>Payment breakdown</h2></div>
          <button className="secondary-btn compact-btn" type="button" onClick={() => navigate(`/orders/${order.id}`)}>View order</button>
        </div>
        <dl className="brand-payment-breakdown">
          <div><dt>Step amount</dt><dd data-testid="pay-amount">{content.milestone}</dd></div>
          <div><dt>TSC service fee</dt><dd>{content.fee}</dd></div>
          <div className="total"><dt>Total charged</dt><dd data-testid="pay-total">{content.total}</dd></div>
        </dl>
      </section>
    </main>
  );
}
