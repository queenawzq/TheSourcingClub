/**
 * Factory capacity — the one implementation.
 *
 * The prototypes convert line hours into pieces in FOUR separate places, and
 * one of them (the dashboard chip) hardcodes 18 minutes per piece for every
 * category. A sweater factory's real reference style is 42 min/pc, so that
 * copy reports roughly 2.3x the true capacity.
 *
 * These functions mirror the SQL in migration 003 exactly. If you change the
 * maths here, change it there too — the SQL is what the match score and any
 * server-side query use, and the two drifting apart would mean a factory sees
 * one number and the brand ranking it sees another.
 */

/** Fallback when a factory has not chosen a capacity category yet. */
export const DEFAULT_MINUTES_PER_PIECE = 18;

/**
 * Share of monthly capacity still available at each booking level. These are
 * the percentages the design already uses; they are duplicated in
 * capacity_level_bounds() in SQL.
 */
export const CAPACITY_LEVELS = {
  open: { minShare: 0.6, maxShare: 1.0, labelEn: "Mostly open", labelZh: "较空" },
  partial: { minShare: 0.25, maxShare: 0.6, labelEn: "Partly booked", labelZh: "部分已订" },
  full: { minShare: 0.0, maxShare: 0.25, labelEn: "Mostly full", labelZh: "较满" },
};

/**
 * Monthly capacity in pieces, however the factory chose to express it.
 *
 * @param {object} capacity                 a factory_capacity row
 * @param {number} [minutesPerPiece]        from the chosen capacity category
 * @returns {number|null}
 */
export function monthlyUnits(capacity, minutesPerPiece = DEFAULT_MINUTES_PER_PIECE) {
  if (!capacity) return null;

  if (capacity.input_mode === "units") {
    return capacity.monthly_units ?? null;
  }

  const hours = Number(capacity.line_hours);
  const minutes = Number(minutesPerPiece);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  return Math.round((hours * 60) / minutes);
}

/**
 * The inverse, shown alongside the units input so a factory that thinks in
 * hours can sanity-check a units figure.
 */
export function estimatedHours(capacity, minutesPerPiece = DEFAULT_MINUTES_PER_PIECE) {
  if (!capacity) return null;

  if (capacity.input_mode === "hours") {
    return Number(capacity.line_hours) || null;
  }

  const units = Number(capacity.monthly_units);
  const minutes = Number(minutesPerPiece);
  if (!Number.isFinite(units) || !Number.isFinite(minutes)) return null;
  return Math.round((units * minutes) / 60);
}

/**
 * Pieces the factory could take in a month at a given booking level. This is
 * the range a brand sees on a factory card.
 */
export function availableRange(capacity, level, minutesPerPiece = DEFAULT_MINUTES_PER_PIECE) {
  const total = monthlyUnits(capacity, minutesPerPiece);
  const bounds = CAPACITY_LEVELS[level];
  if (total == null || !bounds) return null;

  return {
    min: Math.round(total * bounds.minShare),
    max: Math.round(total * bounds.maxShare),
  };
}

/** Minutes per piece for a capacity_category taxonomy term. */
export function minutesPerPieceFor(categoryTerm) {
  const value = Number(categoryTerm?.extra?.minutes_per_piece);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MINUTES_PER_PIECE;
}

/**
 * The rolling window of months a factory marks up. The prototypes hardcode
 * ["Aug".."Jan"], which silently becomes wrong the moment the calendar moves;
 * this derives from today.
 */
export function capacityWindow(monthCount = 6, from = new Date()) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  return Array.from({ length: monthCount }, (_, index) => {
    const month = new Date(start);
    month.setUTCMonth(start.getUTCMonth() + index);
    return month;
  });
}

/** ISO date for the first of a month, matching the SQL column's shape. */
export function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
