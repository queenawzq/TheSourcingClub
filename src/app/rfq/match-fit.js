const MATCH_BANDS = [
  [90, "Strong fit", "strong"],
  [75, "Great fit", "good"],
  [0, "Potential fit", "warn"],
];

/** Present the database's RFQ-to-factory score using the existing TSC badges. */
export function matchFit(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const numericScore = Number(score);
  const [, label, tone] = MATCH_BANDS.find(([floor]) => numericScore >= floor) ?? MATCH_BANDS.at(-1);
  return { label, tone, score: numericScore };
}
