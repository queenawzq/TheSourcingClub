/**
 * Reading the database's dates in the browser.
 *
 * A Postgres `date` column (`due_on`, `valid_until`, `target_delivery_month`,
 * a capacity window's ends) arrives as a bare "2026-10-26". JavaScript reads
 * that as midnight UTC, which is Oct 25 anywhere west of Greenwich, so a step
 * due on the 26th was shown due on the 25th in the Americas while its
 * reminder, written by the database, said the 26th.
 *
 * A calendar date is a day, not an instant: it is built here from its own
 * numbers, at local midnight, so it formats as the same day in every zone.
 * Every date-only value is read through dateFrom(); `npm run check:dates`
 * fails on one turned into a Date any other way.
 */

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A Date for a value from the database: a bare YYYY-MM-DD is that day at
 * local midnight; anything else (a timestamp, epoch ms, a Date) is the
 * instant it names. Null for nothing or something unreadable.
 */
export function dateFrom(value) {
  if (value == null || value === "") return null;
  const calendar = typeof value === "string" ? CALENDAR_DATE.exec(value) : null;
  const date = calendar
    ? new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
