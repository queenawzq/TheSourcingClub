/**
 * Asking before a vendor changes a quote the brand has already seen.
 *
 * Both actions have a cost that is easy to miss on one click: editing takes
 * the quote out of the brand's comparison until it is sent again, for another
 * charge; withdrawing takes it out for good. So each one says so first — in
 * the design's own modal, as cancelling a request does, not a browser dialog.
 */
import React, { useState } from "react";
import { createPortal } from "react-dom";

export default function QuoteActionDialog({ title, body, confirmLabel, busyLabel, keepLabel = "Keep my quote", testId, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="brand-profile-modal-layer" data-testid={testId}>
      <button className="brand-profile-modal-scrim" type="button" aria-label={keepLabel} onClick={onClose} />
      <section className="brand-profile-modal" role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`}>
        <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        <header className="brand-profile-modal-header">
          <h1 id={`${testId}-title`}>{title}</h1>
          <p>{body}</p>
        </header>
        {error && <p className="composer-error" role="alert">{error.message}</p>}
        <footer className="brand-profile-modal-actions">
          <button className="secondary-btn" type="button" onClick={onClose}>{keepLabel}</button>
          <button className="primary-btn" type="button" onClick={confirm} disabled={busy} data-testid={`${testId}-confirm`}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** The revise dialog's words, shared by the read-back and the sent page. */
export function reviseCopy(brand, cost) {
  return {
    title: "Edit your sent quote?",
    body: `Editing reopens your quote as a draft. ${brand || "The brand"} won't see it until you send it again, and sending it again costs ${cost ?? 25} credits.`,
    confirmLabel: "Edit quote",
    busyLabel: "Reopening…",
  };
}
