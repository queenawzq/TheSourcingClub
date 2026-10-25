/**
 * Fail the build when a calendar date is read as an instant.
 *
 * `new Date("2026-10-26")` is midnight UTC: Oct 25 anywhere west of
 * Greenwich. A step due on the 26th was shown due on the 25th to everyone in
 * the Americas, while its reminder (written by the database) said the 26th.
 * Nothing about that looks broken on a machine east of Greenwich.
 *
 * Two checks:
 * 1. The screens' own formatters, run in zones behind UTC (New York, Los
 *    Angeles) and ahead of it (Shanghai, Kiritimati at UTC+14), must say the
 *    stored day, and a reminder's "due in N days" must count from the
 *    reader's own day, not the UTC day the daily job ran on. This process
 *    runs each zone as a child, since a zone is fixed per process.
 * 2. A guard: in src/app, src/lib and src/shared, a one-argument
 *    `new Date(…)` or `Date.parse(…)` of anything named after a `date` column
 *    fails. The names come from the migrations, so a new date column is
 *    covered without editing this file. Read it with dateFrom()
 *    (src/lib/dates.js) instead.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ZONES = ["America/New_York", "America/Los_Angeles", "Asia/Shanghai", "Pacific/Kiritimati"];
const zone = process.env.CHECK_DATES_ZONE;

if (!zone) {
  const problems = guard();
  for (const each of ZONES) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: each, CHECK_DATES_ZONE: each },
      encoding: "utf8",
    });
    process.stdout.write(run.stdout);
    if (run.status !== 0) problems.push(`${each}: the screens misread a calendar date\n${run.stderr}`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} date problem${problems.length === 1 ? "" : "s"}. A date column is a day, not an instant: read it with dateFrom() from src/lib/dates.js.\n`);
    for (const problem of problems) console.error("  " + problem);
    console.error("");
    process.exit(1);
  }
  console.log("dates: every calendar date reads as its own day");
} else {
  await formatters();
}

/** The `date` columns, from every migration, with their camelCase forms. */
function dateColumns() {
  const names = new Set();
  for (const file of readdirSync("supabase/migrations")) {
    const sql = readFileSync(join("supabase/migrations", file), "utf8");
    for (const match of sql.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+date\b(?!\s*\()/gim)) names.add(match[1].toLowerCase());
    for (const match of sql.matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)\s+date\b/gi)) names.add(match[1].toLowerCase());
  }
  // A generic word is not evidence of a date column ("month" is also a loop
  // variable); the capacity months are UTC month starts, built from numbers.
  names.delete("month");
  for (const name of [...names]) names.add(name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()));
  return names;
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(m?js|jsx)$/.test(path) ? [path] : [];
  });
}

/** The argument of a call starting at `open` (the "("), or null if it has a comma at depth 0. */
function singleArgument(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    } else if (char === "," && depth === 1) return null;
  }
  return null;
}

