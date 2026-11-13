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
import { getOrder } from "../../lib/domain/order.js";
import { can, permissionHint } from "../../lib/domain/org.js";
import { useAuth } from "../../lib/auth.jsx";
import { listMilestones, saveSchedule, updateScheduleDetails } from "../../lib/domain/milestone.js";
import { toCents } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { MilestonesScreen } from "../../prototype/main.jsx";
import { PAID_ON_OPEN, kindFor, moveScheduleRow, scheduleBar, scheduleProblem, stepAmount, typeOf } from "./order-view.js";
import "./order.css";

const PAYS = new Set(["approval_and_payment", "payment_only"]);

export default function ScheduleEditor({ orderId, isFactory }) {
  const { navigate } = useRouter();
  const { activeOrg, orgs } = useAuth();
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
      // As the builder writes money ("$1,920"); toCents reads it back.
      amount: m.amount_cents ? stepAmount(m.amount_cents, loaded.currency ?? undefined) : "",
      due_on: m.due_on ?? "",
      state: m.state,
      paymentState: m.payment?.state ?? null,
    })));
  }, [orderId]);

  useEffect(() => { load().catch(setError); }, [load]);

  // Before the order starts, the brand sets and confirms its steps on its
  // designed "Production steps" screen, which is the order's own address
  // (migration 067: only the brand confirms). This page is for a running order.
  const brandSetsStepsOnOrder = order?.status === "pending_schedule" && !isFactory;
  useEffect(() => {
    if (brandSetsStepsOnOrder) navigate(`/orders/${orderId}`, { replace: true });
  }, [brandSetsStepsOnOrder, navigate, orderId]);

  if (error && !rows) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>← Back</button>
        <h1>Not available</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!rows || !order || brandSetsStepsOnOrder) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  const mayEdit = isFactory || can(activeOrg, "rfqFlow");
  const activeEdit = order.status === "active" && !isFactory && mayEdit;
  const closed = !["pending_schedule", "active"].includes(order.status);
  const locked = isFactory || closed || !mayEdit;
  // Someone in both companies, here as the factory: the brand side is theirs too.
  const brandOrg = isFactory ? orgs.find((org) => org.id === order.brand_org_id) : null;
  // Why the steps can't be changed here, said for the case it is: a finished
  // order is finished for both sides (the database refuses any change), and
  // on an open order only the brand sets the steps (migration 067).
  const lockedWhy = order.status === "completed"
    ? ["This order is complete.", "Its production steps can no longer be changed."]
    : order.status === "cancelled"
      ? ["This order is cancelled.", "Its production steps can no longer be changed."]
      : closed
        ? ["This schedule is settled.", "Its production steps can no longer be changed."]
        : isFactory
          ? ["Only the brand sets the production steps.", brandOrg
            ? `Switch to ${brandOrg.name} to change them.`
            : "If a step doesn't work for you, message the brand."]
          : [permissionHint(activeOrg, "rfqFlow"), "An owner can give it to you in Settings."];
  const total = rows.reduce((sum, row) => sum + (PAYS.has(row.kind) ? toCents(row.amount) ?? 0 : 0), 0);
  const balances = total === order.order_total_cents;
  // What the database would refuse, said before Save, as on the builder.
  const problem = scheduleProblem(rows);

  function update(index, patch) {
    // Changing the steps answers the last refusal, so it goes.
    setError(null);
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
      </header>

      {locked ? (
        <div className="browse-gate">
          <strong>{lockedWhy[0]}</strong>
          <span>{lockedWhy[1]}</span>
        </div>
      ) : null}

      <MilestonesScreen live={{
        rows: rows.map((row, index) => ({
          ...row,
          key: row.id ?? row.key ?? `step-${index}`,
          type: typeOf(row.kind),
          note: row.kind === "payment_only" ? PAID_ON_OPEN : "",
          removeLocked: activeEdit && row.state !== "pending",
        })),
        typeLocked: locked,
        amountLocked: locked,
        readOnly: locked,
        allowAdd: !locked,
        allowRemove: !locked,
        onChange: updateDesignedRow,
        formatAmount: (text) => {
          const cents = toCents(text);
          return cents === null ? text : stepAmount(cents, order.currency ?? undefined);
        },
        onMove: (index, offset) => { setError(null); setRows((current) => moveScheduleRow(current, index, offset)); },
        onRemove: (index) => { setError(null); setRows((current) => current.filter((_, i) => i !== index)); },
        onAdd: () => { setError(null); setRows((current) => [...current, {
          key: `new-${Date.now()}-${current.length}`,
          kind: "progress_only",
          title: "",
          description: "",
          amount: "",
          due_on: "",
          sort: (current.at(-1)?.sort ?? 0) + 10,
          state: "pending",
          paymentState: null,
        }]); },
      }} />

      <footer className="live-schedule-actions active-schedule-actions">
        <span className="ob-hint" data-testid="schedule-total" role={problem || error ? "alert" : undefined}>
          {scheduleBar({ problem, error, total, orderTotal: order.order_total_cents, currency: order.currency, until: "save" })}
        </span>
        {locked ? null : (
          <button type="button" className="primary-btn" data-testid="save-schedule"
                  disabled={busy || !balances || Boolean(problem)} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        )}
      </footer>
    </div>
  );
}
