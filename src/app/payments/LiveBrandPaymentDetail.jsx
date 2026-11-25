import { plainCardReason } from "../../shared/card-words.mjs";
import React, { useEffect, useMemo, useState } from "react";
import { getOrder } from "../../lib/domain/order.js";
import { can, permissionHint } from "../../lib/domain/org.js";
import { chargedCents, feeCents, getPayment, processingFeeCents } from "../../lib/domain/payment.js";
import { useAuth } from "../../lib/auth.jsx";
import { dateFrom } from "../../lib/dates.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { paymentStatusWord, refundLineWords } from "./brand-payments-view.js";
import { brandPaymentRefunds, orderPause } from "../../lib/domain/payment-reviews.js";
import { paymentRefund } from "../order/payment-summary.mjs";
import { PAUSED_TITLE, PAYMENTS_PAUSED_LINE, usePaymentPause } from "../payment-pause.jsx";
import "../order/payout.css";
import "./brand-payment-detail.css";
import { useVendorNames } from "../vendor-names.jsx";

/** The list's word, plus the states the list leaves out. */
const statusWord = (payment, order) => paymentStatusWord(payment, order)
  ?? ({ cancelled: "Cancelled", not_due: "Not due" })[payment.state]
  ?? "Payment";

const date = (value) => value
  ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";

function activityDate(payment) {
  return payment.refunded_at ?? payment.released_at ?? payment.confirmed_at ?? payment.failed_at ?? payment.processing_at
    ?? payment.sent_at ?? payment.due_at ?? payment.created_at;
}

/** Only a failure needs words: what went wrong. The status says the rest. */
function failureLine(payment) {
  if (payment.state !== "failed") return null;
  return payment.failure_reason
    ? `The payment was not completed: ${plainCardReason(payment.failure_reason)}`
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
    Promise.all([
      getOrder(orderId), getPayment(orderId, paymentId),
      // Under a chargeback (order_pause), and each refund that went back (a failed read: the payment's own word).
      orderPause(orderId).catch(() => null),
      activeOrg?.id ? brandPaymentRefunds(activeOrg.id).catch(() => []) : [],
    ]).then(
      ([order, found, hold, refunds]) => {
        if (!order || !found) throw new Error("That transaction is not available to you.");
        const lines = (refunds ?? []).filter((refund) => refund.payment_id === found.id)
          .sort((a, b) => String(a.refunded_at).localeCompare(String(b.refunded_at)));
        const disputed = (hold?.disputed_payment_ids ?? []).includes(found.id);
        const payment = lines.length || disputed ? { ...found, refunds: lines, disputed } : found;
        if (!cancelled) setState({ loading: false, order, payment, error: null });
      },
      (error) => !cancelled && setState({ loading: false, order: null, payment: null, error }),
    );
    return () => { cancelled = true; };
  }, [orderId, paymentId, activeOrg?.id]);
  // Under review: nothing can be paid now, said here and on the button.
  const paused = usePaymentPause(activeOrg?.id).brand;

  // The vendor's name in English where it has one, as on the order (vendor-names.jsx).
  const vendorNames = useVendorNames(state.order?.factory?.name ? [{ id: state.order.factory_org_id, name: state.order.factory.name }] : []);
  const factoryName = state.order?.factory?.name ? vendorNames.text(state.order.factory_org_id, state.order.factory.name) : null;
  const content = useMemo(() => {
    if (!state.payment || !state.order) return null;
    const { payment, order } = state;
    const total = chargedCents(payment);
    // Each fee as the database computed it, so the card fee is never shown
    // under the service fee's name.
    const fee = feeCents(payment);
    const processingFee = processingFeeCents(payment);
    return {
      title: payment.order_milestones?.title ?? "Payment",
      orderTitle: order.rfqs?.title ?? order.order_number,
      factory: factoryName ?? "Factory",
      status: statusWord(payment, order),
      statusKey: statusWord(payment, order).toLowerCase().replaceAll(" ", "-"),
      failure: failureLine(payment),
      // What went back to the brand, each on its own line: "Refunded $20.00 · Nov 25",
      // "Refunded $20.00 · by our team", "Reversed by your bank · $70.60".
      back: [
        ...(payment.refunds ?? []).map(refundLineWords),
        paymentRefund(payment).lost > 0 ? `Reversed by your bank · ${formatMoney(paymentRefund(payment).lost, payment.currency)}` : null,
      ].filter(Boolean),
      // A due payment is dated when it falls due, as on the list; the rest when they moved.
      date: payment.state === "due" && payment.order_milestones?.due_on
        ? dateFrom(payment.order_milestones.due_on).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : date(activityDate(payment)),
      method: methodLabel(payment),
      milestone: formatMoney(payment.amount_cents, payment.currency),
      fee: formatMoney(fee, payment.currency),
      processingFee: processingFee ? formatMoney(processingFee, payment.currency) : null,
      total: formatMoney(total, payment.currency),
    };
  }, [state, factoryName]);

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
          {content.back.map((line) => <p key={line} data-testid="payment-went-back">{line}</p>)}
          {payable && paused ? <p className="brand-payment-failure" data-testid="payment-paused">{PAYMENTS_PAUSED_LINE}</p> : null}
          {payable && !canPay ? <p data-testid="payment-owner-only">Only someone with Release funds at {activeOrg?.name || "your company"} can pay for a step. Ask an owner for this permission.</p> : null}
          {payable ? (
            <button
              className="primary-btn compact-btn brand-payment-pay-again"
              type="button"
              disabled={canPay && !paused ? undefined : true}
              title={paused ? PAUSED_TITLE : canPay ? undefined : permissionHint(activeOrg, "releaseFunds")}
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
          {content.processingFee ? <div><dt>Card processing fee</dt><dd>{content.processingFee}</dd></div> : null}
          <div className="total"><dt>Total charged</dt><dd data-testid="pay-total">{content.total}</dd></div>
        </dl>
      </section>
    </main>
  );
}
