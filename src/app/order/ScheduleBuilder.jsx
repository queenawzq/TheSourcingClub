/**
 * The production steps, before the order starts, on Queena's designed
 * builder.
 *
 * `MilestonesScreen` and `FlowShell` come from src/prototype/main.jsx. The
 * brand meets the builder where the design puts it, as the "Production steps"
 * stage of its quote-to-contract flow, with the design's own buttons: "Save
 * changes", and "Continue to funding", which confirms the saved steps and
 * starts the order. Only the brand sets the steps; the factory reads them on
 * its own order page and is told of every change.
 */
import React from "react";
import { FlowShell, MilestonesScreen } from "../../prototype/main.jsx";
import { formatMoney } from "../../lib/money.js";
import { useScheduleDraft } from "./useScheduleDraft.js";

function totalLine(draft, order) {
  const text = `Steps total ${formatMoney(draft.total, order.currency)} of ${formatMoney(order.order_total_cents, order.currency)}`;
  return draft.balances ? text : `${text}: these have to match before you can save or continue`;
}

export function BrandSchedule({ order, milestones, reload, vendor, onBack, banner = null, dialog = null }) {
  const draft = useScheduleDraft({ order, milestones, reload });

  return (
    <FlowShell
      screen="milestones"
      onBack={onBack}
      onNext={draft.confirm}
      primaryDisabled={!draft.canConfirm}
      busy={draft.busy}
      centerText={totalLine(draft, order)}
      centerAction={{ label: "Save changes", onClick: draft.save, disabled: !draft.canSave }}
      rail={{ vendor }}
    >
      {/* Live only: an open proposal to cancel sits above the steps. */}
      {banner}
      <MilestonesScreen live={draft} />
      <p className="muted production-schedule-helper" data-testid="schedule-hint">{draft.hint}</p>
      {draft.error && <p className="composer-error" role="alert">{draft.error.message}</p>}
      {dialog}
    </FlowShell>
  );
}
