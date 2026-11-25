import React, { useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney } from "../../lib/money.js";
import * as reviewsApi from "../../lib/domain/payment-reviews.js";
import { stripeDashboardUrl } from "../../lib/domain/stripe.js";

/**
 * Payment reviews (20261124100000, v2 20261125100000): a card dispute or a
 * refund made in Stripe after approval. The bank's verdict drives a dispute;
 * once the money is back with the brand, staff Resolve it by saying who was at
 * fault, and the money and the brand's pause follow. Staff cannot be notified,
 * so this list, counted on the overview, is the only prompt.
 *
 * Each row is a three-step bar (Bank or Refund → Resolve → Done) with one
 * line under it. The database checks everything again, the cap included.
 */

const moneyIn = (cents, currency = "USD") => formatMoney(Number(cents) || 0, currency || "USD");
// In the reader's own zone.
const day = (value) => (value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);
const isRefund = (row) => row.reason === "refunded_in_stripe";
const REASON = { card_dispute: "Card dispute", inquiry: "Inquiry", refunded_in_stripe: "Refund" };

/**
 * Who was at fault. `resolveReview` is the database's own decision (§10);
 * until it is published, the three answers go through the two older ones:
 * no fault is the factory paying nothing, which unpauses the brand.
 */
function resolve(row, fault, cents, note) {
  if (typeof reviewsApi.resolveReview === "function") return reviewsApi.resolveReview(row.id, fault, cents, note);
  if (fault === "factory_at_fault") return reviewsApi.factoryPays(row.id, cents, note);
  if (fault === "brand_at_fault") return reviewsApi.tscPays(row.id, note);
  return reviewsApi.factoryPays(row.id, 0, note);
}

/** What was decided, from the row's own decision (new names, then the older ones). */
function faultOf(row) {
  if (["factory_at_fault", "brand_at_fault", "no_fault"].includes(row.decision)) return row.decision;
  if (row.state === "factory_paid" || row.decision === "factory_pays") {
    return Number(row.returned_cents) > 0 ? "factory_at_fault" : "no_fault";
  }
  if (row.state === "tsc_paid" || row.decision === "tsc_pays") return isRefund(row) ? "no_fault" : "brand_at_fault";
  return null;
}

/** The one line under the bar. */
function lineFor(row) {
  if (row.step === 1) {
    return row.respond_by && new Date(row.respond_by) > new Date() ? `Respond in Stripe by ${day(row.respond_by)}` : "Waiting for the bank's decision";
  }
  if (row.step === 2) return isRefund(row) ? "Refunded in Stripe" : "Bank ruled for the brand";
  const who = row.decided_by_name ? ` · ${row.decided_by_name}` : "";
  const when = row.step_date ? ` · ${day(row.step_date)}` : "";
  const fault = faultOf(row);
  if (fault === "factory_at_fault") return `Factory at fault · ${moneyIn(row.returned_cents, row.currency)} from its balance${who}${when}`;
  if (fault === "brand_at_fault") return `Brand at fault · TSC absorbed ${moneyIn(row.amount_cents, row.currency)}${who}${when}`;
  if (fault === "no_fault") return `No fault · TSC absorbed ${moneyIn(row.amount_cents, row.currency)}${who}${when}`;
  if (row.state === "resumed") return `Bank ruled for TSC${when}`;
  if (row.state === "closed") return `Bank ruled for the brand · step not approved${when}`;
  if (row.state === "inquiry_closed") return `Inquiry closed${when}`;
  return `${row.step_line ?? ""}${when}`;
}

function Progress({ row }) {
  const step = Number(row.step) || 1;
  const names = [isRefund(row) ? "Refund" : "Bank", "Resolve", "Done"];
  return (
    <div className="project-progress" style={{ "--project-progress": `${(step - 1) * 50}%` }} aria-label={`Step ${step} of 3`}>
      <div className="project-progress-line" aria-hidden="true" />
      {names.map((name, index) => {
        const done = index + 1 < step || step === 3;
        return (
          <div key={name} className={`project-progress-step ${done ? "complete" : index + 1 === step ? "current" : ""}`}>
            <span>{done ? "✓" : index + 1}</span><small>{name}</small>
          </div>
        );
      })}
    </div>
  );
}

