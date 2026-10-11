/**
 * Approving a step.
 *
 * ONE modal, where the prototype has two. ApproveFundModal and
 * ApproveMilestoneModal are the same act with and without money, so the money
 * block simply renders when there is a payment attached.
 *
 * The note is shown to the factory. Collecting a note nobody ever reads would
 * be worse than not asking for one.
 */
import React, { useState } from "react";
import { approveMilestone } from "../../lib/domain/milestone.js";
import { feeCents } from "../../lib/domain/payment.js";
import { formatMoney } from "../../lib/money.js";

export default function ApproveMilestone({ milestone, payment, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await approveMilestone(milestone.id, note);
      await onDone();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  const fee = payment ? feeCents(payment) : 0;

  return (
    <div className="order-modal-backdrop" role="dialog" aria-modal="true">
      <div className="order-modal">
        <h2>Approve “{milestone.title}”</h2>
        <p className="ob-hint">
          {payment
            ? "Approving this makes its payment due. You will get transfer instructions next."
            : "This marks the step approved and lets the factory carry on."}
        </p>

        {payment ? (
          <dl className="fact-row">
            <div className="fact">
              <dt>Amount</dt>
              <dd>{formatMoney(payment.amount_cents, payment.currency)}</dd>
            </div>
            <div className="fact">
              <dt>Platform fee</dt>
              <dd>{formatMoney(fee, payment.currency)}</dd>
            </div>
          </dl>
        ) : null}

        <label className="ob-label" htmlFor="approval-note">Note for the factory</label>
        <textarea
          id="approval-note"
          data-field="approval_note"
          rows={3}
          value={note}
          placeholder="Optional — they will see this."
          onChange={(event) => setNote(event.target.value)}
        />

        {error ? <p className="ob-error">{error.message}</p> : null}

        <div className="order-actions">
          <button type="button" className="quiet-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="primary-btn" data-testid="confirm-approve"
                  onClick={approve} disabled={busy}>
            {busy ? "Approving…" : payment ? "Approve, and pay next" : "Approve this step"}
          </button>
        </div>
      </div>
    </div>
  );
}
