import React, { useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney } from "../../lib/money.js";
import { payFactory, refundBrand, unpauseBrand } from "../../lib/domain/payment-reviews.js";
import { stripeDashboardUrl } from "../../lib/domain/stripe.js";

/**
 * Payment reviews (20261124100000): a refund or dispute paused a factory's
 * withdrawals (and, on a dispute, the brand) until staff decide. Staff cannot
 * be notified, so this list, counted on the overview, is the only prompt.
 * A thin layer over payment_review_board(), decide_payment_review() and
 * unpause_brand(): the database checks everything again, the cap included.
 * No design draws it yet; it uses the board's own table, row actions and the
 * admin's small confirm dialog.
 *
 * Open reviews (a decision, or a brand to unpause) are the list and its
 * count; decided ones are under a closed "Decided" fold (20261124100100).
 */

const moneyIn = (cents, currency = "USD") => formatMoney(Number(cents) || 0, currency || "USD");
const WITHDRAWN_BY = { stripe: "Stripe", paypal: "PayPal", wise: "Wise", bank: "bank transfer", tazapay: "bank transfer" };
const withdrawnBy = (roads) => [...new Set((roads ?? []).map((road) => WITHDRAWN_BY[road] ?? road))].join(" and ") || "bank transfer";
const day = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null);
const disputeOpen = (row) => row.cause === "dispute" && !["won", "warning_closed", "lost"].includes(row.dispute_status);

/** Stripe's dispute status, in staff's words. */
function disputeWords(row) {
  const status = row.dispute_status;
  if (status === "won" || status === "warning_closed") return "Dispute won";
  if (status === "lost") return "Dispute lost";
  const due = day(row.dispute_due_by);
  if (status === "under_review" || status === "warning_under_review") return "Dispute open · waiting for the bank's decision";
  return `Dispute open · waiting for the bank's decision${due ? ` · respond in Stripe by ${due}, or the bank decides for the brand` : ""}`;
}

/** A refund after approval: how much of the charge went back. */
function refundWords(row) {
  const amount = Number(row.amount_cents) || 0;
  const charged = Number(row.charged_cents) || 0;
  return charged > 0 && amount < charged
    ? `Partly refunded in Stripe after approval: ${moneyIn(amount, row.currency)} of ${moneyIn(charged, row.currency)}`
    : `Refunded in full in Stripe after approval: ${moneyIn(amount, row.currency)}`;
}

