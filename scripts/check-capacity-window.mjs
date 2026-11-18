#!/usr/bin/env node
/**
 * The quote's open capacity window: any readable dates are kept, units are
 * never required, and what cannot be read as dates is refused by reason.
 *
 *   npm run check:capacity-window
 *
 * Runs itself again in Los Angeles and on Kiritimati (UTC+14), because a
 * calendar day must stay the same day in every zone (see src/lib/dates.js).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  capacityWindowProblem,
  formatCapacityWindow,
  parseCapacityWindow,
} from "../src/lib/domain/capacity-window.mjs";

const ZONES = ["America/Los_Angeles", "Pacific/Kiritimati"];
if (!process.env.CAPACITY_WINDOW_ZONE_RUN) {
  for (const zone of ZONES) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: zone, CAPACITY_WINDOW_ZONE_RUN: "1" },
      encoding: "utf8",
    });
    if (run.status !== 0) {
      process.stdout.write(run.stdout);
      process.stderr.write(run.stderr);
      console.error(`check:capacity-window failed in ${zone}`);
      process.exit(1);
    }
  }
}

// Nov 18, 2026, local noon: the day this was written.
const NOW = new Date(2026, 10, 18, 12);

/** [typed, start, end, units] */
const KEPT = [
  // Month names, as before
  ["Dec 1 - Jan 15", "2026-12-01", "2027-01-15", null],
  ["Dec 1 - Jan 15 · 300 units", "2026-12-01", "2027-01-15", 300],
  ["1 Dec - 15 Jan", "2026-12-01", "2027-01-15", null],
  ["December 1st through January 15th", "2026-12-01", "2027-01-15", null],
  ["Dec 1 2026 – Jan 15 2027", "2026-12-01", "2027-01-15", null],
  ["Dec 1, 2026 to Jan 15, 2027", "2026-12-01", "2027-01-15", null],
  ["Dec 1-15", "2026-12-01", "2026-12-15", null],
  ["Dec 1 - 15", "2026-12-01", "2026-12-15", null],
  ["Sept 3 - Oct 30, 2027", "2027-09-03", "2027-10-30", null],
  ["from Dec 1", "2026-12-01", null, null],
  ["Dec 20 - Jan 15, 2027", "2026-12-20", "2027-01-15", null],
  ["Jan 5 - Mar 1, 2027 · 300 units", "2027-01-05", "2027-03-01", 300],
  // Day ranges written day first
  ["1-15 Dec", "2026-12-01", "2026-12-15", null],
  ["1st - 15th December", "2026-12-01", "2026-12-15", null],
  ["15th of December 2026 - 10th of January", "2026-12-15", "2027-01-10", null],
  // Dots: day first
  ["1.12–15.1", "2026-12-01", "2027-01-15", null],
  ["1.12 - 15.1", "2026-12-01", "2027-01-15", null],
  ["01.12.2026 - 15.01.2027", "2026-12-01", "2027-01-15", null],
  ["1.12.26 - 15.1.27", "2026-12-01", "2027-01-15", null],
  // Slashes: month first, day first when that is the only reading
  ["12/1 - 1/15", "2026-12-01", "2027-01-15", null],
  ["12/01/2026-01/15/2027", "2026-12-01", "2027-01-15", null],
  ["15/12 - 20/1", "2026-12-15", "2027-01-20", null],
  // Year first, any separator
  ["2026-12-01 to 2027-01-15", "2026-12-01", "2027-01-15", null],
  ["2026/12/01 - 2027/01/15", "2026-12-01", "2027-01-15", null],
  ["2026.12.1 - 2027.1.15", "2026-12-01", "2027-01-15", null],
  ["2026-12-01-2027-01-15", "2026-12-01", "2027-01-15", null],
  // Dashes with a year: day first
  ["1-12-2026 - 15-1-2027", "2026-12-01", "2027-01-15", null],
  // Whole months and quarters
  ["December", "2026-12-01", "2026-12-31", null],
  ["December 2026", "2026-12-01", "2026-12-31", null],
  ["Dec - Jan", "2026-12-01", "2027-01-31", null],
  ["Dec 2026 - Feb 2027", "2026-12-01", "2027-02-28", null],
  ["Jan - Mar 2027", "2027-01-01", "2027-03-31", null],
  ["Feb 2028", "2028-02-01", "2028-02-29", null],
  ["Q1 2027", "2027-01-01", "2027-03-31", null],
  ["Dec 1 - Jan", "2026-12-01", "2027-01-31", null],
  // Units, any way they are written, never required
  ["Dec 1 - Jan 15, 420 pcs", "2026-12-01", "2027-01-15", 420],
  ["1.12-15.1 1,200 pieces", "2026-12-01", "2027-01-15", 1200],
  ["Dec 2026 · 500 units", "2026-12-01", "2026-12-31", 500],
  // Chinese keyboards
  ["12月1日至1月15日", "2026-12-01", "2027-01-15", null],
  ["2026年12月1日-2027年1月15日 300件", "2026-12-01", "2027-01-15", 300],
  ["8月12日至30日", null, null, null], // August 2026 has passed: refused below
  ["2026年12月", "2026-12-01", "2026-12-31", null],
  ["12月-1月", "2026-12-01", "2027-01-31", null],
  ["１２/１ - １/１５", "2026-12-01", "2027-01-15", null],
  ["12月12日-1月3日，４２０件", "2026-12-12", "2027-01-03", 420],
  ["Dec 1 - Jan 15 · 2027 units", "2026-12-01", "2027-01-15", 2027],
  // Joining words
  ["Available Dec 1 until Jan 15", "2026-12-01", "2027-01-15", null],
  ["between Dec 1 and Jan 15", "2026-12-01", "2027-01-15", null],
  ["Dec 1 till Jan 15", "2026-12-01", "2027-01-15", null],
].filter(([, start]) => start);

