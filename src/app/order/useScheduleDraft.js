/**
 * The production steps while the brand sets them: the rows on screen, saving
 * them, and confirming what is saved.
 *
 * Only the brand changes the steps (design review, Oct 2). Saving tells the
 * factory what changed; confirming starts the order. A factory that disagrees
 * messages the brand, rather than holding the order up with an agreement of
 * its own.
 *
 * Prefilled from the order's generated steps: nobody faces a blank list.
 */
import { useEffect, useMemo, useState } from "react";
import { agreeSchedule, getOrder } from "../../lib/domain/order.js";
import { saveSchedule } from "../../lib/domain/milestone.js";
import { toCents } from "../../lib/money.js";
import { editRow, newRow, scheduleLines, scheduleRows, scheduleTotal, stepAmount } from "./order-view.js";

const sameRows = (a, b) => JSON.stringify(scheduleLines(a)) === JSON.stringify(scheduleLines(b));

export function useScheduleDraft({ order, milestones, reload }) {
  const saved = useMemo(() => scheduleRows(milestones), [milestones]);
  const [rows, setRows] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A reload after a save replaces the draft.
  useEffect(() => { setRows(saved); }, [saved]);

  const total = scheduleTotal(rows);
  const balances = total === order.order_total_cents;
  const dirty = !sameRows(rows, saved);
  const factory = order.factory?.name || "The factory";

  const hint = dirty
    ? `Unsaved changes. Save them to show ${factory}, or continue: continuing saves them first.`
    : `${factory} sees these steps and is told of every change. Continue to confirm them and start the order.`;

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
    canSave: dirty && balances && !busy,
    // An amount as typed ("1836") back in the design's form ("$1,836");
    // text that is not a number is left for the save to refuse.
    formatAmount: (text) => {
      const cents = toCents(text);
      return cents === null ? text : stepAmount(cents, order.currency ?? undefined);
    },
    // Confirming signs what is SAVED, so edits on screen are saved first.
    canConfirm: balances && !busy,
    onChange: (index, patch) => setRows((current) => current.map((row, i) => (i === index ? editRow(row, patch) : row))),
    onAdd: () => setRows((current) => [...current, newRow(current)]),
    onRemove: (index) => setRows((current) => current.filter((_, i) => i !== index)),
    save: () => run(() => saveSchedule(order.id, scheduleLines(rows))),
    // agree_schedule takes the revision the brand is looking at, read fresh
    // after any save: a stale one is refused rather than confirming steps
    // that changed underneath.
    confirm: () => run(async () => {
      let revision = order.schedule_revision;
      if (dirty) {
        await saveSchedule(order.id, scheduleLines(rows));
        revision = (await getOrder(order.id)).schedule_revision;
      }
      await agreeSchedule(order.id, revision);
    }),
  };
}