function guard() {
  const columns = dateColumns();
  const problems = [];
  for (const file of ["src/app", "src/lib", "src/shared"].flatMap(sourceFiles)) {
    if (file === join("src", "lib", "dates.js")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bnew Date\(|\bDate\.parse\(/g)) {
      const argument = singleArgument(source, match.index + match[0].length - 1);
      if (!argument) continue;
      const named = argument.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.find((word) => columns.has(word) || columns.has(word.toLowerCase()));
      if (!named) continue;
      const line = source.slice(0, match.index).split("\n").length;
      problems.push(`${relative(process.cwd(), file)}:${line}  ${match[0]}${argument.trim()}) reads the date column ${named} as an instant`);
    }
  }
  return problems;
}

/** Run inside one zone: the stored day must come out of every screen's formatter. */
async function formatters() {
  const { createServer } = await import("vite");
  const server = await createServer({ logLevel: "silent", server: { middlewareMode: true, hmr: false }, appType: "custom" });
  const failures = [];
  const expect = (what, actual, wanted) => {
    if (actual !== wanted) failures.push(`${what}: ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`);
  };
  try {
    const load = (path) => server.ssrLoadModule(path);
    const { dateFrom } = await load("/src/lib/dates.js");
    const { day } = await load("/src/app/order/order-view.js");
    const { toProjectCard } = await load("/src/app/live-adapter.js");
    const { brandPaymentsView } = await load("/src/app/payments/brand-payments-view.js");
    const { validUntilOf } = await load("/src/app/quote/quote-view.js");
    const { formatCapacityWindow } = await load("/src/lib/domain/quote.js");
    const { notificationTitle } = await load("/src/shared/notification-text.mjs");

    const calendar = dateFrom("2026-10-26");
    expect("dateFrom day", [calendar.getFullYear(), calendar.getMonth(), calendar.getDate()].join("-"), "2026-9-26");
    // An instant stays an instant: 03:00 UTC is still the 25th in New York.
    expect("dateFrom instant", dateFrom("2026-10-26T03:00:00Z").getTime(), Date.UTC(2026, 9, 26, 3));
    expect("dateFrom nothing", dateFrom(""), null);
    expect("dateFrom unreadable", dateFrom("soon"), null);

    expect("order page: due day", day("2026-10-26"), "Oct 26");
    expect("order card: next due", toProjectCard({
      id: "o", status: "active", order_number: "TSC-1", created_at: "2026-10-01T12:00:00Z", next_payment_due_on: "2026-10-26",
    }, false).nextDue, "Oct 26");
    expect("order card: step due", toProjectCard({
      id: "o", status: "active", order_number: "TSC-1", created_at: "2026-10-01T12:00:00Z",
      order_milestones: [{ id: "m", sort: 1, state: "active", due_on: "2026-11-01" }],
    }, false).nextDue, "Nov 1");

    const payments = brandPaymentsView({
      orders: [{ id: "o", status: "active", order_number: "TSC-1", factory: { name: "F" } }],
      payments: [{ id: "p", order_id: "o", state: "due", amount_cents: 100, currency: "USD", order_milestones: { title: "Deposit", sort: 1, due_on: "2026-10-26" } }],
    });
    expect("brand payments: due row", payments.rows?.[0]?.date, "Oct 26, 2026");

    expect("quote: valid until", validUntilOf({ valid_until: "2026-10-26" }), "Oct 26, 2026");
    expect("quote: capacity window",
      formatCapacityWindow({ capacity_window_start: "2026-11-01", capacity_window_end: "2026-11-30" }, new Date(2026, 9, 1)),
      "Nov 1 - Nov 30");

    // The daily job runs at 07:00 UTC and wrote "in 3 days" for a step due
    // Nov 5. It is still Nov 1 in Los Angeles, and the 2nd everywhere else.
    const reminder = (dueOn) => ({ kind: "milestone_due_soon", title: '"Fit sample" is due in 3 days', data: { due_on: dueOn } });
    const cron = new Date("2026-11-02T07:00:00Z");
    const behind = zone === "America/Los_Angeles";
    expect("reminder: three days out", notificationTitle(reminder("2026-11-05"), { now: cron }),
      `"Fit sample" is due ${behind ? "in 4 days" : "in 3 days"}`);
    expect("reminder: the UTC day", notificationTitle(reminder("2026-11-02"), { now: cron }),
      `"Fit sample" is due ${behind ? "tomorrow" : "today"}`);
    // Run by hand at 20:00 UTC: tomorrow already in Shanghai and Kiritimati.
    const evening = new Date("2026-10-26T20:00:00Z");
    const ahead = ["Asia/Shanghai", "Pacific/Kiritimati"].includes(zone);
    expect("reminder: run in the evening", notificationTitle(reminder("2026-10-28"), { now: evening }),
      `"Fit sample" is due ${ahead ? "tomorrow" : "in 2 days"}`);
    expect("reminder: read after the day", notificationTitle(reminder("2026-10-20"), { now: evening }), '"Fit sample" was due Oct 20');
    expect("reminder: the email's zone", notificationTitle(reminder("2026-10-28"), { now: evening, timeZone: "UTC" }), '"Fit sample" is due in 2 days');
    expect("other titles kept", notificationTitle({ kind: "quote_received", title: "x is due in 3 days", data: { due_on: "2026-10-20" } }), "x is due in 3 days");
  } catch (failure) {
    failures.push(failure.stack ?? String(failure));
  } finally {
    await server.close();
  }
  if (failures.length) {
    for (const failure of failures) console.error(`    ${failure}`);
    process.exit(1);
  }
  console.log(`dates (${zone}): every formatter says the stored day`);
}
