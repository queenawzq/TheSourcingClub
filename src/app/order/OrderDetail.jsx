/**
 * One production order.
 *
 * Every figure in the header comes from production_order_summary, which sums
 * the milestone and payment rows in SQL. The prototype's header is four string
 * literals sitting above a timeline that adds up to something else entirely —
 * $5,780 over $3,432 of visible steps — and the fix is not better literals, it
 * is not having any.
 *
 * The tab lives in the path. A refresh on Contract details has to come back to
 * Contract details; the RFQ composer already paid for that lesson.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  acceptCancellation, agreeSchedule, getOrder, milestoneStatusLabel, orderStatusLabel,
  paymentStatusLabel, proposeCancellation, statusTone,
} from "../../lib/domain/order.js";
import { listMilestones, milestoneAction } from "../../lib/domain/milestone.js";
import { listDocuments, urlFor } from "../../lib/domain/documents.js";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import ApproveMilestone from "./ApproveMilestone.jsx";
import "./order.css";

const TABS = [
  ["", "Overview"],
  ["files", "Files"],
  ["contract", "Contract details"],
];

function Metric({ label, value, highlight, testId }) {
  return (
    <div className={`order-metric${highlight ? " highlight" : ""}`}>
      <strong data-testid={testId}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function OrderDetail({ org, orderId, isFactory, isOwner, tab = "" }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(null);

  const load = useCallback(async () => {
    const order = await getOrder(orderId);
    if (!order) throw new Error("this order is not available to you");
    const [milestones, documents] = await Promise.all([
      listMilestones(orderId),
      listDocuments(order.brand_org_id).catch(() => []),
    ]);
    // Only asked for on the factory's own side: a payment is waiting and there
    // is nowhere for it to go.
    let needsPayoutDetails = false;
    if (isFactory) {
      const owed = milestones.some((m) => ["due", "sent"].includes(m.payment?.state));
      if (owed) {
        const { count } = await supabase
          .from("factory_payout_accounts")
          .select("id", { count: "exact", head: true })
          .eq("org_id", order.factory_org_id);
        needsPayoutDetails = !count;
      }
    }

    setState({ order, milestones, documents, needsPayoutDetails });
  }, [orderId, isFactory]);

  useEffect(() => {
    load().catch(setError);
  }, [load]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate("/orders")}>← Back</button>
        <h1>Not available</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!state) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  const { order, milestones, documents } = state;
  const mineAgreed = isFactory ? order.schedule_factory_agreed_at : order.schedule_brand_agreed_at;
  const theirsAgreed = isFactory ? order.schedule_brand_agreed_at : order.schedule_factory_agreed_at;
  const counterparty = isFactory ? order.brand?.name : order.factory?.name;

  return (
    <div className="rfq-page rfq-detail">
      <button type="button" className="quiet-btn" onClick={() => navigate("/orders")}>
        ← Back to production orders
      </button>

      <header className="rfq-page-head">
        <div>
          <span className={`project-status ${statusTone(order, { isFactory })}`}>
            {orderStatusLabel(order, { isFactory })}
          </span>
          <h1>{order.rfqs?.title ?? "Production order"}</h1>
          <p>{order.order_number} · {counterparty}</p>
        </div>
      </header>

      <div className="order-metrics">
        <Metric label="order total" testId="order-total"
                value={formatMoney(order.total_cents, order.currency)} />
        <Metric label="paid" testId="order-paid"
                value={formatMoney(order.paid_cents, order.currency)} />
        <Metric label="outstanding" testId="order-outstanding"
                value={formatMoney(order.outstanding_cents, order.currency)} />
        <Metric label="next payment" highlight
                value={order.next_payment_cents
                  ? formatMoney(order.next_payment_cents, order.currency)
                  : "—"} />
      </div>

      {error ? <p className="ob-error">{error.message}</p> : null}

      {order.status === "pending_schedule" ? (
        <section className="detail-card order-agree">
          <h2>Agree the schedule to begin</h2>
          <p className="ob-hint">
            We drafted these steps from the accepted quote. Either side can change them, and any
            change withdraws both agreements — so what starts is what you both last read.
          </p>
          <p className="ob-hint">
            {mineAgreed
              ? theirsAgreed ? "Both sides have agreed." : `Waiting on ${counterparty}.`
              : theirsAgreed ? `${counterparty} has agreed. Your turn.` : "Neither side has agreed yet."}
          </p>
          <div className="order-actions">
            <button type="button" className="secondary-btn"
                    onClick={() => navigate(`/orders/${order.id}/schedule`)}>
              Review and edit the steps
            </button>
            <button
              type="button"
              className="primary-btn"
              data-testid="agree-schedule"
              disabled={busy || Boolean(mineAgreed)}
              onClick={() => run(() => agreeSchedule(order.id, order.schedule_revision))}
            >
              {mineAgreed ? "You have agreed" : "Agree to this schedule"}
            </button>
          </div>
        </section>
      ) : null}

      {isFactory && state.needsPayoutDetails ? (
        <section className="detail-card order-agree">
          <h2>Tell us where to send your money</h2>
          <p className="ob-hint">
            There is a payment due on this order and no account for it to go to. The brand cannot
            pay you until you add one.
          </p>
          <button type="button" className="primary-btn" style={{ alignSelf: "flex-start" }}
                  data-testid="add-payout" onClick={() => navigate("/payout")}>
            Add your payment details
          </button>
        </section>
      ) : null}

      {order.cancel_proposed_at && order.status !== "cancelled" ? (
        <section className="detail-card order-cancel-notice">
          <h2>Cancellation proposed</h2>
          <p className="detail-body">{order.cancel_reason}</p>
          {order.cancel_proposed_by_org !== org.id ? (
            <button type="button" className="secondary-btn" disabled={busy}
                    onClick={() => run(() => acceptCancellation(order.id))}>
              Accept and close this order
            </button>
          ) : (
            <p className="ob-hint">Waiting for {counterparty} to accept.</p>
          )}
        </section>
      ) : null}

      <nav className="rfqs-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key || "overview"}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "is-active" : ""}
            onClick={() => navigate(`/orders/${order.id}${key ? `/${key}` : ""}`)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "" ? (
        <section className="detail-card">
          <h2>Production timeline</h2>
          <ol className="milestone-list">
            {milestones.map((milestone, index) => {
              const payment = milestone.payment ?? null;
              const action = milestoneAction(milestone, { isFactory, isOwner, order });
              return (
                <li key={milestone.id} className={`milestone-item state-${milestone.state}`}
                    data-testid="milestone-row">
                  <span className="milestone-number">{index + 1}</span>
                  <div className="milestone-body">
                    <h3>{milestone.title}</h3>
                    <p className="milestone-meta">
                      {milestoneStatusLabel(milestone.state, { isFactory })}
                      {milestone.due_on ? ` · due ${new Date(milestone.due_on).toLocaleDateString()}` : ""}
                      {payment ? ` · ${paymentStatusLabel(payment.state, { isFactory })}` : ""}
                    </p>
                    {milestone.description ? (
                      <p className="milestone-description">{milestone.description}</p>
                    ) : null}
                    {action.reason ? (
                      <p className="milestone-gate" data-testid="milestone-gate">{action.reason}</p>
                    ) : null}
                  </div>

                  {milestone.amount_cents ? (
                    <strong className="milestone-amount">
                      {formatMoney(milestone.amount_cents, milestone.currency)}
                    </strong>
                  ) : null}

                  <span className="milestone-actions">
                    <button type="button" className="quiet-btn"
                            onClick={() => navigate(`/orders/${order.id}/milestones/${milestone.id}`)}>
                      Open
                    </button>
                    {action.label ? (
                      <button
                        type="button"
                        className={action.kind === "approve" || action.kind === "pay" ? "primary-btn" : "secondary-btn"}
                        data-testid="milestone-action"
                        disabled={action.disabled || busy}
                        title={action.disabled ? action.reason ?? undefined : undefined}
                        onClick={() => {
                          if (action.kind === "approve") setApproving({ milestone, payment });
                          else if (action.kind === "pay") navigate(`/orders/${order.id}/payments/${payment.id}`);
                          else navigate(`/orders/${order.id}/milestones/${milestone.id}`);
                        }}
                      >
                        {action.label}
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {tab === "files" ? (
        <section className="detail-card">
          <h2>Files</h2>
          {documents.length === 0 ? (
            <p className="ob-hint">Nothing has been attached to this order yet.</p>
          ) : (
            <ul className="file-list">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <span className="file-name">{doc.file_name}</span>
                  <span className="file-meta">{Math.round((doc.size_bytes ?? 0) / 1024)} KB</span>
                  <button type="button" className="admin-link"
                          onClick={async () => window.open(await urlFor(doc, 300), "_blank", "noopener,noreferrer")}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "contract" ? <ContractPanel order={order} navigate={navigate} isFactory={isFactory} /> : null}

      {order.status !== "cancelled" && order.status !== "completed" && !order.cancel_proposed_at ? (
        <ProposeCancellation orderId={order.id} busy={busy} run={run} />
      ) : null}

      {approving ? (
        <ApproveMilestone
          milestone={approving.milestone}
          payment={approving.payment}
          onClose={() => setApproving(null)}
          onDone={async () => { setApproving(null); await load(); }}
        />
      ) : null}
    </div>
  );
}

/**
 * The contract, read-only.
 *
 * Every value is read from the order's own snapshot columns rather than joined
 * back to the quote, so a revision the factory makes later cannot rewrite what
 * an executed order says. The prototype's Edit button is deliberately absent —
 * there is nothing to edit, and offering it would be advertising a screen that
 * does not exist.
 */
