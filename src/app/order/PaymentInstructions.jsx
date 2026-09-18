/**
 * How to pay, and recording that you did.
 *
 * The platform is not in the money path, so this screen's whole job is to make
 * a bank transfer easy to get right: the amount, where it goes, and the
 * reference that lets an admin match it up.
 *
 * The reference is the order number stored on the row. Composing one in the
 * browser would mean the string a brand types into its bank and the string the
 * admin searches for could differ, which is the one thing that must not happen.
 */
import React, { useCallback, useEffect, useState } from "react";
import { getOrder } from "../../lib/domain/order.js";
import { feeCents, getPayment, markPaymentSent, payoutAccountFor } from "../../lib/domain/payment.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./order.css";

export default function PaymentInstructions({ orderId, paymentId }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    const [order, payment] = await Promise.all([getOrder(orderId), getPayment(orderId, paymentId)]);
    if (!order || !payment) throw new Error("that payment is not available to you");
    const account = await payoutAccountFor(order.factory_org_id).catch(() => null);
    setState({ order, payment, account });
  }, [orderId, paymentId]);

  useEffect(() => { load().catch(setError); }, [load]);

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

  const { order, payment, account } = state;
  const fee = feeCents(payment);

  return (
    <div className="rfq-page rfq-detail">
      <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>
        ← Back to the order
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>Pay {formatMoney(payment.amount_cents, payment.currency)}</h1>
          <p>{payment.order_milestones?.title} · {order.order_number} · to {order.factory?.name}</p>
        </div>
      </header>

      <section className="detail-card">
        <h2>What to send</h2>
        <dl className="fact-row">
          <div className="fact">
            <dt>Amount</dt>
            <dd data-testid="pay-amount">{formatMoney(payment.amount_cents, payment.currency)}</dd>
          </div>
          <div className="fact">
            <dt>Platform fee</dt>
            <dd data-testid="pay-fee">{formatMoney(fee, payment.currency)}</dd>
          </div>
          <div className="fact">
            <dt>Reference</dt>
            <dd data-testid="pay-reference">{order.order_number}</dd>
          </div>
        </dl>
        {fee === 0 ? (
          <p className="ob-hint">
            We do not charge a fee on this yet, and we are not in the payment path — the money
            goes straight from your bank to theirs.
          </p>
        ) : null}
      </section>

      <section className="detail-card">
        <h2>Where to send it</h2>
        {account ? (
          <dl className="fact-row">
            <div className="fact"><dt>Bank</dt><dd>{account.bank_name ?? "—"}</dd></div>
            <div className="fact"><dt>Account name</dt><dd>{account.account_name ?? "—"}</dd></div>
            <div className="fact">
              <dt>Account</dt>
              <dd>{account.account_number_last4 ? `···· ${account.account_number_last4}` : "—"}</dd>
            </div>
            <div className="fact"><dt>SWIFT</dt><dd>{account.swift ?? "—"}</dd></div>
            <div className="fact"><dt>IBAN</dt><dd>{account.iban ?? "—"}</dd></div>
          </dl>
        ) : (
          <p className="ob-hint">
            {order.factory?.name} has not given us their bank details yet. We have asked them —
            do not send anything until they appear here.
          </p>
        )}
        {account?.instructions ? <p className="detail-body">{account.instructions}</p> : null}
      </section>

      {error ? <p className="ob-error">{error.message}</p> : null}

      <section className="detail-card">
        {payment.state === "due" ? (
          <>
            <h2>Once you have sent it</h2>
            <p className="ob-hint">
              Tell us, and we will confirm it with the factory when it lands. They will not start
              this step until we do — that confirmation is what they are relying on, not your word
              or ours.
            </p>
            <label className="ob-label" htmlFor="bank-reference">Your bank's reference</label>
            <input id="bank-reference" data-field="bank_reference" type="text" value={reference}
                   placeholder="Optional — helps us match it up"
                   onChange={(event) => setReference(event.target.value)} />
            <div className="order-actions">
              <button
                type="button"
                className="primary-btn"
                data-testid="mark-sent"
                disabled={busy || !account}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await markPaymentSent(payment.id, { reference });
                    await load();
                  } catch (failure) {
                    setError(failure);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Recording…" : "I have sent this payment"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>
              {payment.state === "sent" ? "Waiting on us" : "Done"}
            </h2>
            <p className="ob-hint" data-testid="payment-state">
              {payment.state === "sent"
                ? `You marked this sent on ${new Date(payment.sent_at).toLocaleDateString()}. We are checking for it, and will tell the factory the moment it arrives.`
                : payment.state === "confirmed"
                  ? "We confirmed this arrived. The factory has been told it can start."
                  : payment.state === "released"
                    ? "Confirmed and paid on to the factory."
                    : `This payment is ${payment.state}.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
