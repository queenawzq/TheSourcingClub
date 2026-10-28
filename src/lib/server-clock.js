/**
 * The marketplace's time, as near as the browser can tell it.
 *
 * Join opens 10 minutes before a call by the server's clock (api/call-join.js
 * refuses earlier), but the card read the device's: a laptop a minute fast
 * showed "Join call" while the server still said "the call opens 10 minutes
 * before it starts". So the call cards read `serverNow()`, the device's time
 * corrected by what our own responses say the time is.
 *
 * Only same-origin responses can be read for this: a cross-origin `Date`
 * header (Supabase) is not exposed to the page. An HTTP date has whole
 * seconds, so a difference under two seconds is noise and is left alone.
 */
let offset = 0;
let syncing = null;

const NOISE_MS = 2000;

/** Learn the server's time from one of our own responses. */
export function noteServerDate(response, sentAt, receivedAt = Date.now()) {
  const date = Date.parse(response?.headers?.get?.("Date") ?? "");
  if (!Number.isFinite(date)) return;
  // The header is the start of its second; the moment is half a second in,
  // halfway through the round trip.
  const sample = date + 500 - (sentAt + receivedAt) / 2;
  offset = Math.abs(sample) < NOISE_MS ? 0 : Math.round(sample);
}

/** Now, by the server's clock. */
export function serverNow() {
  return Date.now() + offset;
}

/** Ask our own origin the time once (a HEAD of the page), when a call is close. */
export function syncServerClock() {
  if (syncing || typeof fetch !== "function" || typeof location === "undefined") return syncing;
  const sentAt = Date.now();
  syncing = fetch(`${location.origin}/app.html`, { method: "HEAD", cache: "no-store" })
    .then((response) => noteServerDate(response, sentAt))
    .catch(() => {});
  return syncing;
}
