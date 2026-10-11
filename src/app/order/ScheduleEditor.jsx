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
import { listMilestones, saveSchedule, updateScheduleDetails } from "../../lib/domain/milestone.js";
import { formatMoney, fromCents, toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { MilestonesScreen } from "../../prototype/main.jsx";
import { kindFor, typeOf } from "./order-view.js";
import "./order.css";

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
      id: m.id,
      sort: m.sort,
      kind: m.kind,
      title: m.title,
      description: m.description ?? "",
      amount: fromCents(m.amount_cents),
      due_on: m.due_on ?? "",
      state: m.state,
      paymentState: m.payment?.state ?? null,
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

  const activeEdit = order.status === "active" && !isFactory;
  const locked = isFactory || !["pending_schedule", "active"].includes(order.status);
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

  function updateDesignedRow(index, patch) {
    if (patch.type) {
      const nextKind = kindFor(patch.type, rows[index].kind);
      update(index, {
        kind: nextKind,
        amount: PAYS.has(nextKind) ? rows[index].amount : "",
      });
      return;
    }
    update(index, patch);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (activeEdit) {
        await updateScheduleDetails(orderId, rows.map((row) => ({
          id: row.id ?? null,
          kind: row.kind,
          title: row.title,
          description: row.description,
          amount_cents: PAYS.has(row.kind) ? toCents(row.amount) : null,
          due_on: row.due_on,
          sort: row.sort,
        })));
      } else {
        await saveSchedule(orderId, rows.map((row) => ({
          kind: row.kind,
          title: row.title,
          description: row.description,
          amount_cents: PAYS.has(row.kind) ? toCents(row.amount) : null,
          due_on: row.due_on,
          sort: row.sort,
        })));
      }
      navigate(`/orders/${orderId}`);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <div className="active-schedule-editor">
      <button type="button" className="project-back-link" onClick={() => navigate(`/orders/${orderId}`)}>
        ← Back to the order
      </button>

      <header className="flow-header active-schedule-header">
        <p className="eyebrow">PRODUCTION ORDER</p>
        <h1>Manage production steps</h1>
        <p>Update the milestones that guide this order from production through final payment.</p>
      </header>

      {locked ? (
        <div className="browse-gate">
          <strong>This schedule is settled.</strong>
          <span>Only the brand can manage milestones on an active order.</span>
        </div>
      ) : activeEdit ? null : (
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

      <MilestonesScreen live={{
        rows: rows.map((row, index) => ({
          ...row,
          key: row.id ?? `step-${index}`,
          type: typeOf(row.kind),
          removeLocked: activeEdit && row.state !== "pending",
        })),
        helper: activeEdit
          ? "Add, remove, or update future production steps. Steps already underway keep their history."
          : undefined,
        typeLocked: locked,
        amountLocked: locked,
        readOnly: locked,
        allowAdd: !locked,
        allowRemove: !locked,
        onChange: updateDesignedRow,
        onRemove: (index) => setRows((current) => current.filter((_, i) => i !== index)),
        onAdd: () => setRows((current) => [...current, {
          kind: "progress_only",
          title: "",
          description: "",
          amount: "",
          due_on: "",
          sort: (current.at(-1)?.sort ?? 0) + 10,
          state: "pending",
          paymentState: null,
        }]),
      }} />

      {error ? <p className="ob-error">{error.message}</p> : null}

      <footer className="live-schedule-actions active-schedule-actions">
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
