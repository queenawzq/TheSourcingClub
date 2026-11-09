/**
 * The order a conversation reads in.
 *
 * Delivered messages read in delivery order, so one staff released arrives as
 * new. A message that was never delivered (blocked, rejected, still being
 * checked) has only the time it was written, and screening takes seconds: a
 * clean message written first can be delivered after a blocked one written
 * next. So an undelivered message reads after everything written before it
 * that went straight through.
 *
 * Each row comes back with `reading_at`, because the screen sorts again when
 * it merges in the call cards.
 */
// Screening gives up in seconds. Longer than this, a person released it.
const STRAIGHT_THROUGH_MS = 60_000;

export function inReadingOrder(rows) {
  const written = (row) => Date.parse(row.created_at);
  const delivered = (row) => Date.parse(row.delivered_at);
  const straightThrough = rows.filter((row) => row.delivered_at && delivered(row) - written(row) <= STRAIGHT_THROUGH_MS);
  const readingAt = (row) => (row.delivered_at
    ? delivered(row)
    : straightThrough.reduce((latest, other) => (written(other) <= written(row) ? Math.max(latest, delivered(other)) : latest), written(row)));
  return rows.map((row) => ({ ...row, reading_at: readingAt(row) })).sort((a, b) => a.reading_at - b.reading_at || written(a) - written(b));
}
