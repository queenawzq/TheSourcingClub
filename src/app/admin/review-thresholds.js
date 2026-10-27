/**
 * Whether the admin review thresholds make sense together.
 *
 * Read from the bottom up, the bands must not overlap or run backwards: below
 * "more information" a company is asked for more, the manual range is read by
 * a person, and above "ready to approve" it is ready. The design's form saved
 * any numbers at all ("ready to approve above 50%" beside a manual range of
 * 80–94% was accepted).
 *
 * @returns {string|null} why the numbers are refused, or null when they fit
 */
export function thresholdProblem({ autoClear, manualMin, manualMax, moreInformation }) {
  const values = { autoClear, manualMin, manualMax, moreInformation };
  for (const [key, raw] of Object.entries(values)) {
    const value = Number(raw);
    if (String(raw).trim() === "" || !Number.isInteger(value) || value < 0 || value > 100) {
      const label = { autoClear: "Ready to approve", manualMin: "The manual review minimum", manualMax: "The manual review maximum", moreInformation: "The more information threshold" }[key];
      return `${label} must be a whole number from 0 to 100.`;
    }
  }
  const [clear, min, max, more] = [autoClear, manualMin, manualMax, moreInformation].map(Number);
  if (min > max) return `The manual review range runs backwards: ${min}% to ${max}%.`;
  if (more > min) return `"More information" (below ${more}%) overlaps the manual review range, which starts at ${min}%.`;
  if (clear <= max) return `"Ready to approve" (above ${clear}%) must be above the manual review range, which ends at ${max}%.`;
  return null;
}
