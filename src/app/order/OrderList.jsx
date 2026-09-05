/**
 * Production orders, both sides.
 *
 * One list for a brand and a factory, because it is one row with two parties.
 * The prototype's search box, factory/date/sort filters and user-created tabs
 * are all absent: none of them filtered anything, and tab membership was never
 * modelled on the order at all. A filter panel over four rows implies a
 * hundred.
 */
import React, { useEffect, useState } from "react";
import { listOrders, orderStatusLabel, statusTone } from "../../lib/domain/order.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./order.css";

const TABS = [
  ["needs-you", "Needs you"],
  ["active", "Active"],
  ["closed", "Closed"],
];

export default function OrderList({ org, isFactory }) {
  const { navigate } = useRouter();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("needs-you");

  useEffect(() => {
    let cancelled = false;
    listOrders(org.id)
      .then((rows) => !cancelled && setOrders(rows))
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  if (error) {
    return (
      <div className="rfq-page">
        <h1>Production orders</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }

  if (!orders) {
    return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;
  }

  const needsYou = (order) => (isFactory ? order.awaiting_factory : order.awaiting_brand);
  const buckets = {
    "needs-you": orders.filter((o) => o.status !== "cancelled" && o.status !== "completed" && needsYou(o)),
    active: orders.filter((o) => o.status === "pending_schedule" || o.status === "active"),
    closed: orders.filter((o) => o.status === "completed" || o.status === "cancelled"),
  };
  const shown = buckets[tab];

  return (
    <div className="rfq-page">
      <header className="rfq-page-head">
        <div>
          <h1>Production orders</h1>
          <p>
            {isFactory
              ? "Work you have won. Post updates as you go; the brand approves each step."
              : "Work you have awarded. Approve each step, and pay as the schedule falls due."}
          </p>
        </div>
      </header>

      <nav className="rfqs-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "is-active" : ""}
            onClick={() => setTab(key)}
          >
            {label} ({buckets[key].length})
          </button>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="rfq-empty">
          <p>
            {tab === "needs-you"
              ? "Nothing is waiting on you."
              : tab === "closed"
                ? "No finished orders yet."
                : "No orders yet."}
          </p>
          {orders.length === 0 ? (
            <p style={{ marginTop: 8, fontSize: 13 }}>
              {isFactory
                ? "An order appears here when a brand accepts one of your quotes."
                : "An order appears here when you award a quote."}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rfq-list">
          {shown.map((order) => (
            <button
              key={order.id}
              type="button"
              className="rfq-card order-card"
              data-testid="order-card"
              onClick={() => navigate(`/orders/${order.id}`)}
            >
              <div>
                <span className={`project-status ${statusTone(order, { isFactory })}`}>
                  {orderStatusLabel(order, { isFactory })}
                </span>
                <h2>{order.rfqs?.title ?? "Production order"}</h2>
                <p className="rfq-card-meta">
                  {order.order_number} · {isFactory ? order.brand?.name : order.factory?.name}
                  {order.current_milestone_title ? ` · now: ${order.current_milestone_title}` : ""}
                </p>
              </div>

              <dl className="order-card-figures">
                <div>
                  <dt>Order</dt>
                  <dd data-testid="card-total">{formatMoney(order.total_cents, order.currency)}</dd>
                </div>
                <div>
                  <dt>Paid</dt>
                  <dd>{formatMoney(order.paid_cents, order.currency)}</dd>
                </div>
                <div>
                  <dt>Outstanding</dt>
                  <dd>{formatMoney(order.outstanding_cents, order.currency)}</dd>
                </div>
              </dl>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