function ContractPanel({ order, navigate, isFactory }) {
  const rows = [
    ["Unit price", formatMoney(order.unit_price_cents, order.currency)],
    ["Quantity", `${order.production_quantity.toLocaleString()} units`],
    ["Production subtotal", formatMoney(order.bulk_subtotal_cents, order.currency)],
    ["Samples", formatMoney(order.sample_subtotal_cents, order.currency)],
    ["Order total", formatMoney(order.order_total_cents, order.currency)],
    ["Bulk lead time", order.bulk_lead_time_days ? `${order.bulk_lead_time_days} days` : "—"],
    ["Payment split", `${Number(order.deposit_pct)}% deposit · ${Number(order.balance_pct)}% balance`],
    ["Capacity window", order.capacity_window_start
      ? `${new Date(order.capacity_window_start).toLocaleDateString()} – ${new Date(order.capacity_window_end).toLocaleDateString()}`
      : "—"],
  ];

  return (
    <section className="detail-card">
      <h2>Contract details</h2>
      <p className="ob-hint">
        These terms were fixed when the quote was accepted and cannot be edited. A real change —
        a different price, a different quantity — goes through a new quote, so that what was
        agreed stays readable afterwards.
      </p>

      <dl className="fact-row">
        {rows.map(([label, value]) => (
          <div className="fact" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {order.agreed_scope ? (
        <>
          <h3>Scope</h3>
          <p className="detail-body">{order.agreed_scope}</p>
        </>
      ) : null}

      <div className="order-actions">
        <button type="button" className="quiet-btn"
                onClick={() => navigate(isFactory ? `/browse/${order.rfq_id}` : `/rfqs/${order.rfq_id}`)}>
          The original request
        </button>
      </div>
    </section>
  );
}

function ProposeCancellation({ orderId, busy, run }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <div className="order-quiet-footer">
        <button type="button" className="quiet-btn" onClick={() => setOpen(true)}>
          Something has gone wrong with this order
        </button>
      </div>
    );
  }

  return (
    <section className="detail-card">
      <h2>Propose cancelling this order</h2>
      <p className="ob-hint">
        The other side has to accept before the order closes. Payments already confirmed stay on
        the record — cancelling does not unsay that money changed hands.
      </p>
      <textarea rows={3} value={reason} placeholder="What has happened?"
                onChange={(event) => setReason(event.target.value)} />
      <div className="order-actions">
        <button type="button" className="quiet-btn" onClick={() => setOpen(false)}>Never mind</button>
        <button type="button" className="secondary-btn" disabled={busy || !reason.trim()}
                onClick={() => run(() => proposeCancellation(orderId, reason))}>
          Propose cancellation
        </button>
      </div>
    </section>
  );
}
