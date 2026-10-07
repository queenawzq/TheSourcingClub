/**
 * Cancelling an order, for the list and the order page alike.
 *
 * Proposing and accepting go through `CancelOrderDialog`; withdrawing and
 * keeping the order are one click, since each only clears a proposal and the
 * order carries on. Every change calls `onChanged()` so the screen reloads.
 *
 * The functions decide who may do what (035, 070): either side proposes, only
 * the other side accepts or keeps the order, only the proposer withdraws.
 */
import React, { useState } from "react";
import {
  acceptCancellation,
  declineCancellation,
  proposeCancellation,
  withdrawCancellation,
} from "../../lib/domain/order.js";
import CancelOrderDialog from "./CancelOrderDialog.jsx";

export default function useOrderCancel({ onChanged = null, onViewOrder = null } = {}) {
  // { mode: "propose" | "accept", id, title, counterparty, reason, onDone }
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [error, setError] = useState(null);

  async function run(work, { inDialog = false } = {}) {
    if (busy) return false;
    setBusy(true);
    (inDialog ? setDialogError : setError)(null);
    try {
      await work();
      await onChanged?.();
      return true;
    } catch (failure) {
      (inDialog ? setDialogError : setError)(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setTarget(null);
    setDialogError(null);
  };

  async function confirm(reason) {
    const done = await run(
      () => (target.mode === "propose" ? proposeCancellation(target.id, reason) : acceptCancellation(target.id)),
      { inDialog: true },
    );
    if (!done) return;
    // A list passes its own reload with the order it opened the dialog for.
    target.onDone?.();
    close();
  }

  return {
    busy,
    error,
    /** Opens the reason dialog. `order` is `{ id, title, counterparty }`. */
    propose: (order) => { setError(null); setTarget({ mode: "propose", ...order }); },
    /** Opens the accept dialog, with the other side's reason read back. */
    accept: (order) => { setError(null); setTarget({ mode: "accept", ...order }); },
    withdraw: (id) => run(() => withdrawCancellation(id)),
    decline: (id) => run(() => declineCancellation(id)),
    view: onViewOrder,
    dialog: target && (
      <CancelOrderDialog
        key={`${target.mode}-${target.id}`}
        mode={target.mode}
        title={target.title}
        counterparty={target.counterparty}
        reason={target.reason}
        busy={busy}
        error={dialogError}
        onConfirm={confirm}
        onClose={close}
      />
    ),
  };
}
