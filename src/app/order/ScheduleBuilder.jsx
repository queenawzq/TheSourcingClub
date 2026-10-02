/**
 * The schedule, before both sides agree it, on Queena's designed builder.
 *
 * `MilestonesScreen` and `FlowShell` come from src/prototype/main.jsx. The
 * brand meets the builder where the design puts it, as the "Production steps"
 * stage of its quote-to-contract flow. The factory has no designed builder,
 * so it gets the same card inside its own designed order page, in place of
 * the timeline the agreement is about to create.
 *
 * Agreeing is what activates an order, and it signs what is SAVED: the
 * agree button waits while there are unsaved edits or the steps do not add up
 * to the order total.
 */
import React from "react";
import { FlowShell, MilestonesScreen } from "../../prototype/main.jsx";
import { formatMoney } from "../../lib/money.js";
import { useScheduleDraft } from "./useScheduleDraft.js";

function totalLine(draft, order) {
  const text = `Steps total ${formatMoney(draft.total, order.currency)} of ${formatMoney(order.order_total_cents, order.currency)}`;
  return draft.balances ? text : `${text}: these have to match before anyone can save or agree`;
}

export function BrandSchedule({ order, milestones, reload, vendor, onBack }) {
  const draft = useScheduleDraft({ order, milestones, isFactory: false, reload });

  return (
    <FlowShell
      screen="milestones"
      onBack={onBack}
      onNext={draft.agree}
      primaryLabel={draft.agreed ? "You have agreed" : "Agree to this schedule"}
      primaryDisabled={!draft.canAgree}
      centerText={totalLine(draft, order)}
      centerAction={{ label: draft.busy ? "Saving…" : "Save changes", onClick: draft.save, disabled: !draft.canSave }}
      rail={{ vendor }}
    >
      <MilestonesScreen live={draft} />
      <p className="muted production-schedule-helper" data-testid="schedule-hint">{draft.hint}</p>
      {draft.error && <p className="composer-error" role="alert">{draft.error.message}</p>}
    </FlowShell>
  );
}

export function FactorySchedule({ order, milestones, reload }) {
  const draft = useScheduleDraft({ order, milestones, isFactory: true, reload });

  return (
    <section className="live-schedule">
      <MilestonesScreen live={draft} />
      <p className="muted production-schedule-helper" data-testid="schedule-hint">{draft.hint}</p>
      {draft.error && <p className="composer-error" role="alert">{draft.error.message}</p>}
      <div className="live-schedule-actions">
        <span data-testid="schedule-total">{totalLine(draft, order)}</span>
        <button className="secondary-btn" type="button" disabled={!draft.canSave} onClick={draft.save}>
          {draft.busy ? "Saving…" : "Save changes"}
        </button>
        <button className="primary-btn" type="button" data-testid="agree-schedule" disabled={!draft.canAgree} onClick={draft.agree}>
          {draft.agreed ? "You have agreed" : "Agree to this schedule"}
        </button>
      </div>
    </section>
  );
}
