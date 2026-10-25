/**
 * A notification's body with its dates in the reader's time zone.
 *
 * The database writes the body once, in UTC, and keeps the raw values in
 * `notifications.data` (a quote deadline, a call's start). The bell formats
 * them in the browser's zone; the email formats them in the recipient's saved
 * zone and names it. Rows without data keep their stored body.
 *
 * notificationTitle() does the same for a step's due date: the daily job
 * counts "due in 3 days" on the UTC day it runs, which is the day before or
 * after in much of the world, and the words go stale in the bell. The reader's
 * own day and `data.due_on` decide them instead.
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

/**
 * A notification's title, with a step's "is due …" counted in calendar days
 * from the reader's today. Rows without a due date keep their stored title.
 *
 * @param notification  { kind, title, data }
 * @param options       { timeZone?: IANA zone (default: the runtime's), now?: Date }
 */
export function notificationTitle(notification, { timeZone, now = new Date() } = {}) {
  const title = String(notification?.title ?? "");
  const due = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(notification?.data?.due_on ?? ""));
  const stem = / is due (?:today|tomorrow|in \d+ days)$/.exec(title);
  if (notification?.kind !== "milestone_due_soon" || !due || !stem) return title;
  const today = calendarDay(now, timeZone);
  if (!today) return title;
  const days = Math.round((Date.UTC(+due[1], +due[2] - 1, +due[3]) - today) / 86400000);
  const words = days < 0
    ? `was due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(+due[1], +due[2] - 1, +due[3]))}`
    : `is due ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`;
  return `${title.slice(0, stem.index)} ${words}`;
}

/** The day `now` falls on in the zone, as UTC midnight of that date; null for a bad value. */
function calendarDay(now, timeZone) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  const options = { year: "numeric", month: "numeric", day: "numeric" };
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) }).formatToParts(date);
  } catch {
    // An unknown zone name: count from the UTC day rather than not at all.
    parts = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).formatToParts(date);
  }
  const part = (type) => Number(parts.find((each) => each.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
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
