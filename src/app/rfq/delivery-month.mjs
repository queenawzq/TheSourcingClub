/**
 * A month from "Sample in August, bulk by late September".
 *
 * The design asks for a timeline in prose; capacity matching needs the first
 * of a month. Read when a month name is in there, null when it is not:
 * matching without a delivery month is weaker, but a guessed month is wrong in
 * a way nobody sees. A month with no year is the next one: "by April", written
 * in November, is not last April. This month counts as this year.
 */
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

export function deliveryMonthFrom(text, today = new Date()) {
  const lower = String(text ?? "").toLowerCase();
  let found = -1;
  let at = Infinity;
  MONTHS.forEach((name, index) => {
    const position = lower.lastIndexOf(name);
    if (position >= 0 && position <= at) { at = position; found = index; }
  });
  if (found < 0) return null;
  const written = Number((lower.match(/\b(20\d{2})\b/) ?? [])[1]);
  const year = written || today.getFullYear() + (found < today.getMonth() ? 1 : 0);
  return `${year}-${String(found + 1).padStart(2, "0")}-01`;
}
