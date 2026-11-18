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

/**
 * Words that name part of a period, the only words that may send a year-less
 * window the form reads as past to the model: "mid January" in November is
 * next January, while "Jan 5 - Mar 1 tentative" stays refused like "Jan 5 -
 * Mar 1" (the form never guesses a typed window forward).
 */
const PERIOD_WORD = /^(?:early|earlier|mid|middle|late|later|end|ending|beginning|begin|start|first|second|last|half|week|weeks|of|the|上旬|中旬|下旬|初|月初|中|下|上|底|月底|末|月末|半|前|后|後)$/i;

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

/** A number pair as a day, either way round. */
const asDay = ({ raw: [a, b] }, dayFirst) => (dayFirst ? { day: a, month: b - 1 } : { day: b, month: a - 1 });

/**
 * One order for every number pair in the window: the one each separator
 * prefers (dots and dashes day first, slashes month first), or the other one
 * when only that makes every date real. Deciding date by date read "12.1-12.31"
 * (Dec 1-31 written month first) as Jan 12 - Dec 31.
 */
function orient(points) {
  const pairs = points.filter((point) => point.raw);
  const fits = (dayFirst) => pairs.every((point) => {
    const { day, month } = asDay(point, dayFirst(point));
    return isReal(point.year, month, day);
  });
  const preferred = (point) => point.dayFirst;
  const other = (point) => !point.dayFirst;
  const choice = fits(preferred) ? preferred : fits(other) ? other : preferred;
  return points.map((point) => (point.raw ? { ...point, ...asDay(point, choice(point)) } : point));
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
        points.push({ year, month: Number(g[2]) - 1, day: Number(g[3]), text });
        break;
      }
      case "numeric-year": {
        const year = fullYear(g[3]);
        points.push({ year, raw: [Number(g[0]), Number(g[2])], dayFirst: g[1] !== "/", text });
        break;
      }
      case "numeric":
        points.push({ year: null, raw: [Number(g[0]), Number(g[2])], dayFirst: g[1] !== "/", text });
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
  return orient(points);
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
  // Words beside the dates are checked last: a window that is wrong whatever
  // the words (past, backwards, an impossible day) keeps its own sentence, so
  // adding "approx" never sends it to the model to be guessed forward.
  if (points.length > 2 || unitMatches.length > 1) return refuse({ code: "many" });
  const impossible = points.find((point) => point.day != null && !isReal(point.year, point.month, point.day));
  if (impossible) return refuse({ code: "invalid", piece: impossible.text });

  // One whole month is its own first and last day.
  let [start, end] = points;
  if (!end && start.day == null) end = start;
  const startYearWritten = start.year != null;
  const endYearWritten = end ? end.year != null : false;

  // A missing year is the year of the other date, or this year. An end that
  // would fall before its start is in the next year ("Dec 20 - Jan 15"). Two
  // dates both given a year and written backwards are refused, not reordered:
  // "Dec 1 2026 - Jan 15 2026" is a mistyped year, not an 11-month window.
  if (start.year == null) start = { ...start, year: end?.year ?? now.getFullYear() };
  if (end && end.year == null) end = { ...end, year: start.year };
  const first = (point) => ({ ...point, day: point.day ?? 1 });
  const last = (point) => ({ ...point, day: point.day ?? lastDay(point.year, point.month) });
  if (end && end !== start) {
    const before = calendarDay(last(end)) < calendarDay(first(start));
    if (before && !endYearWritten) end = { ...end, year: end.year + 1 };
    else if (before && !startYearWritten) start = { ...start, year: start.year - 1 };
    else if (before) return refuse({ code: "order" });
  }
  // Feb 29 is real only in a leap year, which is known only now.
  for (const point of [start, end].filter(Boolean)) {
    if (point.day != null && !isReal(point.year, point.month, point.day)) return refuse({ code: "invalid", piece: point.text });
  }

  const startDay = calendarDay(first(start));
  const endDay = end ? calendarDay(last(end)) : null;
  // At most 12 months, up to the same day a year on. A longer window is
  // almost always a misread year: "12.1.2026 - 15.1.2027" read day first is
  // Jan 12, 2026 - Jan 15, 2027. A window already open is kept ("Nov 1 -
  // Jan 15" in November: capacity open now).
  if (endDay) {
    const from = first(start);
    const yearOn = new Date(from.year + 1, from.month, from.day);
    const limit = calendarDay({ year: yearOn.getFullYear(), month: yearOn.getMonth(), day: yearOn.getDate() });
    if (endDay > limit) return refuse({ code: "long" });
  }
  if ((endDay ?? startDay) < todayOf(now)) {
    const yearWritten = startYearWritten || endYearWritten;
    // Words naming part of a period on a year-less window: the model, told
    // today's date, reads the next one ("early Jan to end Feb", "1月中旬").
    const words = withoutDates.replace(UNITS, " ").match(/[a-z]+|[\u3400-\u9fff]+/gi) ?? [];
    const vague = !yearWritten && words.length > 0
      && words.every((word) => PERIOD_WORD.test(word) || /^(?:from|and|between|to|until|till|through|thru)$/i.test(word))
      && words.some((word) => PERIOD_WORD.test(word) && !/^(?:of|the)$/i.test(word));
    return { start: startDay, end: endDay, units, problem: { code: "past", yearWritten, ...(vague ? { vague: true } : {}) } };
  }
  if (leftover) return refuse({ code: "words" });
  return { start: startDay, end: endDay, units, problem: null };
}

