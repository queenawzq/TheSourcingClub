/**
 * Whether the onboarding should (re)open the profile summary because staff
 * asked for more information.
 *
 * A request arriving while the finish card is open opens the summary. But the
 * moment the factory sends its profile back, the finish card opens while the
 * review it answered is still "needs_information": the profile is re-read
 * after the send, not before. Without `answered`, that stale request sent the
 * factory straight back to the summary with Confirm active and no word, as if
 * nothing had been sent (Nov 18).
 *
 * `answered` is the review object this mount sent back. A new request from
 * staff is a new object, so it still reopens the summary.
 */
export function reopensSummary({ review, step, lastStep, answered }) {
  if (review?.state !== "needs_information") return false;
  if (step < lastStep) return false;
  return review !== answered;
}
