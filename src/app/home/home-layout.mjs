/**
 * Which dashboard someone sees, decided in one place.
 *
 * "Nothing loaded yet" and "this company has nothing" were the same empty list,
 * so every brand's first paint was the new-brand layout, on every visit. A
 * layout can only be chosen here, and only once the read has answered.
 *
 * Pure, so scripts/check-dashboard.mjs can run every case with no database.
 */

/** How long vendors and calls may hold up the dashboard. Past it, it draws without them. */
export const EXTRA_READ_CAP_MS = 3000;

/**
 * "loading" and "failed" are not layouts: what shows is the header and one
 * line. Only "ready" answers which layout is true.
 */
export function homeLayout({ status, hasHistory }) {
  if (status !== "ready") return status === "failed" ? "failed" : "loading";
  return hasHistory ? "active" : "newcomer";
}

/**
 * A brand is new until it has published something or has an order. A draft is
 * not yet anything anyone else has seen. Cancelled requests and archived orders
 * still count: "YOUR FIRST QUOTE" would not be true.
 */
export function brandHasHistory(rfqs, orders) {
  return (rfqs ?? []).some((rfq) => rfq.status !== "draft") || (orders ?? []).length > 0;
}

/**
 * A vendor is new until it has an order or has ever sent a quote. Not "this
 * month": the layout must not go back to new on the 1st.
 */
export function factoryHasHistory(orders, hasEverQuoted) {
  return (orders ?? []).length > 0 || Boolean(hasEverQuoted);
}

/** How long "Finding vendors…" may stay up. A read that never answers must not say it forever. */
export const LATE_READ_GIVE_UP_MS = 30000;

/**
 * What a panel knows about a read the dashboard does not wait for past the cap.
 * The cap decides when the page draws, never whether the answer is used: an
 * answer is applied whenever it comes, even after the panel stopped waiting.
 * `answered` is false until then, and only then may the panel say it has nothing.
 * Returns what stops following, for when the page moves on.
 */
export function followRead(read, update, giveUpMs = LATE_READ_GIVE_UP_MS) {
  let stopped = false;
  const timer = setTimeout(() => {
    if (!stopped) update((current) => (current.answered ? current : { ...current, answered: true }));
  }, giveUpMs);
  read.then((list) => {
    clearTimeout(timer);
    if (!stopped) update({ list, answered: true });
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** A read the dashboard can draw without: its answer, or the fallback once the cap passes. */
export function withinCap(promise, fallback, ms = EXTRA_READ_CAP_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}
