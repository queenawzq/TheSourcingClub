/**
 * When the sender's page asks the server again about one of its own messages
 * still being checked (`delivery = 'checking'`).
 *
 * Quickly at first (5, 15, 30 and 60 s after it was sent), then once a minute
 * for as long as the page is open, until the message is decided. The sender is
 * no longer shown a "checking" notice, so a check that failed for a while must
 * not leave the message undelivered with nobody the wiser: the page keeps
 * asking. A closed page asks again when it is opened.
 */
export const RESCREEN_AFTER_MS = [5000, 15000, 30000, 60000];
export const RESCREEN_EVERY_MS = 60000;

/**
 * The moment of the next ask (epoch ms), after `attempts` earlier ones, the
 * last at `lastAt`. Never sooner than the first gap after the last ask (a
 * minute once the quick ones are done), so a message found long after it was
 * sent is not asked about in a burst.
 */
export function nextRescreenAt(createdAt, attempts = 0, lastAt = null) {
  const sent = typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  const quick = attempts < RESCREEN_AFTER_MS.length;
  const planned = quick
    ? sent + RESCREEN_AFTER_MS[attempts]
    : sent + RESCREEN_AFTER_MS.at(-1) + (attempts - RESCREEN_AFTER_MS.length + 1) * RESCREEN_EVERY_MS;
  if (lastAt == null) return planned;
  return Math.max(planned, lastAt + (quick ? RESCREEN_AFTER_MS[0] : RESCREEN_EVERY_MS));
}
