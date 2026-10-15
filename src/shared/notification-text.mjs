/**
 * A notification's body with its dates in the reader's time zone.
 *
 * The database writes the body once, in UTC, and keeps the raw values in
 * `notifications.data` (a quote deadline, a call's start). The bell formats
 * them in the browser's zone; the email formats them in the recipient's saved
 * zone and names it. Rows without data keep their stored body.
 *
 * api/ keeps its own copy (scripts/generate-notification-email.mjs), because
 * Vercel builds api/ on its own; the smoke test checks the two agree.
 *
 * @param notification  { kind, body, data }
 * @param options       { timeZone?: IANA zone (default: the runtime's), withZone?: add "GMT+8" }
 */
export function notificationBody(notification, { timeZone, withZone = false } = {}) {
  const body = String(notification?.body ?? "");
  const data = notification?.data ?? {};
  const moment = (iso) => formatMoment(iso, timeZone, withZone);

  if (data.quote_deadline && /Quotes close [^.]*\./.test(body)) {
    const when = moment(data.quote_deadline);
    if (when) return body.replace(/Quotes close [^.]*\./, `Quotes close ${when}.`);
  }
  if (data.starts_at && String(notification?.kind ?? "").startsWith("call_")) {
    const when = moment(data.starts_at);
    if (when) return body ? `${body} · ${when}` : when;
  }
  return body;
}

/** "Fri, Nov 20, 4:00 AM", optionally with the zone; null for a bad value. */
function formatMoment(iso, timeZone, withZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (withZone) options.timeZoneName = "short";
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    // An unknown zone name: say it in UTC rather than not at all.
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}
