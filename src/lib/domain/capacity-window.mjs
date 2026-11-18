/**
 * A quote's capacity window, typed however the vendor writes dates.
 *
 * The designed quote form writes the window as prose where the schema keeps
 * two dates and an optional count. Any readable dates are accepted ("Dec 1 -
 * Jan 15", "1.12–15.1", "12/1 - 1/15", "2026/12/01", "1-15 Dec", "Dec 2026",
 * "Q1 2027", "12月1日至1月15日"); units are read when written and never
 * required. Same rule as the payment split and the incoterm: what parses is
 * stored, and what does not is refused in words, never dropped or guessed.
 *
 * Numbers: dots are day first (1.12 = Dec 1), slashes month first (12/1 =
 * Dec 1), dashes with a year day first; either swaps when only the other
 * order is a real date (15/1 = Jan 15). A bare "12-1" could be a day range,
 * so it is refused. Review shows the vendor how its text was read.
 *
 * Pure: no database import, so `npm run check:capacity-window` runs it.
 */
import { dateFrom } from "../dates.js";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = MONTHS.map((month) => month[0].toUpperCase() + month.slice(1));
// Real spellings only: "mar[a-z]*" read "market" as March.
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\\.?";
const ORDINAL = "(?:st|nd|rd|th)?";
// A year is only a year when it looks like one and is not a quantity.
const YEAR = "(?:,?\\s*((?:19|20)\\d{2})(?!\\d|\\s*(?:units?|pcs|pieces?)))?";
const RANGE = "\\s*[-–—]\\s*";

/** Each way of writing a date, tried in this order at every position. */
const PATTERNS = [
  // 2026-12-01, 2026/12/1, 2026.12.01
  { kind: "ymd", source: "\\b(\\d{4})([-/.])(\\d{1,2})\\R2(\\d{1,2})(?!\\d)" },
  // 1.12.2026, 12/1/2026, 1-12-26
  { kind: "numeric-year", source: "\\b(\\d{1,2})([-/.])(\\d{1,2})\\R2(\\d{4}|\\d{2})(?!\\d)" },
  // 1.12, 12/1 (never a dash: "1-15" is a day range)
  { kind: "numeric", source: "\\b(\\d{1,2})([/.])(\\d{1,2})(?![\\d/.])" },
  // Dec 1, Dec 1-15, Dec 1st, 2026 (a second day only when no month follows it)
  { kind: "month-day", source: `\\b${MONTH}\\s*(\\d{1,2})(?!\\d)${ORDINAL}(?:${RANGE}(\\d{1,2})(?![\\d:])${ORDINAL}(?!\\s*(?:of\\s+)?${MONTH}))?${YEAR}` },
  // 1 Dec, 1-15 Dec, 15th of December 2026
  { kind: "day-month", source: `\\b(\\d{1,2})${ORDINAL}(?:${RANGE}(\\d{1,2})${ORDINAL})?\\s*(?:of\\s+)?${MONTH}${YEAR}` },
  // Q1 2027
  { kind: "quarter", source: "\\bq([1-4])(?:,?\\s*((?:19|20)\\d{2}))?(?!\\d)" },
  // December, Dec 2026
  { kind: "month", source: `\\b${MONTH}${YEAR}` },
];
// "\\R2" is "the same as this pattern's second group", renumbered once the
// patterns are joined into one expression.
const GROUPS = PATTERNS.map(({ source }) => new RegExp(`${source.replace(/\\R(\d)/g, "\\$1")}|`).exec("").length - 1);
const DATES = new RegExp(
  PATTERNS.map(({ source }, i) => {
    const offset = 1 + i + GROUPS.slice(0, i).reduce((total, count) => total + count, 0);
    return `(${source.replace(/\\R(\d)/g, (_, k) => `\\${offset + Number(k)}`)})`;
  }).join("|"),
  "gi",
);

const UNITS = /(\d[\d,]*)\s*(?:units?|pcs\.?|pieces?)(?![a-z])/gi;
/** What may sit between the dates: separators and joining words, nothing else. */
const JOINERS = /\b(?:from|and|between|starting|start|open|available)\b|[-–—~·•,;:/()|.\s]/gi;

/**
 * Chinese keyboards, into the form the parser reads: full-width digits and
 * punctuation, 2027年1月5日, 8月12日至30日, 2026年12月, 300件. Joining words
 * become one dash.
 */
