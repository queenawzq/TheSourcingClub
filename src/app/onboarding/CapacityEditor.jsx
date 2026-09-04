/**
 * Capacity editor — the one implementation.
 *
 * The prototypes build this widget four separate times: the dashboard drawer,
 * the profile editor, the onboarding step, and a standalone helper. Three of
 * them agree; the fourth assumes 18 minutes per piece for every category, so a
 * sweater factory (really 42) sees roughly 2.3x its true capacity.
 *
 * All the arithmetic here comes from src/lib/domain/capacity.js, which mirrors
 * the SQL in migration 003. A factory and the brand ranking it must never see
 * different numbers.
 */
import React, { useMemo } from "react";
import {
  CAPACITY_LEVELS,
  availableRange,
  capacityWindow,
  estimatedHours,
  minutesPerPieceFor,
  monthKey,
  monthlyUnits,
} from "../../lib/domain/capacity.js";
import { termLabel } from "../../lib/domain/taxonomy.js";

const MONTH_LABEL = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });

export default function CapacityEditor({ categories, capacity, months, onChange, onMonthChange }) {
  const category = categories.find((term) => term.id === capacity.category_term_id) ?? null;
  const minutes = minutesPerPieceFor(category);

  const units = useMemo(() => monthlyUnits(capacity, minutes), [capacity, minutes]);
  const hours = useMemo(() => estimatedHours(capacity, minutes), [capacity, minutes]);
  const window = useMemo(() => capacityWindow(6), []);

  const set = (patch) => onChange({ ...capacity, ...patch });

  return (
    <div className="cap">
      <div className="ob-field" data-field="capacity-category">
        <span className="ob-label">What do you mainly make?</span>
        <span className="ob-hint ob-hint--above">
          Sets the reference style we use to turn your hours into pieces.
        </span>
        <select
          value={capacity.category_term_id ?? ""}
          onChange={(event) => set({ category_term_id: event.target.value || null })}
        >
          <option value="">Select…</option>
          {categories.map((term) => (
            <option key={term.id} value={term.id}>
              {termLabel(term)} — {term.extra?.reference_style_en} (~
              {term.extra?.minutes_per_piece} min/pc)
            </option>
          ))}
        </select>
      </div>

      <div className="ob-field" data-field="capacity-mode">
        <span className="ob-label">How do you think about capacity?</span>
        <div className="seg">
          <button
            type="button"
            className={capacity.input_mode === "units" ? "is-on" : undefined}
            aria-pressed={capacity.input_mode === "units"}
            onClick={() => set({ input_mode: "units" })}
          >
            In pieces
          </button>
          <button
            type="button"
            className={capacity.input_mode === "hours" ? "is-on" : undefined}
            aria-pressed={capacity.input_mode === "hours"}
            onClick={() => set({ input_mode: "hours" })}
          >
            In line hours
          </button>
        </div>
      </div>

      {capacity.input_mode === "hours" ? (
        <label className="ob-field" data-field="line-hours-per-month">
          <span className="ob-label">Line hours per month</span>
          <input
            type="text"
            inputMode="numeric"
            value={capacity.line_hours ?? ""}
            onChange={(event) => set({ line_hours: event.target.value.replace(/[^0-9.]/g, "") })}
            placeholder="2400"
          />
        </label>
      ) : (
        <label className="ob-field" data-field="pieces-per-month">
          <span className="ob-label">Pieces per month</span>
          <input
            type="text"
            inputMode="numeric"
            value={capacity.monthly_units ?? ""}
            onChange={(event) => set({ monthly_units: event.target.value.replace(/[^0-9]/g, "") })}
            placeholder="7200"
          />
        </label>
      )}

      {units ? (
        <div className="cap-readout" data-testid="capacity-readout">
          <p className="cap-figure">
            <span data-testid="capacity-pieces">{units.toLocaleString()}</span> <span>pieces per month</span>
          </p>
          <p className="cap-working">
            {capacity.input_mode === "hours"
              ? `${Number(capacity.line_hours).toLocaleString()} hours × 60 ÷ ${minutes} min per ${
                  category?.extra?.reference_style_en ?? "piece"
                }`
              : `about ${hours?.toLocaleString()} line hours at ${minutes} min per ${
                  category?.extra?.reference_style_en ?? "piece"
                }`}
          </p>
          <p className="cap-note">
            This is what brands see. It is an estimate for matching, not a commitment.
          </p>
        </div>
      ) : null}

      <div className="ob-field" data-field="booking-calendar">
        <span className="ob-label">How booked are the next six months?</span>
        <span className="ob-hint ob-hint--above">
          Rough is fine. Brands use it to know whether to bother asking.
        </span>

        <div className="cap-months">
          {window.map((month) => {
            const key = monthKey(month);
            const level = months[key] ?? "open";
            const range = units ? availableRange(capacity, level, minutes) : null;

            return (
              <div key={key} className="cap-month">
                <span className="cap-month-name">{MONTH_LABEL.format(month)}</span>
                <div className="seg seg--small">
                  {Object.entries(CAPACITY_LEVELS).map(([value, meta]) => (
                    <button
                      key={value}
                      type="button"
                      className={level === value ? "is-on" : undefined}
                      aria-pressed={level === value}
                      onClick={() => onMonthChange(key, value)}
                    >
                      {meta.labelEn}
                    </button>
                  ))}
                </div>
                {range ? (
                  <span className="cap-month-range">
                    {range.min === range.max
                      ? `${range.max.toLocaleString()} pcs`
                      : `${range.min.toLocaleString()}–${range.max.toLocaleString()} pcs`}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
