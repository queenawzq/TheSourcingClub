/**
 * Proposing to cancel an order, or accepting the other side's proposal.
 *
 * Live only: neither design has a cancel flow. It is drawn with the order
 * screens' own dialog classes (the approve dialogs'), so it reads as one of
 * them and keeps their phone padding. Flagged for Queena.
 *
 * It renders into `document.body`: the order pages' `<main className="rfqs-page">`
 * carries a transform, which turns a fixed layer into one the height of the
 * whole page, and the dialog then opens halfway down it.
 *
 * `mode` is "propose" (a reason is required, and the other side sees it) or
 * "accept" (their reason, read back). `onConfirm(reason)` resolves true when
 * the dialog may close; a refusal stays in the dialog that caused it.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listPayments } from "../../lib/domain/payment.js";
import { cancelMoneyLines } from "./cancel-money.mjs";

/**
 * What cancelling does to the money, said before, from the order's own
 * payments (cancel-money.mjs). `payments` may be passed (the order page has
 * them); otherwise they are read here (the order lists).
 */
export default function CancelOrderDialog({ mode = "propose", orderId, title, counterparty, isFactory = false, payments: given, reason = "", busy = false, error = null, onConfirm, onClose }) {
  const [text, setText] = useState("");
  const [read, setRead] = useState(null);
  const other = counterparty || "the other side";
  const proposing = mode === "propose";
  useEffect(() => {
    if (given || !orderId) return undefined;
    let live = true;
    listPayments(orderId).then((rows) => { if (live) setRead(rows ?? []); }).catch(() => null);
    return () => { live = false; };
  }, [given, orderId]);
  const money = cancelMoneyLines(given ?? read, { isFactory, counterparty }).join(" ");

  return createPortal((
    <div className="approve-fund-modal-layer" role="presentation">
      <button className="approve-fund-modal-scrim" type="button" aria-label="Close" onClick={onClose} />
      <section className="approve-fund-modal order-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="order-cancel-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header>
          <p>{proposing ? "Cancel order" : "Accept cancellation"}</p>
          <h2 id="order-cancel-title">{proposing ? `Cancel ${title}?` : `Cancel ${title} as ${other} proposed?`}</h2>
          {proposing
            ? (money ? <span data-testid="cancel-money">{money}</span> : null)
            : <span data-testid="cancel-money">This closes the order for both sides and cannot be undone.{money ? ` ${money}` : ""}</span>}
        </header>
        {proposing ? (
          <label className="approve-fund-note">
            <span>Reason</span>
            <textarea
              rows={3}
              name="cancel-reason"
              placeholder={`${other} sees this.`}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        ) : (
          <div className="approve-fund-summary single">
            <div>
              <span>{other}'s reason</span>
              <strong>{reason || "No reason given"}</strong>
            </div>
          </div>
        )}
        {error && <p className="composer-error" role="alert">{error.message}</p>}
        <footer>
          {/* Accepting, "Keep order" would read as turning the proposal down,
              which is the banner's button; here it only closes. */}
          <button className="secondary-btn" type="button" onClick={onClose}>{proposing ? "Keep order" : "Go back"}</button>
          <button
            className="primary-btn"
            type="button"
            disabled={busy || (proposing && !text.trim())}
            onClick={() => onConfirm(proposing ? text.trim() : undefined)}
          >
            {busy
              ? (proposing ? "Sending…" : "Cancelling…")
              : (proposing ? "Propose cancellation" : "Accept cancellation")}
          </button>
        </footer>
      </section>
    </div>
  ), document.body);
}
