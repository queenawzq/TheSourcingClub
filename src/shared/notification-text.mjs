import { zhDay, zhMoment, zhNotificationBody, zhNotificationTitle } from "./notification-zh.mjs";

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
 * @param options       { timeZone?: IANA zone (default: the runtime's), withZone?: add "GMT+8",
 *                        locale?: the reader's `user_profiles.locale` ("zh" says it in Chinese,
 *                        from src/shared/notification-zh.mjs) }
 */
export function notificationBody(notification, { timeZone, withZone = false, locale = "en" } = {}) {
  const body = String(notification?.body ?? "");
  const data = notification?.data ?? {};
  const zh = locale === "zh";
  const moment = (iso) => formatMoment(iso, timeZone, withZone, zh);

  // A message in the reader's language: `body` is the English the bell
  // shows, data.message_text both languages when it was translated.
  if (data.message_text?.[locale]) return String(data.message_text[locale]);

  // A Chinese reader: the database's sentences in Chinese, dates in the
  // reader's zone; English, whole, when a sentence is not one we know.
  if (zh) {
    if (data.starts_at && String(notification?.kind ?? "").startsWith("call_")) {
      const when = moment(data.starts_at);
      if (when) return body ? `${body} · ${when}` : when;
    }
    const deadline = data.quote_deadline ? moment(data.quote_deadline) : null;
    const translated = zhNotificationBody(notification, deadline ? { deadline } : {});
    if (translated != null) return translated;
  }

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
 * @param options       { timeZone?: IANA zone (default: the runtime's), now?: Date, locale?: "en" | "zh" }
 */
export function notificationTitle(notification, { timeZone, now = new Date(), locale = "en" } = {}) {
  const zh = locale === "zh";
  const title = String(notification?.title ?? "");
  const due = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(notification?.data?.due_on ?? ""));
  const stem = / is due (?:today|tomorrow|in \d+ days)$/.exec(title);
  const stored = zh ? zhNotificationTitle(notification) ?? title : title;
  if (notification?.kind !== "milestone_due_soon" || !due || !stem) return stored;
  const today = calendarDay(now, timeZone);
  if (!today) return stored;
  const days = Math.round((Date.UTC(+due[1], +due[2] - 1, +due[3]) - today) / 86400000);
  if (zh) {
    const step = title.slice(0, stem.index).replace(/^"(.*)"$/, "“$1”");
    const when = days < 0 ? `已于 ${zhDay(notification.data.due_on)} 到期`
      : days === 0 ? "今天到期" : days === 1 ? "明天到期" : `${days} 天后到期`;
    return `${step}${when}`;
  }
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
function formatMoment(iso, timeZone, withZone, zh = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (zh) return zhMoment(date, timeZone, withZone);
  const options = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (withZone) options.timeZoneName = "short";
  const language = "en-US";
  try {
    return new Intl.DateTimeFormat(language, { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    // An unknown zone name: say it in UTC rather than not at all.
    return new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" }).format(date);
  }
}
