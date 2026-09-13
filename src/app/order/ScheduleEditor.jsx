/**
 * The schedule, before it is agreed.
 *
 * Same screen for both sides, and prefilled from the accepted quote — nobody
 * ever faces a blank list, which is what the prototype hands a brand that may
 * never have manufactured anything.
 *
 * The payment trigger is visible on every row. It is the difference between
 * money before work and money after it, and a row whose trigger is only
 * implied is the composer-default bug rebuilt around a bank transfer.
 */
import React, { useCallback, useEffect, useState } from "react";
import { agreeSchedule, getOrder } from "../../lib/domain/order.js";
import { KIND_LABEL, listMilestones, saveSchedule } from "../../lib/domain/milestone.js";
import { formatMoney, fromCents, toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./order.css";

const KINDS = [
  ["approval_and_payment", "The brand approves it, then pays for it"],
  ["approval_only", "The brand approves it. No money"],
  ["payment_only", "The brand pays for it. Nothing to approve"],
  ["progress_only", "Work that just takes time"],
];

const PAYS = new Set(["approval_and_payment", "payment_only"]);

export default function ScheduleEditor({ orderId, isFactory, onAgreed }) {
  const { navigate } = useRouter();
  const [order, setOrder] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [loaded, milestones] = await Promise.all([getOrder(orderId), listMilestones(orderId)]);
    if (!loaded) throw new Error("this order is not available to you");
    setOrder(loaded);
    setRows(milestones.map((m) => ({
      kind: m.kind,
      title: m.title,
      description: m.description ?? "",
      amount: fromCents(m.amount_cents),
      due_on: m.due_on ?? "",
    })));
  }, [orderId]);

  useEffect(() => { load().catch(setError); }, [load]);

  if (error && !rows) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>← Back</button>
        <h1>Not available</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!rows || !order) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  const locked = order.status !== "pending_schedule";
  const total = rows.reduce((sum, row) => sum + (PAYS.has(row.kind) ? toCents(row.amount) ?? 0 : 0), 0);
  const balances = total === order.order_total_cents;

  function update(index, patch) {
    setRows((current) => current.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };
      // A step that stops involving money must not keep an amount: the
      // database refuses it, and silently dropping it here would hide why.
      if (!PAYS.has(next.kind)) next.amount = "";
      return next;
    }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveSchedule(orderId, rows.map((row) => ({
        kind: row.kind,
        title: row.title,
        description: row.description,
        amount_cents: PAYS.has(row.kind) ? toCents(row.amount) : null,
        due_on: row.due_on,
      })));
      navigate(`/orders/${orderId}`);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <div className="rfq-page">
      <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>
        ← Back to the order
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>The production schedule</h1>
          <p>
            {order.order_number} · drafted from the accepted quote. Either side can change it.
          </p>
        </div>
      </header>

      {locked ? (
        <div className="browse-gate">
          <strong>This schedule is settled.</strong>
          <span>Both sides agreed it and the order is running, so it can no longer be edited.</span>
        </div>
      ) : (
        <>
          <p className="ob-hint">
            {order.schedule_brand_agreed_at || order.schedule_factory_agreed_at
              ? "One side has already agreed. Saving a change withdraws both agreements, so you will each need to agree again."
              : "Neither side has agreed yet."}
          </p>
          {/* Agreeing moved here from the order screen, because this is where
              the schedule is. agree_schedule takes the revision: without it a
              client that cached "I already agreed" re-stamps a side onto terms
              it never read, and the order activates showing two green ticks. */}
          <div className="order-actions">
            <button
              type="button"
              className="primary-btn"
              data-testid="agree-schedule"
              disabled={Boolean(isFactory ? order.schedule_factory_agreed_at : order.schedule_brand_agreed_at)}
              onClick={async () => {
                await agreeSchedule(order.id, order.schedule_revision);
                await load();
                onAgreed?.();
              }}
            >
              {(isFactory ? order.schedule_factory_agreed_at : order.schedule_brand_agreed_at)
                ? "You have agreed"
                : "Agree to this schedule"}
            </button>
          </div>
        </>
      )}

      <div className="schedule-rows">
        {rows.map((row, index) => (
          <div className="schedule-row" key={index} data-testid="schedule-row">
            <div className="schedule-row-main">
              <label className="ob-label" htmlFor={`title-${index}`}>Step</label>
              <input id={`title-${index}`} data-field={`step_${index}_title`} type="text"
                     value={row.title} disabled={locked}
                     onChange={(event) => update(index, { title: event.target.value })} />

              <label className="ob-label" htmlFor={`kind-${index}`}>What happens</label>
              <select id={`kind-${index}`} data-field={`step_${index}_kind`} value={row.kind}
                      disabled={locked}
                      onChange={(event) => update(index, { kind: event.target.value })}>
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="schedule-row-side">
              <label className="ob-label" htmlFor={`amount-${index}`}>Amount</label>
              <input id={`amount-${index}`} data-field={`step_${index}_amount`} type="text"
                     value={row.amount} disabled={locked || !PAYS.has(row.kind)}
                     placeholder={PAYS.has(row.kind) ? "0.00" : "no payment"}
                     onChange={(event) => update(index, { amount: event.target.value })} />

              <label className="ob-label" htmlFor={`due-${index}`}>Due</label>
              <input id={`due-${index}`} data-field={`step_${index}_due`} type="date"
                     value={row.due_on} disabled={locked}
                     onChange={(event) => update(index, { due_on: event.target.value })} />

              {locked ? null : (
                <button type="button" className="quiet-btn"
                        onClick={() => setRows((c) => c.filter((_, i) => i !== index))}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {locked ? null : (
        <button type="button" className="secondary-btn" style={{ alignSelf: "flex-start" }}
                onClick={() => setRows((c) => [...c, {
                  kind: "progress_only", title: "", description: "", amount: "", due_on: "",
                }])}>
          + Add a step
        </button>
      )}

      {error ? <p className="ob-error">{error.message}</p> : null}

      <footer className="ob-actions quote-actions">
        <span className="ob-hint" data-testid="schedule-total">
          Steps total {formatMoney(total, order.currency)} of{" "}
          {formatMoney(order.order_total_cents, order.currency)} agreed
          {balances ? "" : " — these have to match before anyone can agree"}
        </span>
        {locked ? null : (
          <button type="button" className="primary-btn" data-testid="save-schedule"
                  disabled={busy || !balances} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        )}
      </footer>
    </div>
  );
}
