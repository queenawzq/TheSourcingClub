import React, { useEffect, useState } from "react";
import { formatMoney } from "../../lib/money.js";
import {
  adminOrderPayments, checkStaffRefund, REFUND_REFUSALS, staffRefund, staffRefundPreview,
} from "../../lib/domain/payment-reviews.js";
import { Choice, StaffDialog, restLine } from "./PaymentReviews.jsx";

/**
 * Staff refund a brand in the app (D8): find an order by its number, then
 * Refund… one of its payments. On an approved step staff choose who pays:
 * the factory's balance (its share, capped at what is still with TSC) or TSC.
 * The server claims first, so a retry never refunds twice.
 */

const moneyIn = (cents, currency = "USD") => formatMoney(Number(cents) || 0, currency || "USD");
const typed = (cents) => (Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function centsFrom(text) {
  const value = String(text ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

const STATE_WORD = {
  released: "Approved", confirmed: "Held", processing: "Processing", due: "Due", not_due: "Not due",
  failed: "Failed", cancelled: "Cancelled", sent: "Sent",
};
/** What staff refunds made add up to; a full refund of a held step sends the payment back to the brand, and the row must still say so. */
const madeRefunds = (refunds) => (refunds ?? []).filter((refund) => refund.status === "made");
const refundedCents = (payment) => Math.max(Number(payment.refunded_cents) || 0,
  madeRefunds(payment.staff_refunds).reduce((sum, refund) => sum + (Number(refund.amount_cents) || 0), 0));
function statusWord(payment) {
  if (payment.refund_refusal === "staff_refund_disputed") return "Disputed";
  if (["due", "failed"].includes(payment.state) && madeRefunds(payment.staff_refunds).length) return "Refunded";
  if (payment.approved_step) return "Approved";
  return STATE_WORD[payment.state] ?? payment.state;
}
// Shorter than the dialog's sentences: they sit beside a disabled button.
const ROW_REFUSAL = { ...REFUND_REFUSALS, staff_refund_processing: "Still processing." };
/** A staff refund's own flag ("Refund succeeded after a failure"), once per payment. */
const refundFlags = (refunds) => [...new Set((refunds ?? []).map((refund) => refund.flag).filter(Boolean))];
/** One line per staff refund: "Refunded $50.00 · factory $20.00 · TSC $30.00 · <note>". */
function refundLine(refund, currency) {
  const amount = moneyIn(refund.amount_cents, currency);
  // The failure's first sentence only: the row is narrow, and the rest is on Review needed.
  // Closed by staff (the brand was refunded another way): "Refund failed · closed · <name> · <note>".
  if (refund.status === "failed" && refund.closed_at) return ["Refund failed", "closed", refund.closed_by_name, refund.close_note].filter(Boolean).join(" · ");
  if (refund.status === "failed") return ["Refund failed", amount, String(refund.failure ?? "").split(/(?<=\.)\s/)[0]].filter(Boolean).join(" · ");
  if (refund.status === "claimed") return `Refund pending · ${amount}`;
  const parts = [`Refunded ${amount}`];
  if (refund.payer === "factory" || Number(refund.factory_cents) > 0) {
    parts.push(`factory ${moneyIn(refund.factory_cents, currency)}`, `TSC ${moneyIn(refund.tsc_cents, currency)}`);
  } else if (refund.payer === "tsc") {
    parts.push(`TSC ${moneyIn(refund.tsc_cents ?? refund.amount_cents, currency)}`);
  }
  if (refund.note) parts.push(refund.note);
  return parts.join(" · ");
}
function RefundLines({ refunds, currency }) {
  return (refunds ?? []).map((refund, index) => (
    <span key={refund.id ?? index} className="admin-sub payment-refund-line" data-testid="staff-refund-line">{refundLine(refund, currency)}</span>
  ));
}
/** What was charged: on a payment a full refund sent back to Due, the refunded charge. */
const chargedCents = (payment) => Number(payment.charged_cents) || 0;
const charged = (payment) => (!["due", "not_due"].includes(payment.state) || refundedCents(payment) > 0) && chargedCents(payment) > 0;

/** The factory's share of a refund, as the database computes it, capped at what it can give back. */
function factoryShare(preview, amount) {
  const chargedCents = Number(preview.charged_cents) || 0;
  if (!chargedCents || amount == null) return 0;
  const share = Math.round((amount * Number(preview.step_cents)) / chargedCents);
  return Math.max(0, Math.min(share, Number(preview.step_cents) || 0, Number(preview.factory_cap_cents) || 0));
}

/** The rest is the service fee when the factory pays its whole proportional part of this amount, uncapped. */
function isFeeRest(preview, amount, factoryCents) {
  const charged = Number(preview?.charged_cents) || 0;
  const step = Number(preview?.step_cents) || 0;
  if (!charged || amount == null || step >= charged) return false;
  return factoryCents === Math.round((amount * step) / charged);
}

export function RefundDialog({ payment, orderNumber, currency, initialCents = null, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [loadProblem, setLoadProblem] = useState(null);
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  // What staff typed for the factory's part; null follows the most it can be.
  const [factoryText, setFactoryText] = useState(null);

  useEffect(() => {
    let live = true;
    staffRefundPreview(payment.payment_id).then((answer) => {
      if (!live) return;
      setPreview(answer);
      // Refund again… starts from the amount that failed, within what is refundable now.
      const most = Number(answer.refundable_cents) || 0;
      setAmount(typed(initialCents != null ? Math.min(Number(initialCents) || 0, most) : most));
      setPendingId(answer.pending_refund_id ?? null);
    }, (failure) => live && setLoadProblem(failure.message));
    return () => { live = false; };
  }, [payment.payment_id, initialCents]);

  const most = Number(preview?.refundable_cents) || 0;
  const cents = centsFrom(amount);
  const over = cents != null && cents > most;
  const approved = Boolean(preview?.approved_step);
  const factoryMax = Number(preview?.factory_max_cents ?? 0) || 0;
  // The most the factory can pay for this amount: its share of it, within what it can give back.
  const factoryCap = preview ? Math.min(factoryMax, factoryShare(preview, over || cents == null ? most : cents)) : 0;
  const typedFactory = factoryText == null ? factoryCap : centsFrom(factoryText);
  const factoryOver = typedFactory != null && typedFactory > factoryCap;
  const factoryCents = payer === "factory" && typedFactory != null && !factoryOver ? typedFactory : 0;
  const rest = Math.max(0, (cents ?? 0) - factoryCents);
  const factoryOk = payer !== "factory" || (typedFactory != null && !factoryOver);
  const ready = preview && !pendingId && cents != null && cents > 0 && !over && (!approved || payer) && factoryOk && reason.trim() && !preview.refund_refusal;

  async function send(work) {
    setWorking(true);
    setProblem(null);
    try {
      const result = await work();
      onDone(result);
    } catch (failure) {
      setProblem(failure.message);
      if (failure.staffRefundId) setPendingId(failure.staffRefundId);
    } finally {
      setWorking(false);
    }
  }

  const title = preview?.step_title ?? payment.step_title;
  return (
    <StaffDialog eyebrow={`${orderNumber}${title ? ` · ${title}` : ""}`} title="Refund payment" labelId="staff-refund-title"
                 working={working} onCancel={onClose}>
      {loadProblem ? <p className="admin-error" role="alert">{loadProblem}</p> : !preview ? <p className="admin-sub">Loading…</p> : (
        <>
          <label className="factory-onboarding-field">
            <span>Amount (USD)</span>
            <input inputMode="decimal" value={amount} data-testid="refund-amount" disabled={Boolean(pendingId)} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <p className="admin-assist-meta">{`Up to ${moneyIn(most, currency)} can still be refunded.`}</p>
          {over ? <p className="admin-error" role="alert">{`You can refund up to ${moneyIn(most, currency)}.`}</p> : null}
          {approved ? (
            <fieldset className="admin-tier-picker payment-who-pays">
              <legend>Who pays for this refund?</legend>
              <Choice name="payer" value="factory" chosen={payer} onChoose={setPayer} title="Factory's balance"
                      line={`Up to ${moneyIn(factoryCap, currency)} · the factory is told`} disabled={Boolean(pendingId)} />
              <Choice name="payer" value="tsc" chosen={payer} onChoose={setPayer} title="TSC"
                      line="Nothing changes for the factory" disabled={Boolean(pendingId)} />
            </fieldset>
          ) : null}
          {approved && payer === "factory" ? (
            <>
              <label className="factory-onboarding-field">
                <span>From the factory's balance (USD)</span>
                <input inputMode="decimal" value={factoryText ?? typed(factoryCap)} disabled={Boolean(pendingId)} data-testid="refund-factory-amount"
                       onChange={(event) => setFactoryText(event.target.value)} />
              </label>
              <p className="admin-assist-meta">{`Up to ${moneyIn(factoryCap, currency)}`}</p>
              {factoryOver ? (
                <p className="admin-error" role="alert">{`You can take up to ${moneyIn(factoryCap, currency)} from the factory's balance.`}</p>
              ) : typedFactory == null ? (
                <p className="admin-error" role="alert">Enter an amount of $0.00 or more.</p>
              ) : rest > 0 && !over ? (
                <p className="payment-rest-line">{restLine(rest, currency, isFeeRest(preview, cents, factoryCents))}</p>
              ) : null}
            </>
          ) : null}
          <label className="factory-onboarding-field">
            <span>{payer === "factory" ? "Reason (shown to the brand and the factory) *" : "Reason (shown to the brand) *"}</span>
            <textarea placeholder="For example: The sample was not delivered" value={reason} maxLength={500} data-testid="refund-reason"
                      disabled={Boolean(pendingId)} onChange={(event) => setReason(event.target.value)} />
          </label>
          {pendingId && !problem ? <p className="admin-sub" role="status">Checking with Stripe…</p> : null}
          {problem ? <p className="admin-error" role="alert" data-testid="refund-refusal">{problem}</p> : null}
        </>
      )}
      <footer>
        <button className="secondary-btn" type="button" disabled={working} onClick={onClose}>Cancel</button>
        {pendingId ? (
          <button className="primary-btn" type="button" disabled={working} data-testid="refund-check-again"
                  onClick={() => send(() => checkStaffRefund(pendingId))}>Check again</button>
        ) : (
          <button className="primary-btn" type="button" disabled={working || !ready} data-testid="refund-confirm"
                  onClick={() => send(() => staffRefund({
                    paymentId: payment.payment_id, amountCents: cents, payer: approved ? payer : null, note: reason.trim(),
                    factoryCents: approved && payer === "factory" ? factoryCents : null,
                  }))}>
            {`Refund ${moneyIn(cents ?? 0, currency)}`}
          </button>
        )}
      </footer>
    </StaffDialog>
  );
}

function PaymentRow({ payment, order, onRefund }) {
  const refusal = payment.refund_refusal;
  const shown = charged(payment);
  return (
    <tr data-payment={payment.payment_id}>
      <td><strong>{payment.step_title ?? "Payment"}</strong></td>
      <td><span className="payment-cell-label">Charged </span>{shown ? moneyIn(chargedCents(payment), order.currency) : "—"}</td>
      <td>
        <span className="payment-cell-label">Refunded </span>
        {refundedCents(payment) > 0 ? moneyIn(refundedCents(payment), order.currency) : "—"}
        <RefundLines refunds={payment.staff_refunds} currency={order.currency} />
        {refundFlags(payment.staff_refunds).map((flag) => <span key={flag} className="admin-sub" data-testid="staff-refund-flag">{flag}</span>)}
      </td>
      <td><span className="payment-review-status">{statusWord(payment)}</span></td>
      <td className="admin-actions">
        {refusal === "staff_refund_not_charged" || !shown ? null : (
          <>
            {refusal ? <span className="admin-sub admin-row-message">{ROW_REFUSAL[refusal] ?? REFUND_REFUSALS.staff_refund_over}</span> : null}
            <button type="button" className="admin-reject" disabled={Boolean(refusal)} data-testid="staff-refund" onClick={() => onRefund(payment)}>Refund…</button>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * Refund… on a row of the Held tab: the same dialog. A held step isn't the
 * factory's money yet, so the dialog asks no "who pays" (approved_step is false).
 */
export function HeldRefund({ row, info, onRefunded }) {
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState(null);
  if (!info) return null;
  const refusal = info.refund_refusal;
  if (refusal === "staff_refund_not_charged") return null;
  const payment = { payment_id: row.payment_id, step_title: row.milestone_title };
  return (
    <>
      {heard ? <span className="admin-sub admin-row-message" role="status" data-testid="refund-done">{heard}</span> : null}
      {(info.staff_refunds ?? []).map((refund, index) => (
        <span key={refund.id ?? index} className="admin-sub admin-row-message" data-testid="staff-refund-line">{refundLine(refund, row.currency)}</span>
      ))}
      {refundFlags(info.staff_refunds).map((flag) => <span key={flag} className="admin-sub admin-row-message" data-testid="staff-refund-flag">{flag}</span>)}
      {refusal ? <span className="admin-sub admin-row-message">{ROW_REFUSAL[refusal] ?? REFUND_REFUSALS.staff_refund_over}</span> : null}
      <button type="button" className="admin-reject" disabled={Boolean(refusal)} data-testid="staff-refund" onClick={() => setOpen(true)}>Refund…</button>
      {open ? (
        <RefundDialog payment={payment} orderNumber={row.order_number} currency={row.currency ?? "USD"} onClose={() => setOpen(false)}
                      onDone={(result) => {
                        setOpen(false);
                        setHeard(result?.status === "pending" ? "Refund pending." : `Refunded ${moneyIn(result?.amountCents, row.currency)}.`);
                        onRefunded?.();
                      }} />
      ) : null}
    </>
  );
}

/** The search box above the tabs. `query` is what was searched; empty = the tabs show. Searches as you type (T2 A11). */
export function OrderSearchBar({ query, onSearch, onClear }) {
  const [text, setText] = useState(query ?? "");
  useEffect(() => { setText(query ?? ""); }, [query]);
  // Typing pauses for half a second, then searches; an emptied box shows the tabs again.
  useEffect(() => {
    const wanted = text.trim();
    if (wanted === (query ?? "")) return undefined;
    const timer = setTimeout(() => (wanted ? onSearch(wanted) : onClear()), 500);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="admin-filter-bar payments-order-search-bar" role="search" onSubmit={(event) => { event.preventDefault(); if (text.trim()) onSearch(text.trim()); }}>
      <label className="admin-search">
        <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.75" cy="8.75" r="5.25" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path d="M12.6 12.6L16.25 16.25" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <span className="admin-visually-hidden">Search by order number</span>
        <input placeholder="Search by order number" value={text} data-testid="order-search" onChange={(event) => setText(event.target.value)} />
      </label>
      <button className="secondary-btn payments-search-submit" type="submit" disabled={!text.trim()}>Search</button>
      {query ? <button className="quiet-btn payments-search-clear" type="button" onClick={() => { setText(""); onClear(); }}>Clear</button> : null}
    </form>
  );
}

/** One order's payments, found by its number. */
export function OrderSearchSection({ query }) {
  const [state, setState] = useState({ loading: true, order: null, error: null });
  const [refunding, setRefunding] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = React.useCallback(() => adminOrderPayments(query).then(
    (order) => setState({ loading: false, order, error: null }),
    (error) => setState({ loading: false, order: null, error }),
  ), [query]);
  useEffect(() => { setState({ loading: true, order: null, error: null }); setNotice(null); load(); }, [load]);

  const { order } = state;
  const currency = order?.currency ?? "USD";
  return (
    <section className="payments-queue" data-section="order-search">
      {state.loading ? <p className="admin-sub">Loading…</p> : state.error ? <p className="admin-error">{state.error.message}</p> : !order ? (
        <div className="payments-empty"><strong>No order found</strong><p className="admin-sub">{`No order matches ${query}.`}</p></div>
      ) : (
        <>
          <h2>{`${order.order_number} (${order.payments.length})`}</h2>
          <p className="admin-sub admin-section-caption">{`${order.brand_name} → ${order.factory_name}`}</p>
          {notice ? <p className="admin-sub" role="status" data-testid="refund-done">{notice}</p> : null}
          <div className="admin-scroll">
            <table className="payment-reviews-table">
              <thead>
                <tr>
                  <th>Step</th><th>Charged</th><th>Refunded</th><th>Status</th>
                  <th className="payments-action-heading"><span className="admin-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {order.payments.map((payment) => <PaymentRow key={payment.payment_id} payment={payment} order={order} onRefund={setRefunding} />)}
              </tbody>
            </table>
          </div>
        </>
      )}
      {refunding ? (
        <RefundDialog payment={refunding} orderNumber={order.order_number} currency={currency} onClose={() => setRefunding(null)}
                      onDone={(result) => {
                        setRefunding(null);
                        setNotice(result?.status === "pending" ? "Refund pending." : `Refunded ${moneyIn(result?.amountCents, currency)}.`);
                        load();
                      }} />
      ) : null}
    </section>
  );
}
