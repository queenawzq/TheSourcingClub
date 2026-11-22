import { figuresAskDelay } from "./payment-summary.mjs";

/**
 * How the Payments page asks for its balance (use-factory-balance.js), with
 * no React in it, so check scripts run it:
 *
 *   ask      asks now. One ask runs at a time; one asked meanwhile runs once
 *            after it (however many were asked), so answers land in the
 *            order asked. Resolves to the answer that ask got, or null.
 *   reset    an ask started before it never lands; asks now
 *   request  asks soon, as a money change does: changes close together
 *            become one ask, and where `limited()` (the read asks Stripe for
 *            a member) at most once a minute (figuresAskDelay)
 *   cancel   forgets a request not yet asked
 *
 * `fetchAnswer()` is the server's read; `apply({ answer } | { failure } |
 * { reset })` is told what to show (nextBalanceState).
 */
export function balanceReader({ fetchAnswer, apply, limited = () => false, now = () => Date.now(), later = (run, ms) => setTimeout(run, ms), cancelLater = (timer) => clearTimeout(timer) }) {
  let flight = null;
  let queued = null;
  let generation = 0;
  let lastAskAt = 0;
  let requestedAt = null;
  let timer = null;
  const ask = () => {
    if (flight) {
      if (!queued) {
        queued = flight.then(() => {
          queued = null;
          return ask();
        });
      }
      return queued;
    }
    const asked = generation;
    lastAskAt = now();
    flight = Promise.resolve().then(fetchAnswer).then(
      (answer) => {
        if (asked === generation) apply({ answer });
        return answer;
      },
      (failure) => {
        if (asked === generation) apply({ failure });
        return null;
      },
    ).finally(() => { flight = null; });
    return flight;
  };
  const reset = () => {
    generation += 1;
    apply({ reset: true });
    return ask();
  };
  const run = () => {
    cancelLater(timer);
    if (requestedAt == null) return;
    const delay = figuresAskDelay({ now: now(), requestedAt, lastAskAt, limited: limited() });
    if (delay === null) { requestedAt = null; return; }
    if (delay > 0) { timer = later(run, delay); return; }
    requestedAt = null;
    ask();
  };
  const request = () => {
    requestedAt = now();
    run();
  };
  const cancel = () => {
    cancelLater(timer);
    requestedAt = null;
  };
  return { ask, reset, request, cancel };
}

/**
 * What the page shows after an ask: the answer; after a failure, the last
 * answer (a failed ask never blanks the figures), or on a first ask what the
 * server still sent (the database's figures, `error` set), else null; after
 * a reset, nothing yet (undefined).
 */
export function nextBalanceState(was, { answer, failure, reset = false }) {
  if (reset) return { answer: undefined, failure: null };
  if (!failure) return { answer, failure: null };
  return { answer: was?.answer ?? (failure?.details?.figures ? failure.details : null), failure };
}

export const SIGN_IN_AGAIN = "Your sign-in expired. Sign in again.";
export const RELOAD_AND_TRY_AGAIN = "That didn't go through. Reload the page and try again.";

/**
 * The balance read's PayPal / Wise side: what they can withdraw, the open
 * withdrawals (each already took its amount from the balance) and the latest
 * one, what cancelling each gives back, and the sentence when nothing could
 * be read.
 */
export function withdrawalsFrom(answer, failure = null) {
  const rows = answer?.withdrawals ?? [];
  const opens = rows.filter((w) => ["requested", "paying"].includes(w.status));
  const available = answer?.reach?.pool_cents;
  return {
    available: available == null ? null : Number(available),
    open: opens[0] ?? null,
    opens,
    last: rows[0] ?? null,
    rows,
    returnable: new Map(Object.entries(answer?.returnable ?? {}).map(([id, cents]) => [id, Number(cents)])),
    error: answer === null && failure ? (failure.status === 401 ? SIGN_IN_AGAIN : RELOAD_AND_TRY_AGAIN) : null,
  };
}
