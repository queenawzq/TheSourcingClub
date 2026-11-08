/**
 * The banner at the top of an order while someone wants to cancel it, and
 * after it has been cancelled.
 *
 * Live only: neither design draws a cancellation, so this sits above the
 * designed screen's money strip rather than inside any of its panels. Flagged
 * for Queena.
 *
 * - the other side proposed it: their reason, "Keep order" and "Accept
 *   cancellation" (which asks first, in `CancelOrderDialog`);
 * - this side proposed it: that it is waiting, and "Withdraw";
 * - the order is cancelled: when, and why.
 */
import React from "react";
import { cancelProposal } from "../live-adapter.js";
import { day } from "./order-view.js";
import "./order.css";

export default function CancelNotice({ order, isFactory, counterparty, title, store }) {
  const other = counterparty || (isFactory ? "The brand" : "The factory");

  if (order.status === "cancelled") {
    return (
      <section className="order-cancel-notice" data-testid="cancel-notice" data-state="cancelled">
        <div className="order-cancel-notice-text">
          <strong>This order was cancelled{order.cancelled_at ? ` · ${day(order.cancelled_at)}` : ""}</strong>
          {order.cancel_reason && <p>{order.cancel_reason}</p>}
        </div>
      </section>
    );
  }

  const proposal = cancelProposal(order, isFactory);
  if (!proposal) return null;
  const when = proposal.at ? ` · ${day(proposal.at)}` : "";

  return (
    <section className="order-cancel-notice" data-testid="cancel-notice" data-state={proposal.mine ? "mine" : "theirs"} role="status">
      <div className="order-cancel-notice-text">
        <strong>
          {proposal.mine ? "You proposed cancelling this order" : `${other} proposed cancelling this order`}{when}
        </strong>
        <p>{proposal.reason}</p>
        <span>
          {proposal.mine
            ? `Waiting for ${other} to accept or keep the order. Until then it carries on.`
            : "Nothing changes unless you accept. Keeping the order tells them it carries on."}
        </span>
        {store.error && <p className="composer-error" role="alert">{store.error.message}</p>}
      </div>
      <div className="order-cancel-notice-actions">
        {proposal.mine ? (
          <button className="secondary-btn" type="button" disabled={store.busy} onClick={() => store.withdraw(order.id)}>
            Withdraw
          </button>
        ) : (
          <>
            <button className="secondary-btn" type="button" disabled={store.busy} onClick={() => store.decline(order.id)}>
              Keep order
            </button>
            <button
              className="primary-btn"
              type="button"
              disabled={store.busy}
              onClick={() => store.accept({ id: order.id, title, counterparty: other, reason: proposal.reason })}
            >
              Accept cancellation
            </button>
          </>
        )}
      </div>
    </section>
  );
}