/** Dollars typed ("900", "1,240.50") to cents; null when not an amount. */
function centsFrom(text) {
  const value = String(text ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}
const typed = (cents) => (Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The design's dialog frame ("Request more information"), shared by Resolve and Refund. */
export function StaffDialog({ eyebrow, title, labelId, working, onCancel, children }) {
  return createPortal(
    <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !working && onCancel()}>
      <section className="approve-fund-modal admin-review-modal small" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <button className="settings-drawer-close" type="button" aria-label="Close" disabled={working} onClick={onCancel}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header><div>{eyebrow ? <span>{eyebrow}</span> : null}<h2 id={labelId}>{title}</h2></div></header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

/** One radio row of the tier picker. */
export function Choice({ name, value, chosen, onChoose, title, line, disabled = false }) {
  return (
    <label className={`admin-tier-option no-icon${chosen === value ? " selected" : ""}`}>
      <input type="radio" name={name} value={value} checked={chosen === value} disabled={disabled} onChange={() => onChoose(value)} />
      <span><strong>{title}</strong><small>{line}</small></span>
    </label>
  );
}

function ResolveDialog({ row, onClose, onDone }) {
  const refund = isRefund(row);
  const currency = row.currency || "USD";
  const most = Math.max(0, Number(row.factory_max_cents ?? row.approve_max_cents) || 0);
  const back = Number(row.amount_cents) || 0;
  const [fault, setFault] = useState(null);
  const [amount, setAmount] = useState(typed(most));
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);
  const cents = centsFrom(amount);
  const over = cents != null && cents > most;
  const factoryCents = cents != null && !over ? cents : most;
  const rest = Math.max(0, back - factoryCents);
  const ready = fault && note.trim() && (fault !== "factory_at_fault" || (cents != null && !over));

  async function confirm() {
    setWorking(true);
    setProblem(null);
    try {
      await resolve(row, fault, fault === "factory_at_fault" ? cents : null, note.trim());
      onDone();
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <StaffDialog eyebrow={`${row.order_number}${row.milestone_title ? ` · ${row.milestone_title}` : ""}`} title={`Resolve ${moneyIn(back, currency)}`}
                 labelId="payment-resolve-title" working={working} onCancel={onClose}>
      <p className="admin-modal-line">{refund ? "Refunded in Stripe after approval." : "The bank ruled for the brand."}</p>
      <fieldset className="admin-tier-picker payment-who-pays">
        <legend>Who was at fault?</legend>
        {refund ? (
          <>
            <Choice name="fault" value="factory_at_fault" chosen={fault} onChoose={setFault} title="Factory"
                    line={`${moneyIn(factoryCents, currency)} from the factory's balance`} />
            <Choice name="fault" value="no_fault" chosen={fault} onChoose={setFault} title="Not the factory"
                    line={`TSC absorbs ${moneyIn(back, currency)}`} />
          </>
        ) : (
          <>
            <Choice name="fault" value="factory_at_fault" chosen={fault} onChoose={setFault} title="Factory"
                    line={`${moneyIn(factoryCents, currency)} from the factory's balance · brand unpaused`} />
            <Choice name="fault" value="brand_at_fault" chosen={fault} onChoose={setFault} title="Brand"
                    line={`TSC absorbs ${moneyIn(back, currency)} · brand stays paused`} />
            <Choice name="fault" value="no_fault" chosen={fault} onChoose={setFault} title="No one"
                    line={`TSC absorbs ${moneyIn(back, currency)} · brand unpaused`} />
          </>
        )}
      </fieldset>
      {fault === "factory_at_fault" ? (
        <>
          <label className="factory-onboarding-field">
            <span>From the factory's balance (USD)</span>
            <input inputMode="decimal" value={amount} data-testid="resolve-amount" onChange={(event) => setAmount(event.target.value)} />
          </label>
          <p className="admin-assist-meta">{`Up to ${moneyIn(most, currency)}`}</p>
          {over ? (
            <p className="admin-error" role="alert">{`You can take up to ${moneyIn(most, currency)} from the factory's balance.`}</p>
          ) : cents == null ? (
            <p className="admin-error" role="alert">Enter an amount of $0.00 or more.</p>
          ) : rest > 0 ? (
            <p className="payment-rest-line">{`TSC absorbs the rest (${moneyIn(rest, currency)})`}</p>
          ) : null}
        </>
      ) : null}
      <label className="factory-onboarding-field">
        <span>{fault === "factory_at_fault" ? "Note for the factory *" : "Note *"}</span>
        <textarea placeholder="What was decided, and why" value={note} maxLength={500} data-testid="resolve-note"
                  onChange={(event) => setNote(event.target.value)} />
      </label>
      {problem ? <p className="admin-error" role="alert" data-testid="review-refusal">{problem}</p> : null}
      <footer>
        <button className="secondary-btn" type="button" disabled={working} onClick={onClose}>Cancel</button>
        <button className="primary-btn" type="button" disabled={working || !ready} data-testid="resolve-confirm" onClick={confirm}>Confirm</button>
      </footer>
    </StaffDialog>
  );
}

function ReviewRow({ row, onChanged }) {
  const [resolving, setResolving] = useState(false);
  const canResolve = (row.actions ?? []).includes("decide");
  return (
    <tr data-testid="payment-review" data-review={row.id}>
      <td>
        <strong>{row.brand_name}</strong>
        {row.brand_paused ? <span className="admin-pill admin-pill--paused" data-testid="review-brand-paused">Paused</span> : null}
        {" → "}<strong>{row.factory_name}</strong>
      </td>
      <td>{row.order_number}{row.milestone_title ? <span className="admin-sub">{row.milestone_title}</span> : null}</td>
      <td><strong>{moneyIn(row.amount_cents, row.currency)}</strong></td>
      <td>{REASON[row.reason] ?? "Card dispute"}</td>
      <td className="payment-review-progress-cell">
        <Progress row={row} />
        <p className={`payment-review-line${row.step === 3 ? " done" : ""}`} data-testid="review-line">
          {lineFor(row)}
          {row.flag ? <span className="admin-pill admin-pill--rejected" data-testid="review-refund-failed">{row.flag}</span> : null}
          {row.step === 1 && row.stripe_payment_intent_id ? (
            <a href={stripeDashboardUrl("payments", row.stripe_payment_intent_id)} target="_blank" rel="noreferrer">Open in Stripe</a>
          ) : null}
        </p>
      </td>
      <td className="admin-actions">{canResolve ? (
        <button type="button" className="admin-approve" data-testid="review-resolve" onClick={() => setResolving(true)}>Resolve…</button>
      ) : null}
        {resolving ? <ResolveDialog row={row} onClose={() => setResolving(false)} onDone={() => { setResolving(false); onChanged?.(); }} /> : null}
      </td>
    </tr>
  );
}

function ReviewTable({ rows, onChanged }) {
  return (
    <div className="admin-scroll">
      <table className="payment-reviews-table">
        <thead>
          <tr>
            <th>Brand → factory</th><th>Order</th><th>Amount</th><th>Reason</th><th>Progress</th>
            <th className="payments-action-heading"><span className="admin-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>{rows.map((row) => <ReviewRow key={row.id} row={row} onChanged={onChanged} />)}</tbody>
      </table>
    </div>
  );
}

/** Rows in progress (counted ones first, as the database orders them); Done is step 3. */
export const reviewsInProgress = (reviews) => (reviews ?? []).filter((row) => row.open || Number(row.step) < 3);

export function PaymentReviewsSection({ reviews, error = null, onChanged }) {
  const open = reviewsInProgress(reviews);
  const counted = (reviews ?? []).filter((row) => row.open).length;
  const done = (reviews ?? []).filter((row) => !row.open && Number(row.step) >= 3);
  return (
    <section className="payments-queue" data-section="payment-reviews">
      <h2>Payment reviews ({counted})</h2>
      {error ? <p className="admin-error">{error.message}</p> : null}
      {error ? null : open.length === 0 ? (
        <div className="payments-empty"><strong>All clear</strong><p className="admin-sub">No payment is under review.</p></div>
      ) : <ReviewTable rows={open} onChanged={onChanged} />}
      {!error && done.length > 0 ? (
        <details className="admin-views-fold" data-testid="payment-reviews-done">
          <summary>Done ({done.length})</summary>
          <ReviewTable rows={done} onChanged={onChanged} />
        </details>
      ) : null}
    </section>
  );
}
