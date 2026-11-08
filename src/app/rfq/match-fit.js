const MATCH_BANDS = [
  // The design system's tiers. Below 60 is not a fit, and says so.
  [90, "Strong fit", "strong"],
  [75, "Good fit", "good"],
  [60, "Potential fit", "warn"],
  [0, "Not a fit", "tradeoff"],
];

/** Present the database's RFQ-to-factory score using the existing TSC badges. */
export function matchFit(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const numericScore = Number(score);
  const [, label, tone] = MATCH_BANDS.find(([floor]) => numericScore >= floor) ?? MATCH_BANDS.at(-1);
  return { label, tone, score: numericScore };
}