/** [typed, reason] */
const REFUSED = [
  ["", "format"],
  ["   ", "format"],
  ["asap", "format"],
  ["TBD", "format"],
  ["Week 49 - 52", "format"],
  ["300 units", "format"],
  ["12-1", "format"],
  ["12-1 - 1-15", "format"],
  ["138 0013 8000", "format"],
  ["Dec 1 - Jan 15 call me", "words"],
  ["Aug 12-30 · partner confirmed", "words"],
  ["early December", "words"],
  ["the market is open in Dec", "words"],
  ["Dec 1, Dec 15 and Jan 15", "many"],
  ["Dec 1 - Jan 15 · 300 units · 400 units", "many"],
  ["Feb 30 - Mar 15", "invalid"],
  ["Feb 29 2027 - Mar 15 2027", "invalid"],
  ["13/13/2026", "invalid"],
  ["31.4 - 15.5.2027", "invalid"],
  ["0.12 - 15.1", "invalid"],
  ["2026-13-01 - 2027-01-15", "invalid"],
  ["Dec 32", "invalid"],
  ["Dec 1 2020 - Jan 15 2021", "past"],
  ["Jan 5 - Mar 1", "past"],
  ["8月12日至30日", "past"],
  ["Q5 2027", "format"],
];

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`  ✗ ${message}`);
};

for (const [typed, start, end, units] of KEPT) {
  const problem = capacityWindowProblem(typed, NOW);
  if (problem) fail(`${JSON.stringify(typed)} refused as ${problem.code}; it should be kept`);
  const got = parseCapacityWindow(typed, NOW);
  const want = { capacity_window_start: start, capacity_window_end: end, capacity_window_units: units };
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${JSON.stringify(typed)} read as ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    continue;
  }
  // What the vendor sees back is kept again, unchanged: reopening a draft and
  // saving it moves nothing.
  const shown = formatCapacityWindow(got, NOW);
  const again = parseCapacityWindow(shown, NOW);
  if (capacityWindowProblem(shown, NOW) || JSON.stringify(again) !== JSON.stringify(want)) {
    fail(`${JSON.stringify(typed)} reads back as ${JSON.stringify(shown)}, which is not the same window`);
  }
}

for (const [typed, reason] of REFUSED) {
  const problem = capacityWindowProblem(typed, NOW);
  if (problem?.code !== reason) fail(`${JSON.stringify(typed)} gave ${problem?.code ?? "no refusal"}, not ${reason}`);
}
// The refused piece is named, so the sentence says what to fix.
if (capacityWindowProblem("Feb 30 - Mar 15", NOW)?.piece !== "Feb 30") fail("an impossible day names the piece typed");

/** [stored, shown] */
const SHOWN = [
  [{ capacity_window_start: "2026-12-01", capacity_window_end: "2027-01-15" }, "Dec 1 - Jan 15, 2027"],
  [{ capacity_window_start: "2026-12-01", capacity_window_end: "2026-12-31" }, "Dec 2026"],
  [{ capacity_window_start: "2026-12-01", capacity_window_end: "2027-01-31" }, "Dec 2026 - Jan 2027"],
  [{ capacity_window_start: "2026-12-01", capacity_window_end: "2026-12-15", capacity_window_units: 300 }, "Dec 1 - Dec 15 · 300 units"],
  [{ capacity_window_start: "2026-12-01", capacity_window_end: null }, "Dec 1"],
  [{ capacity_window_start: null, capacity_window_end: null }, ""],
];
for (const [stored, shown] of SHOWN) {
  const got = formatCapacityWindow(stored, NOW);
  if (got !== shown) fail(`${JSON.stringify(stored)} shown as ${JSON.stringify(got)}, not ${JSON.stringify(shown)}`);
}

const zone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
if (failures) {
  console.error(`check:capacity-window: ${failures} failure(s) in ${zone}`);
  process.exit(1);
}
if (!process.env.CAPACITY_WINDOW_ZONE_RUN) {
  console.log(`check:capacity-window: ${KEPT.length} kept, ${REFUSED.length} refused, ${SHOWN.length} read-backs, in ${[zone, ...ZONES].join(", ")}`);
}