/**
 * The window as the columns keep it. What does not parse stores nothing; the
 * form refuses it first (capacityWindowProblem), so nothing is lost unsaid.
 */
export function parseCapacityWindow(text, now = new Date()) {
  const { start, end, units, problem } = read(text, now);
  // A window already over is not kept either: the form says so when it saves.
  const kept = !problem;
  return {
    capacity_window_start: kept ? start : null,
    capacity_window_end: kept ? end : null,
    capacity_window_units: kept ? units : null,
  };
}

/**
 * Why this window cannot be kept as typed, or null when it can:
 * `{ code: "format" | "words" | "many" | "invalid" | "order" | "long" | "past", piece?, yearWritten? }`.
 * "words": text besides dates and units, which would be dropped. "past": with
 * no year written, "Jan 5 - Mar 1" in November means this year's, which is not
 * what the vendor meant, so it is refused rather than guessed forward.
 */
export function capacityWindowProblem(text, now = new Date()) {
  return read(text, now).problem;
}

/**
 * The window read back. Whole months read as months with their year ("Dec
 * 2026", "Dec 2026 - Jan 2027"); days as "Dec 1 - Dec 15", each day carrying
 * its year when it is not this year or the window crosses a year ("Dec 1, 2026
 * - Jan 15, 2027"), so saving the form again reads back the same days.
 */
export function formatCapacityWindow(quote, now = new Date()) {
  if (!quote) return "";
  const start = dateFrom(quote.capacity_window_start);
  const end = dateFrom(quote.capacity_window_end);
  const units = quote.capacity_window_units != null ? `${quote.capacity_window_units} units` : "";
  const wholeMonths = start && end && start.getDate() === 1
    && end.getDate() === lastDay(end.getFullYear(), end.getMonth());
  const crossesYear = Boolean(start && end && start.getFullYear() !== end.getFullYear());
  const monthOf = (at) => `${MONTH_NAMES[at.getMonth()]} ${at.getFullYear()}`;
  const day = (at) => at.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    // Both ends carry their year when the window crosses one: "Jan 12 - Jan
    // 15, 2027" read back as a three-day window, and saved again it was one.
    ...(at.getFullYear() === now.getFullYear() && !crossesYear ? {} : { year: "numeric" }),
  });
  const span = wholeMonths
    ? [...new Set([monthOf(start), monthOf(end)])].join(" - ")
    : [start, end].filter(Boolean).map(day).join(" - ");
  return [span, units].filter(Boolean).join(" · ");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A window read by the model (api/parse-capacity-window.js), kept only when
 * it passes every rule a typed window does: real days, start before end, not
 * over, at most 12 months. It is read back through the parser itself, so the
 * two can never disagree. Returns `{ start, end }` (end null for one day) or
 * null for anything else: a made-up past date, a year-long guess, garbage.
 */
export function acceptModelWindow(answer, now = new Date()) {
  const start = typeof answer?.start === "string" ? answer.start.trim() : null;
  const end = typeof answer?.end === "string" && answer.end.trim() ? answer.end.trim() : null;
  if (!start || !ISO_DAY.test(start) || (end && !ISO_DAY.test(end))) return null;
  const typed = end && end !== start ? `${start} - ${end}` : start;
  const reading = read(typed, now);
  if (reading.problem || reading.start !== start || reading.end !== (end && end !== start ? end : null)) return null;
  // A guess may not start more than a year out ("2099-12-11" is a wrong
  // year, not a window); a vendor can still type a later one itself.
  const yearOn = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  if (reading.start > calendarDay({ year: yearOn.getFullYear(), month: yearOn.getMonth(), day: yearOn.getDate() })) return null;
  return { start: reading.start, end: reading.end };
}

/** Whether the parser's refusal is one the model may be asked about: no readable dates, or words beside them. */
export function windowNeedsReading(problem) {
  return problem?.code === "format" || problem?.code === "words" || (problem?.code === "past" && problem.vague === true);
}

/** The units written in a window, refused or not ("mid December · 300 units" → 300), so a reading keeps them. */
export function windowUnits(text) {
  return read(text, new Date()).units ?? null;
}