export function normalizeWindow(text) {
  const monthName = (month) => MONTH_NAMES[Number(month) - 1] ?? "?";
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]?/g, (_, year, month, day) => `${monthName(month)} ${day}, ${year}`)
    .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]?\s*(?:至|到|[-–—~])\s*(\d{1,2})\s*[日号號]/g, (_, month, a, b) => `${monthName(month)} ${a}-${b}`)
    .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]?/g, (_, month, day) => `${monthName(month)} ${day}`)
    .replace(/(\d{4})\s*年\s*(\d{1,2})\s*月(?:份)?/g, (_, year, month) => `${monthName(month)} ${year}`)
    .replace(/(\d{1,2})\s*月(?:份)?/g, (_, month) => `${monthName(month)}`)
    .replace(/(\d[\d,]*)\s*(?:件|个|個|套)/g, "$1 units")
    .replace(/\s*(?:至|到|~)\s*|\s+(?:to|until|till|through|thru)\s+/gi, " - ")
    .replace(/[，、；。]/g, " ")
    .trim();
}

const monthIndex = (name) => MONTHS.indexOf(String(name).slice(0, 3).toLowerCase());
const fullYear = (text) => (text == null ? null : text.length === 2 ? 2000 + Number(text) : Number(text));
const isReal = (year, month, day) => {
  if (!(month >= 0 && month <= 11) || !(day >= 1)) return false;
  const at = new Date(year ?? 2000, month, day);
  return at.getMonth() === month && at.getDate() === day;
};
const lastDay = (year, month) => new Date(year, month + 1, 0).getDate();

/**
 * Day then month, or month then day, whichever the separator prefers; the
 * other order only when the preferred one is not a date and the other is.
 */
function numericDay(first, second, separator, year, swap = true) {
  const [a, b] = [Number(first), Number(second)];
  const [day, month] = separator === "/" ? [b, a] : [a, b];
  if (isReal(year, month - 1, day)) return { day, month: month - 1 };
  if (swap && isReal(year, day - 1, month)) return { day: month, month: day - 1 };
  return { day, month: month - 1 };
}

/**
 * The dates written, in order, each `{ year, month, day, text }` with `year`
 * null where it was left off and `day` null for a whole month.
 */
function readDates(said) {
  const points = [];
  for (const match of said.matchAll(DATES)) {
    let offset = 1;
    const index = PATTERNS.findIndex((_, i) => {
      const found = match[offset] !== undefined;
      if (!found) offset += GROUPS[i] + 1;
      return found;
    });
    const g = match.slice(offset + 1, offset + 1 + GROUPS[index]);
    const text = match[0].trim();
    switch (PATTERNS[index].kind) {
      case "ymd": {
        const year = Number(g[0]);
        points.push({ year, ...numericDay(g[3], g[2], ".", year, false), text });
        break;
      }
      case "numeric-year": {
        const year = fullYear(g[3]);
        points.push({ year, ...numericDay(g[0], g[2], g[1], year), text });
        break;
      }
      case "numeric":
        points.push({ year: null, ...numericDay(g[0], g[2], g[1], null), text });
        break;
      case "month-day": {
        const year = fullYear(g[4]);
        const month = monthIndex(g[0]);
        points.push({ year, month, day: Number(g[1]), text });
        if (g[2]) points.push({ year, month, day: Number(g[2]), text });
        break;
      }
      case "day-month": {
        const year = fullYear(g[3]);
        const month = monthIndex(g[2]);
        points.push({ year, month, day: Number(g[0]), text });
        if (g[1]) points.push({ year, month, day: Number(g[1]), text });
        break;
      }
      case "quarter": {
        const year = fullYear(g[1]);
        const first = (Number(g[0]) - 1) * 3;
        points.push({ year, month: first, day: null, text }, { year, month: first + 2, day: null, text });
        break;
      }
      default:
        points.push({ year: fullYear(g[1]), month: monthIndex(g[0]), day: null, text });
    }
  }
  return points;
}

const calendarDay = ({ year, month, day }) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const todayOf = (now) => calendarDay({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() });

/**
 * Everything the text says, read once: the two days, the units, and why it
 * cannot be kept (null when it can).
 */
