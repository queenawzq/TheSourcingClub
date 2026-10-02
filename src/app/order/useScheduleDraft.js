/**
 * The schedule while it is being agreed: the rows on screen, saving them, and
 * agreeing to what is saved. Both sides edit the same schedule on their own
 * designed screen (the brand in its flow frame, the factory on its order
 * page), so the rules live here once.
 *
 * Prefilled from the order's generated steps: nobody faces a blank list.
 */
import { useEffect, useMemo, useState } from "react";
import { agreeSchedule } from "../../lib/domain/order.js";
import { saveSchedule } from "../../lib/domain/milestone.js";
import { editRow, newRow, scheduleLines, scheduleRows, scheduleTotal } from "./order-view.js";

const sameRows = (a, b) => JSON.stringify(scheduleLines(a)) === JSON.stringify(scheduleLines(b));

export function useScheduleDraft({ order, milestones, isFactory, reload }) {
  const saved = useMemo(() => scheduleRows(milestones), [milestones]);
  const [rows, setRows] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A reload after a save, or the other side's save, replaces the draft.
  useEffect(() => { setRows(saved); }, [saved]);

  const total = scheduleTotal(rows);
  const balances = total === order.order_total_cents;
  const dirty = !sameRows(rows, saved);
  const mine = isFactory ? order.schedule_factory_agreed_at : order.schedule_brand_agreed_at;
  const theirs = isFactory ? order.schedule_brand_agreed_at : order.schedule_factory_agreed_at;
  const other = isFactory ? "The brand" : "The factory";

  let hint;
  if (dirty) {
    hint = theirs || mine
      ? "Save your changes first. Saving withdraws both agreements, so you will each need to agree again."
      : "Save your changes before agreeing.";
  } else if (mine && theirs) {
    hint = "Both sides have agreed.";
  } else if (mine) {
    hint = `You have agreed. Waiting for ${other.toLowerCase()} to agree.`;
  } else if (theirs) {
    hint = `${other} has agreed. Agree too and production starts.`;
  } else {
    hint = "Neither side has agreed yet. Either side can change the steps.";
  }

  async function run(work) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      await reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return {
    rows,
    total,
    balances,
    dirty,
    busy,
    error,
    hint,
    agreed: Boolean(mine),
    // Agreeing signs what is SAVED. With edits on screen, or steps that do not
    // add up to the order, the button would sign something else.
    canAgree: !mine && !dirty && balances && !busy,
    canSave: dirty && balances && !busy,
    onChange: (index, patch) => setRows((current) => current.map((row, i) => (i === index ? editRow(row, patch) : row))),
    onAdd: () => setRows((current) => [...current, newRow(current)]),
    onRemove: (index) => setRows((current) => current.filter((_, i) => i !== index)),
    save: () => run(() => saveSchedule(order.id, scheduleLines(rows))),
    // agree_schedule takes the revision: without it a client that cached "I
    // already agreed" re-stamps a side onto terms it never read.
    agree: () => run(() => agreeSchedule(order.id, order.schedule_revision)),
  };
}
