/**
 * A month from "Sample in August, bulk by late September".
 *
 * The design asks for a timeline in prose; capacity matching needs the first
 * of a month. Read when a month name is in there, null when it is not:
 * matching without a delivery month is weaker, but a guessed month is wrong in
 * a way nobody sees. A month with no year is the next one: "by April", written
 * in November, is not last April. This month counts as this year.
 *
 * The LAST month named is the delivery: a timeline runs sample, then bulk, so
 * "Sample in August, bulk by late September" is delivered in September. The
 * first one was read before, and capacity was checked a month early. Whole
 * words only, so "may" in "we may need it by June" is not May.
 */
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

export function deliveryMonthFrom(text, today = new Date()) {
  const lower = String(text ?? "").toLowerCase();
  let found = -1;
  let at = -1;
  MONTHS.forEach((name, index) => {
    for (const match of lower.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
      if (match.index > at) { at = match.index; found = index; }
    }
  });
  if (found < 0) return null;
  const written = Number((lower.match(/\b(20\d{2})\b/) ?? [])[1]);
  const year = written || today.getFullYear() + (found < today.getMonth() ? 1 : 0);
  return `${year}-${String(found + 1).padStart(2, "0")}-01`;
}