function read(text, now) {
  const said = normalizeWindow(text);
  const empty = { start: null, end: null, units: null };
  if (!said) return { ...empty, problem: { code: "format" } };

  // Dates first, then units from what is left: "1月3日，420件" is "Jan 3,420
  // units", and the 3 is the day.
  const points = readDates(said);
  const withoutDates = said.replace(DATES, " ");
  const unitMatches = [...withoutDates.matchAll(UNITS)];
  const units = unitMatches.length ? Number(unitMatches[0][1].replace(/,/g, "")) : null;
  const leftover = withoutDates.replace(UNITS, " ").replace(JOINERS, "");

  const refuse = (problem) => ({ ...empty, units, problem });
  if (!points.length || /\d/.test(leftover)) return refuse({ code: "format" });
  if (leftover) return refuse({ code: "words" });
  if (points.length > 2 || unitMatches.length > 1) return refuse({ code: "many" });
  const impossible = points.find((point) => point.day != null && !isReal(point.year, point.month, point.day));
  if (impossible) return refuse({ code: "invalid", piece: impossible.text });

  // One whole month is its own first and last day.
  let [start, end] = points;
  if (!end && start.day == null) end = start;
  const startYearWritten = start.year != null;
  const endYearWritten = end ? end.year != null : false;

  // A missing year is the year of the other date, or this year. An end that
  // would fall before its start is in the next year ("Dec 20 - Jan 15"); two
  // dates both given a year are put in order.
  if (start.year == null) start = { ...start, year: end?.year ?? now.getFullYear() };
  if (end && end.year == null) end = { ...end, year: start.year };
  const first = (point) => ({ ...point, day: point.day ?? 1 });
  const last = (point) => ({ ...point, day: point.day ?? lastDay(point.year, point.month) });
  if (end && end !== start) {
    const before = calendarDay(last(end)) < calendarDay(first(start));
    if (before && !endYearWritten) end = { ...end, year: end.year + 1 };
    else if (before && !startYearWritten) start = { ...start, year: start.year - 1 };
    else if (before) [start, end] = [end, start];
  }
  // Feb 29 is real only in a leap year, which is known only now.
  for (const point of [start, end].filter(Boolean)) {
    if (point.day != null && !isReal(point.year, point.month, point.day)) return refuse({ code: "invalid", piece: point.text });
  }

  const startDay = calendarDay(first(start));
  const endDay = end ? calendarDay(last(end)) : null;
  if ((endDay ?? startDay) < todayOf(now)) return { start: startDay, end: endDay, units, problem: { code: "past" } };
  return { start: startDay, end: endDay, units, problem: null };
}

/**
 * The window as the columns keep it. What does not parse stores nothing; the
 * form refuses it first (capacityWindowProblem), so nothing is lost unsaid.
 */
export function parseCapacityWindow(text, now = new Date()) {
  const { start, end, units, problem } = read(text, now);
  const kept = !problem || problem.code === "past";
  return {
    capacity_window_start: kept ? start : null,
    capacity_window_end: kept ? end : null,
    capacity_window_units: kept ? units : null,
  };
}

/**
 * Why this window cannot be kept as typed, or null when it can:
 * `{ code: "format" | "words" | "many" | "invalid" | "past", piece? }`.
 * "words": text besides dates and units, which would be dropped. "past": with
 * no year written, "Jan 5 - Mar 1" in November means this year's, which is not
 * what the vendor meant, so it is refused rather than guessed forward.
 */
export function capacityWindowProblem(text, now = new Date()) {
  return read(text, now).problem;
}

/**
 * The window read back. Whole months read as months with their year ("Dec
 * 2026", "Dec 2026 - Jan 2027"); days as "Dec 1 - Jan 15", a day outside this
 * year carrying its year, so saving the form again reads back the same days.
 */
export function formatCapacityWindow(quote, now = new Date()) {
  if (!quote) return "";
  const start = dateFrom(quote.capacity_window_start);
  const end = dateFrom(quote.capacity_window_end);
  const units = quote.capacity_window_units ? `${quote.capacity_window_units} units` : "";
  const wholeMonths = start && end && start.getDate() === 1
    && end.getDate() === lastDay(end.getFullYear(), end.getMonth());
  const monthOf = (at) => `${MONTH_NAMES[at.getMonth()]} ${at.getFullYear()}`;
  const day = (at) => at.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  const span = wholeMonths
    ? [...new Set([monthOf(start), monthOf(end)])].join(" - ")
    : [start, end].filter(Boolean).map(day).join(" - ");
  return [span, units].filter(Boolean).join(" · ");
}