/** Dollars typed ("900", "900.50") to cents; null when not a positive amount. */
function centsFrom(text) {
  const value = String(text ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return cents > 0 ? cents : null;
}

/** The admin's small confirm dialog: one line per side, then Cancel or the action. */
function ConfirmReview({ title, lines, action, working, onConfirm, onCancel }) {
  return createPortal(
    <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !working && onCancel()}>
      <section className="approve-fund-modal admin-review-modal small" role="dialog" aria-modal="true" aria-labelledby="payment-review-confirm-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" disabled={working} onClick={onCancel}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header><div><span>Payment review</span><h2 id="payment-review-confirm-title">{title}</h2></div></header>
        {lines.map((line) => <p key={line}>{line}</p>)}
        <footer>
          <button className="secondary-btn" type="button" disabled={working} onClick={onCancel}>Cancel</button>
          <button className="primary-btn" type="button" disabled={working} data-testid="review-confirm" onClick={onConfirm}>{action}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ReviewActions({ row, onChanged }) {
  const [step, setStep] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);
  const [heard, setHeard] = useState(null);
  const stepName = row.milestone_title ? `"${row.milestone_title}"` : "This step";

  async function run(work, done) {
    setWorking(true);
    setProblem(null);
    try {
      await work();
      setHeard(done);
      setStep(null);
    } catch (failure) {
      setProblem(failure.message);
      setStep((current) => (current === "refund" ? current : null));
    } finally {
      setWorking(false);
      onChanged?.();
    }
  }

  const said = <>
    {problem ? <span className="admin-error admin-row-message" role="alert" data-testid="review-refusal">{problem}</span> : null}
    {heard ? <span className="admin-sub admin-row-message" role="status">{heard}</span> : null}
  </>;

  if (step === "refund") {
    const cents = centsFrom(amount);
    // Never more than the factory's part of what the brand got back, nor its balance now.
    const most = Math.min(Number(row.factory_part_cents) || 0, Number(row.returnable_cents) || 0);
    const over = cents != null && cents > most;
    return (
      <div className="admin-actions">
        {said}
        <span className="admin-sub admin-row-message">The brand already has this money back. This only lowers the factory's balance.</span>
        <label className="admin-sub">Amount to take from the factory's balance (USD)
          <input inputMode="decimal" value={amount} data-testid="review-refund-amount"
                 onChange={(event) => setAmount(event.target.value)} />
        </label>
        <span className={over ? "admin-error admin-row-message" : "admin-sub admin-row-message"}>
          {Number(row.factory_part_cents) <= Number(row.returnable_cents)
            ? `Up to ${moneyIn(most)} (the factory's part of what the brand got back).`
            : `Up to ${moneyIn(most)} (the factory's balance now).`}
        </span>
        <label className="admin-sub">Note for the factory (required)
          <input value={note} maxLength={300} data-testid="review-refund-note" onChange={(event) => setNote(event.target.value)} />
        </label>
        <button type="button" className="admin-reject" data-testid="review-refund-confirm"
                disabled={working || cents == null || over || note.trim().length < 3}
                onClick={() => run(() => refundBrand(row.id, cents, note.trim()), `${moneyIn(cents)} taken from the factory's balance.`)}>
          {cents != null ? `Take ${moneyIn(cents)} from balance` : "Take from balance"}
        </button>
        <button type="button" className="admin-reject" disabled={working} onClick={() => { setStep(null); setProblem(null); }}>Cancel</button>
      </div>
    );
  }

  // What each choice does, for each side, said once before it is done.
  const payLines = [
    `${row.factory_name} can withdraw again. Nothing is taken from its balance.`,
    ...(row.step_on_hold || disputeOpen(row) ? [`${stepName} stays on hold until the bank decides. If it decides for the brand, we bear the loss.`] : []),
    ...(row.brand_paused ? [`${row.brand_name} stays paused until you unpause it.`] : []),
  ];
  const unpauseLines = [
    `${row.brand_name} can post requests, fund steps, accept quotes, approve steps and cancel orders again.`,
    ...(row.factory_paused ? [`${row.factory_name}'s withdrawals stay paused until you decide.`] : []),
  ];

  return (
    <div className="admin-actions">
      {said}
      {row.factory_paused ? (
        <>
          {/* Refund brand only once the brand has its money back: a refund, or a dispute the bank decided for it. */}
          <button type="button" className="admin-approve" disabled={working} data-testid="review-pay-factory"
                  title="The factory can withdraw again. Nothing is taken from its balance."
                  onClick={() => { setProblem(null); setStep("pay"); }}>Pay factory</button>
          {row.cause === "dispute" && row.dispute_status !== "lost" ? null : (
          <button type="button" className="admin-reject" disabled={working || !row.approved || !(Number(row.returnable_cents) > 0)} data-testid="review-refund-brand"
                  title={!row.approved ? "This step isn't approved, so its money isn't in the factory's balance."
                    : Number(row.returnable_cents) > 0 ? undefined : "Nothing left in the factory's balance to refund."}
                  onClick={() => {
                    setAmount((Math.min(Number(row.factory_part_cents) || 0, Number(row.returnable_cents) || 0) / 100).toFixed(2));
                    setNote("");
                    setProblem(null);
                    setStep("refund");
                  }}>Refund brand…</button>
          )}
        </>
      ) : null}
      {row.brand_paused ? (
        <button type="button" className="admin-approve" disabled={working} data-testid="review-unpause-brand"
                title="The brand can post requests, fund steps, accept quotes, approve steps and cancel orders again."
                onClick={() => { setProblem(null); setStep("unpause"); }}>Unpause brand</button>
      ) : null}
      {row.factory_paused ? (
        <span className="admin-sub admin-row-message">
          {disputeOpen(row)
            ? "Pay factory: its withdrawals start again and nothing is taken. This step stays on hold until the bank decides; if it decides for the brand, we bear the loss."
            : "Pay factory: its withdrawals start again and nothing is taken."}
        </span>
      ) : null}
      {step === "pay" ? (
        <ConfirmReview title="Pay factory?" lines={payLines} action="Pay factory" working={working}
                       onCancel={() => setStep(null)}
                       onConfirm={() => run(() => payFactory(row.id), "Factory unpaused. Nothing was taken.")} />
      ) : null}
      {step === "unpause" ? (
        <ConfirmReview title="Unpause brand?" lines={unpauseLines} action="Unpause brand" working={working}
                       onCancel={() => setStep(null)}
                       onConfirm={() => run(() => unpauseBrand(row.id), "Brand unpaused.")} />
      ) : null}
    </div>
  );
}

function decisionWords(row) {
  if (row.decision === "refund_brand") return `${moneyIn(row.returned_cents)} taken from the factory's balance (brand already refunded).`;
  if (row.decision === "brand_unpaused") return "Brand unpaused.";
  return "Factory keeps the money. Nothing was taken.";
}

function ReviewRow({ row, onChanged }) {
  return (
    <tr data-testid="payment-review" data-review={row.id}>
      <td>
        <strong>{row.brand_name}</strong> → <strong>{row.factory_name}</strong>
        <span className="admin-sub">{row.order_number}{row.milestone_title ? ` · ${row.milestone_title}` : ""}</span>
        <span className="admin-sub">Opened {day(row.created_at)}</span>
      </td>
      <td>
        <strong>{moneyIn(row.amount_cents, row.currency)}</strong>
        <span className="admin-sub">{`Factory's part ${moneyIn(row.factory_part_cents)}`}</span>
      </td>
      <td>
        <span>{row.cause === "dispute" ? disputeWords(row) : refundWords(row)}</span>
        {row.refund_failed_at ? (
          <span className="admin-error" data-testid="review-refund-failed">
            {`Refund failed in Stripe on ${day(row.refund_failed_at)}: ${moneyIn(row.refund_failed_cents)} given back to the factory's balance.`}
          </span>
        ) : null}
        <span className="admin-sub">
          {row.factory_still_paused ? `Factory's withdrawals paused · its balance now ${moneyIn(row.returnable_cents)}` : "Factory's withdrawals not paused"}
          {row.step_on_hold ? " · this step on hold until the bank decides" : ""}
          {Number(row.in_withdrawal_cents) > 0 ? ` · ${moneyIn(row.in_withdrawal_cents)} of this step in a waiting withdrawal` : ""}
        </span>
        {Number(row.withdrawn_cents) > 0 ? (
          <span className="admin-sub">{`Already withdrawn from this step: ${moneyIn(row.withdrawn_cents)} (${withdrawnBy(row.withdrawn_by)}). It can't be taken back.`}</span>
        ) : null}
        {!row.approved ? (
          <span className="admin-sub">
            {row.pauses_factory === false
              ? "Not approved yet: this money isn't in the factory's balance, so the factory isn't paused for it."
              : "Not approved yet: this step's money isn't in the factory's balance."}
          </span>
        ) : null}
        {row.factory_paused && disputeOpen(row) ? (
          <span className="admin-sub">Refund brand is available once the bank decides for the brand. This step stays on hold until then.</span>
        ) : null}
        {Number(row.dispute_fee_cents) > 0 ? <span className="admin-sub">{`Stripe's dispute fee ${moneyIn(row.dispute_fee_cents)}, paid by us`}</span> : null}
        <span className="admin-sub">
          {row.cause !== "dispute" ? "Brand not paused" : row.brand_paused ? "Brand paused: it can only message vendors" : `Brand unpaused${row.brand_unpaused_by_name ? ` by ${row.brand_unpaused_by_name}` : ""}`}
        </span>
        {row.stripe_payment_intent_id ? (
          <a className="admin-sub" href={stripeDashboardUrl("payments", row.stripe_payment_intent_id)} target="_blank" rel="noreferrer">Open in Stripe</a>
        ) : null}
      </td>
      <td>
        {row.decision ? (
          <span className="admin-sub" data-testid="review-decision">
            {decisionWords(row)}
            {row.decided_by_name ? ` ${row.decided_by_name}, ${day(row.decided_at)}.` : ` ${day(row.decided_at)}.`}
            {row.note ? ` Note: ${row.note}` : ""}
          </span>
        ) : null}
        {row.open ? <ReviewActions row={row} onChanged={onChanged} /> : null}
      </td>
    </tr>
  );
}

function ReviewTable({ rows, onChanged }) {
  return (
    <div className="admin-scroll">
      <table className="payment-reviews-table">
        <thead><tr><th>Brand → factory</th><th>Amount</th><th>What happened</th><th>Decision</th></tr></thead>
        <tbody>{rows.map((row) => <ReviewRow key={row.id} row={row} onChanged={onChanged} />)}</tbody>
      </table>
    </div>
  );
}

export function PaymentReviewsSection({ reviews, error = null, onChanged }) {
  const open = (reviews ?? []).filter((row) => row.open);
  const done = (reviews ?? []).filter((row) => !row.open);
  return (
    <section className="payments-queue" data-section="payment-reviews">
      <h2>Payment reviews ({open.length})</h2>
      {error ? <p className="admin-error">{error.message}</p> : null}
      {error ? null : open.length === 0 ? (
        <div className="payments-empty"><strong>All clear</strong><p className="admin-sub">No payment is under review.</p></div>
      ) : <ReviewTable rows={open} onChanged={onChanged} />}
      {!error && done.length > 0 ? (
        <details className="admin-views-fold" data-testid="payment-reviews-decided">
          <summary>Decided ({done.length})</summary>
          <ReviewTable rows={done} onChanged={onChanged} />
        </details>
      ) : null}
    </section>
  );
}
