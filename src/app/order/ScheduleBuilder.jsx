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

const sentence = (text) => {
  const words = String(text ?? "").replace(/^save the schedule: /, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// The bar is on screen wherever the page is scrolled, so what stops Continue
// is said there.
function totalLine(draft, order) {
  if (draft.problem) return draft.problem;
  if (draft.error) return sentence(draft.error.message);
  const text = `Steps total ${formatMoney(draft.total, order.currency)} of ${formatMoney(order.order_total_cents, order.currency)}`;
  return draft.balances ? text : `${text}: these have to match before you can save or continue`;
}

// `locked`: hover text when this person may read the steps but not save or
// confirm them (Quote flow sets them); empty for someone who may.
export function BrandSchedule({ order, milestones, reload, vendor, onBack, onFund, banner = null, dialog = null, locked = "" }) {
  const draft = useScheduleDraft({ order, milestones, reload, onFund });

  return (
    <FlowShell
      screen="milestones"
      onBack={onBack}
      onNext={draft.confirm}
      primaryDisabled={Boolean(locked) || !draft.canConfirm}
      primaryTitle={locked}
      busy={draft.busy}
      centerText={totalLine(draft, order)}
      centerAction={{ label: "Save changes", onClick: draft.save, disabled: Boolean(locked) || !draft.canSave, title: locked }}
      rail={{ vendor }}
    >
      {/* Live only: an open proposal to cancel sits above the steps. */}
      {banner}
      <MilestonesScreen live={draft} />
      <p className="muted schedule-draft-hint" data-testid="schedule-hint">{locked ? "" : draft.hint}</p>
      {draft.changedElsewhere && (
        <p className="composer-note" role="status" data-testid="schedule-changed">
          Someone else changed these steps. Saving replaces their changes.{" "}
          <button className="text-link" type="button" onClick={draft.takeSaved}>Use their steps</button>
        </p>
      )}
      {dialog}
    </FlowShell>
  );
}
