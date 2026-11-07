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
import { useEffect, useMemo, useRef, useState } from "react";
import { agreeSchedule, getOrder } from "../../lib/domain/order.js";
import { saveSchedule } from "../../lib/domain/milestone.js";
import { listPayments } from "../../lib/domain/payment.js";
import { toCents } from "../../lib/money.js";
import { editRow, moveScheduleRow, newRow, scheduleLines, scheduleRows, scheduleTotal, stepAmount } from "./order-view.js";

const linesOf = (rows) => JSON.stringify(scheduleLines(rows));

export function useScheduleDraft({ order, milestones, reload, onFund }) {
  const saved = useMemo(() => scheduleRows(milestones), [milestones]);
  const savedLines = linesOf(saved);
  const [rows, setRows] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedOnce, setSavedOnce] = useState(false);
  // The saved steps this draft was started from.
  const [baseLines, setBaseLines] = useState(savedLines);
  const seenLines = useRef(savedLines);
  const sentLines = useRef(null);

  // The order page re-reads every 15 s and on anything the other side does, so
  // `saved` is a new array all the time and says nothing by itself. What was
  // typed is replaced only when the steps' own words and figures changed and
  // the draft has nothing of its own to lose. `npm run check:schedule-draft`.
  useEffect(() => {
    if (seenLines.current === savedLines) return;
    const before = seenLines.current;
    const sent = sentLines.current;
    seenLines.current = savedLines;
    sentLines.current = null;
    const mine = linesOf(rows);
    if (mine === before || mine === baseLines || mine === savedLines || mine === sent) {
      setRows(saved);
      setBaseLines(savedLines);
    } else if (sent) {
      // Typed while the save was on its way: still unsaved, and nobody else's.
      setBaseLines(savedLines);
    }
    // Otherwise a teammate saved over a draft with edits: both stay, and
    // `changedElsewhere` says so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLines]);

  const total = scheduleTotal(rows);
  const balances = total === order.order_total_cents;
  const dirty = linesOf(rows) !== savedLines;

  const hint = dirty ? "Unsaved changes" : savedOnce ? "Saved" : "";

  async function saveRows() {
    sentLines.current = linesOf(rows);
    try {
      await saveSchedule(order.id, scheduleLines(rows));
    } catch (failure) {
      sentLines.current = null;
      throw failure;
    }
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
    changedElsewhere: dirty && baseLines !== savedLines,
    takeSaved: () => {
      setRows(saved);
      setBaseLines(savedLines);
    },
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
    onMove: (index, offset) => setRows((current) => moveScheduleRow(current, index, offset)),
    onAdd: () => setRows((current) => [...current, newRow(current)]),
    onRemove: (index) => setRows((current) => current.filter((_, i) => i !== index)),
    save: () => run(async () => {
      await saveRows();
      setSavedOnce(true);
    }),
    // agree_schedule takes the revision the brand is looking at, read fresh
    // after any save: a stale one is refused rather than confirming steps
    // that changed underneath.
    // Confirming starts the order, and its first paid step falls due at
    // once: "Continue to funding" then lands on that step's Fund screen.
    confirm: async () => {
      let due = null;
      await run(async () => {
        let revision = order.schedule_revision;
        if (dirty) {
          await saveRows();
          revision = (await getOrder(order.id)).schedule_revision;
        }
        await agreeSchedule(order.id, revision);
        due = (await listPayments(order.id))
          .filter((payment) => payment.state === "due")
          .sort((a, b) => (a.order_milestones?.sort ?? 0) - (b.order_milestones?.sort ?? 0))[0] ?? null;
      });
      if (due) onFund?.(due.id);
    },
  };
}
