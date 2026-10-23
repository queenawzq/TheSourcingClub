/**
 * Asking before a call is withdrawn, cancelled or declined.
 *
 * Each one closes the call for both sides on one click and cannot be taken
 * back, so it says so first, and offers to say why: the reason is the note
 * the call functions already take, shown on the other side's card and in its
 * notification (and checked for contact details like the call's own words).
 *
 * Live only: the design draws none of these buttons. It is drawn with the
 * order screens' dialog classes, as cancelling an order is
 * (src/app/order/CancelOrderDialog.jsx), and renders into `document.body`
 * for the same reason: the messages page carries a transform.
 *
 * `mode` is "withdraw" (our invite), "cancel" (a confirmed call) or "decline"
 * (their invite). `onConfirm(reason)` throws to keep the dialog open with
 * the reason it failed.
 */
import React, { useState } from "react";
import { createPortal } from "react-dom";

const COPY = {
  withdraw: {
    eyebrow: "Withdraw invite",
    heading: (title) => `Withdraw your invite for “${title}”?`,
    body: (other) => `${other} is told the invite is withdrawn. To talk later, schedule a new call.`,
    keep: "Keep invite",
    confirm: "Withdraw invite",
    busy: "Withdrawing…",
  },
  cancel: {
    eyebrow: "Cancel call",
    heading: (title) => `Cancel “${title}”?`,
    body: (other) => `${other} is told the call is cancelled. This can't be undone: to talk later, schedule a new call.`,
    keep: "Keep call",
    confirm: "Cancel call",
    busy: "Cancelling…",
  },
  decline: {
    eyebrow: "Decline invite",
    heading: (title) => `Decline “${title}”?`,
    body: (other) => `${other} is told you declined. If another time would suit you, go back and propose another time instead.`,
    keep: "Go back",
    confirm: "Decline invite",
    busy: "Declining…",
  },
};

export default function CallChangeDialog({ mode, title, counterparty, onConfirm, onClose }) {
  const copy = COPY[mode] ?? COPY.cancel;
  const other = counterparty || "The other side";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim() || null);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return createPortal((
    <div className="approve-fund-modal-layer" role="presentation">
      <button className="approve-fund-modal-scrim" type="button" aria-label="Close" onClick={onClose} />
      <section className="approve-fund-modal" role="dialog" aria-modal="true" aria-labelledby="call-change-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header>
          <p>{copy.eyebrow}</p>
          <h2 id="call-change-title">{copy.heading(title)}</h2>
          <span>{copy.body(other)}</span>
        </header>
        <label className="approve-fund-note">
          <span>Reason (optional)</span>
          <textarea
            rows={3}
            name="call-change-reason"
            maxLength={500}
            placeholder={`${other} sees this.`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error && <p className="composer-error" role="alert">{error.message}</p>}
        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>{copy.keep}</button>
          <button className="primary-btn" type="button" disabled={busy} onClick={confirm}>
            {busy ? copy.busy : copy.confirm}
          </button>
        </footer>
      </section>
    </div>
  ), document.body);
}
