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
import { deliveryMonthFrom } from "../src/app/rfq/delivery-month.mjs";

// A month with no year is the next one, whenever it is written.
{
  const november = new Date(2026, 10, 7);
  const said = (text, today = november) => deliveryMonthFrom(text, today);
  const wrong = [
    [said("Delivery by April"), "2027-04-01"],
    [said("by November"), "2026-11-01"],
    [said("bulk by late December"), "2026-12-01"],
    [said("April 2028"), "2028-04-01"],
    [said("April 2026"), "2026-04-01"], // what was typed stays
    [said("Sample in August, bulk by late September"), "2027-09-01"], // the bulk month
    [said("Sample in December, bulk by February"), "2027-02-01"],
    [said("We may need it by June"), "2027-06-01"],
    [said("as soon as possible"), null],
    [said("by April", new Date(2027, 0, 15)), "2027-04-01"],
    [said("by January", new Date(2027, 0, 15)), "2027-01-01"],
  ].filter(([got, want]) => got !== want);
  if (wrong.length) {
    console.error(`dates: delivery months wrong: ${JSON.stringify(wrong)}`);
    process.exit(1);
  }
}

// A Chinese reader's notifications: every title the database and the server
// write, with their fixed bodies, one sample each (src/shared/notification-zh.mjs).
// `typed` marks a body someone wrote, which is shown as written.
const ZH_SAMPLES = [
  { kind: "team_member_joined", title: "Li Wei joined Ningbo Knit", body: "They accepted the invitation and can now work with the permissions it gave them." },
  { kind: "team_member_left", title: "Li Wei left Ningbo Knit", body: "Everything they worked on stays with the company. The invitation they sent was withdrawn." },
  { kind: "team_member_removed", title: "Li Wei no longer has access to Ningbo Knit", body: "Everything they worked on stays with the company. The 2 invitations they sent were withdrawn." },
  { kind: "order_activated", title: "TSC-1042 is under way", body: "The brand confirmed the production steps. The first step is open." },
  { kind: "credits_adjusted", title: "TSC added 100 credits", body: "Goodwill for the delay", typed: true },
  { kind: "credits_adjusted", title: "TSC removed 25 credits", body: "Refunded quote", typed: true },
  { kind: "verification_approved", title: "Your profile is verified", body: "" },
  { kind: "verification_declined", title: "We could not verify your profile", body: "The licence was unreadable.", typed: true },
  { kind: "verification_needs_information", title: "We need a little more information", body: "Please upload your licence.", typed: true },
  { kind: "verification_reopened", title: "Your legal name changed: TSC will verify it again", body: "" },
  { kind: "verification_reopened", title: "Your company name changed: TSC will verify it again", body: "" },
  { kind: "verification_reopened", title: "Your registration number changed: TSC will verify it again", body: "" },
  { kind: "order_completed", title: "TSC-1042 is complete", body: "Every step on this order is done." },
  { kind: "payment_due", title: "$1,284.00 is due on TSC-1042", body: '"Deposit". Fund it by card; TSC holds it until the step is done.' },
  { kind: "schedule_agreed", title: "The factory agreed the production steps on TSC-1042", body: "Confirm them and the order starts." },
  { kind: "schedule_updated", title: "The brand changed the production steps on TSC-1042", body: "Nothing starts until the brand confirms them. If something does not work for you, message the brand." },
  { kind: "schedule_updated", title: "The brand updated milestones on TSC-1042", body: "Review the updated production steps, payment amounts, and due dates." },
  { kind: "message", title: "Maison Rue messaged you about TSC-1042", body: "Can you send the lab dip?", data: { message_text: { en: "Can you send the lab dip?", zh: "你能寄送色样吗？" } } },
  { kind: "message", title: "Maison Rue messaged you about your request", body: "Hello", typed: true },
  { kind: "message_rejected", title: "Your message to Maison Rue about TSC-1042 was not delivered", body: "It contained a phone number.", typed: true },
  { kind: "milestone_approved", title: '"Fit sample" was approved', body: "The brand approved this step. TSC will send you $1,200.00. Their note: Great work" },
  { kind: "milestone_approved", title: '"Fit sample" was approved', body: "The brand approved this step. TSC will send you $1,200.00 once you add a withdrawal method." },
  { kind: "milestone_approved", title: '"Fit sample" was approved', body: "You can carry on to the next step." },
  { kind: "milestone_submitted", title: '"Fit sample" is ready for you', body: "The factory has sent this step for your approval." },
  { kind: "milestone_dispute", title: 'Dispute opened on "Fit sample"', body: "Wrong colour", typed: true },
  { kind: "milestone_update", title: 'New update on "Fit sample"', body: "Samples shipped today", typed: true },
  { kind: "milestone_update", title: 'New comment on "Fit sample"', body: "Looks good", typed: true },
  { kind: "milestone_reminder", title: 'Reminder: "Fit sample"', body: "This production step was due 2026-11-12 and needs an update." },
  { kind: "milestone_reminder", title: 'Reminder: "Fit sample"', body: "This production step is due 2026-11-20 and needs an update." },
  { kind: "milestone_reminder", title: 'Reminder: "Deposit"', body: "The payment for this step is due." },
  { kind: "milestone_reminder", title: 'Reminder: "Fit sample"', body: "This step is waiting for your approval." },
  { kind: "milestone_due_soon", title: '"Fit sample" is due in 3 days', body: "This production step on TSC-1042 is due Nov 18 and needs an update.", data: { due_on: "2026-11-18" } },
  { kind: "milestone_due_soon", title: '"Deposit" is due tomorrow', body: "This step on TSC-1042 is waiting for your payment. It is due Nov 16.", data: { due_on: "2026-11-16" } },
  { kind: "milestone_due_soon", title: '"Fit sample" is due today', body: "This step on TSC-1042 is waiting for your approval. It is due Nov 15.", data: { due_on: "2026-11-15" } },
  { kind: "quote_accepted", title: 'Your quote for "Organic tees" was accepted', body: 'Maison Rue accepted your quote for "Organic tees". The brand is setting the production steps; you will be told when they start.' },
  { kind: "quote_accepted", title: "Your quote was accepted", body: "" },
  { kind: "quote_declined", title: "Your quote was not selected", body: '"Organic tees" was awarded to another factory. Thank you for quoting.' },
  { kind: "quote_received", title: 'Ningbo Knit sent a quote on "Organic tees"', body: "Compare it with the other quotes on this request." },
  { kind: "quote_received", title: 'Ningbo Knit sent a revised quote on "Organic tees"', body: "Compare it with the other quotes on this request." },
  { kind: "quote_withdrawn", title: 'Ningbo Knit withdrew its quote on "Organic tees"', body: "It no longer appears in your comparison." },
  { kind: "order_created", title: "Production order TSC-1042 is ready", body: "Ningbo Knit accepted. Review the production steps drafted from their quote, then confirm them to start." },
  { kind: "order_cancelled", title: "TSC-1042 was cancelled", body: "Brand changed plans", typed: true },
  { kind: "rfq_cancelled", title: 'Maison Rue cancelled "Organic tees"', body: "The brand is no longer taking quotes on this request." },
  { kind: "rfq_matched", title: 'New request that matches you: "Organic tees"', body: "Maison Rue is looking for a factory. Quotes close Nov 20.", data: { quote_deadline: "2026-11-20T15:59:00Z" } },
  { kind: "rfq_matched", title: 'New request that matches you: "a request"', body: "A brand is looking for a factory. Open the request to read the brief and send a quote." },
  { kind: "rfq_invited", title: 'Maison Rue invited you to quote on "Organic tees"', body: "Quotes close Nov 20.", data: { quote_deadline: "2026-11-20T15:59:00Z" } },
  { kind: "rfq_invited", title: 'A brand invited you to quote on "Organic tees"', body: "Open the request to read the brief and send a quote." },
  { kind: "cancellation_proposed", title: "TSC-1042 has been proposed for cancellation", body: "Delays", typed: true },
  { kind: "cancellation_declined", title: "TSC-1042: Maison Rue wants to keep the order", body: "We still need it", typed: true },
  { kind: "cancellation_withdrawn", title: "TSC-1042: cancellation withdrawn", body: "Maison Rue withdrew its proposal to cancel. The order carries on." },
  { kind: "payment_confirmed", title: "Payment confirmed on TSC-1042", body: '$1,200.00 has arrived for "Deposit". You can start this work.' },
  { kind: "payment_confirmed", title: "Your payment on TSC-1042 was confirmed", body: "$1,284.00 received. The factory has been told to begin." },
  { kind: "payment_confirmed", title: 'Payment held for "Deposit"', body: "TSC received $1,200.00 on TSC-1042 and will send it to you once you add a withdrawal method." },
  { kind: "payment_confirmed", title: 'Payment held for "Fit sample"', body: "TSC holds $1,200.00 for this step on TSC-1042. You can start this work; it is paid to you when the brand approves it." },
  { kind: "payment_confirmed", title: 'Your payment for "Deposit" is funded', body: "$1,284.00 received on TSC-1042. TSC will pay the factory." },
  { kind: "payment_confirmed", title: 'Your payment for "Fit sample" is funded', body: "$1,284.00 received on TSC-1042. TSC holds it and pays the factory when you approve this step." },
  { kind: "payment_failed", title: 'Your payment for "Deposit" did not go through', body: "Your card was declined. Pay again from the step's payment page on TSC-1042." },
  { kind: "payment_failed", title: 'The payment for "Deposit" did not go through', body: "Nothing is held for this step on TSC-1042 yet. The brand has been asked to pay again." },
  { kind: "payment_processing", title: 'A payment for "Deposit" is on its way', body: "$1,200.00 on TSC-1042. It is still being confirmed. We will tell you when TSC holds it; please do not start this work yet." },
  { kind: "payment_refunded", title: 'Your payment for "Deposit" was refunded', body: "The amount changed while you were paying. You were refunded; please pay again. Pay again from the step's payment page on TSC-1042." },
  { kind: "payment_refunded", title: 'Your payment for "Deposit" was refunded', body: "TSC-1042 was cancelled. You were refunded." },
  { kind: "payment_refunded", title: 'The payment for "Deposit" was refunded', body: "TSC no longer holds money for this step on TSC-1042. The brand has been asked to pay again; we will tell you when it is held." },
  { kind: "payment_refunded", title: 'The payment for "Deposit" went back to the brand', body: "TSC-1042 was cancelled." },
  { kind: "payment_rejected", title: "We could not find your payment on TSC-1042", body: "No transfer arrived.", typed: true },
  { kind: "payment_sent", title: "Maison Rue says a payment is on its way", body: "$1,200.00 on TSC-1042. We will confirm here once it lands — please do not start on this yet." },
  { kind: "funds_released", title: "$1,200.00 released to you", body: "Sent to PayPal account a@b.com against TSC-1042." },
  { kind: "funds_released", title: "$1,200.00 paid out to you", body: "Sent against TSC-1042." },
  { kind: "funds_released", title: "$1,200.00 released to you", body: "Sent by Payoneer against TSC-1042. Payoneer payment ID 88412." },
  { kind: "funds_released", title: "$1,200.00 released to you", body: "Sent by bank transfer against TSC-1042. TSC's note: Ref. 7781" },
  { kind: "funds_released", title: "$65.00 paid out to you", body: "Sent to Ningbo Test Bank ending 1234. Payout fee $9.54 is taken from this payment: you receive CNY 369.72." },
  { kind: "withdrawal", title: "Withdrawal of $40.00 requested", body: "To a@b.com. TSC will send it after checking." },
  { kind: "withdrawal", title: "Withdrawal of $40.00 cancelled", body: "The amount is back in your balance." },
  { kind: "withdrawal", title: "Withdrawal of $25.00 declined", body: "The amount is back in your balance. TSC's reason: Please confirm your PayPal address first." },
  { kind: "withdrawal", title: "Withdrawal of $25.00 did not go through", body: "The amount is back in your balance. Check your withdrawal method, then withdraw again." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "PayPal account sample@example.com was added. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "TSC now pays your bank account at Bank of China ending 4821. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "TSC now pays your bank account at Bank of China ending 4821, instead of Payoneer account p@x.com. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "The bank account TSC pays changed: it is now Bank of China ending 4821, in the name of Ningbo Knit Ltd. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "Bank account ending in 6789 was added as a withdrawal method and is now the default. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "Withdrawals now go to debit card ending in 4242. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "TSC now pays your connected payout account. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Your payout methods changed", body: "The PayPal account changed from none to b@c.com. If nobody at your company made this change, email operations@contact.sourcing-club.com now." },
  { kind: "payout_method_changed", title: "Withdrawals are paused", body: "Your withdrawal account is being reviewed. Your earnings are safe. We will email you if we need anything." },
  { kind: "payout_method_changed", title: "Payments to you are paused", body: "Your withdrawal account is being reviewed. Your earnings are safe. We will email you if we need anything." },
  { kind: "payout_method_changed", title: "Finish setup to withdraw", body: "We need a few more details for your withdrawal account. Open Payments and choose Finish setup." },
  { kind: "payout_method_changed", title: "Finish setup to receive earnings", body: "We need a few more details for your withdrawal account. Open Payments and choose Finish setup." },
  { kind: "payout_method_changed", title: "Check your account number and SWIFT code", body: "Your payment of $1,200.00 is waiting. Check your account number and SWIFT code." },
  { kind: "payout_method_changed", title: "Check your PayPal address", body: "Your payment of $1,200.00 is waiting. Check your PayPal address." },
  { kind: "credits_granted", title: "You have 500 credits", body: "Your profile is verified. Each quote you send uses 25 credits." },
  { kind: "referral_rewarded", title: "You earned 500 credits", body: "Suzhou Silk, the factory you invited, is now verified." },
  { kind: "referral_joined", title: "Suzhou Silk joined from your invite", body: "You earn 500 credits when TSC verifies their profile." },
  { kind: "capacity_reminder", title: "Set your open capacity", body: "You haven't set your open capacity yet. Brands see it when they choose who to invite, so add it from your dashboard." },
  { kind: "capacity_reminder", title: "Is your capacity still right?", body: "You last updated your open capacity 45 days ago. Brands see it when they choose who to invite, so update it from your dashboard." },
  { kind: "matching_evidence_approved", title: "GOTS certificate was approved", body: "" },
  { kind: "matching_evidence_rejected", title: "Your evidence was not accepted", body: "Expired", typed: true },
  { kind: "matching_evidence_needs_information", title: "We need more information about GOTS certificate", body: "Which facility?", typed: true },
  { kind: "call_proposed", title: "Maison Rue invited you to a call about TSC-1042", body: "Lab dip review", data: { starts_at: "2026-11-20T08:00:00Z", duration_minutes: 30 }, typed: true },
  { kind: "call_accepted", title: "Maison Rue accepted your call about TSC-1042", body: "Lab dip review", data: { starts_at: "2026-11-20T08:00:00Z" }, typed: true },
  { kind: "call_declined", title: "Maison Rue declined your call about your request", body: "Busy that day", data: { starts_at: "2026-11-20T08:00:00Z" }, typed: true },
  { kind: "call_countered", title: "Maison Rue proposed another time for your call about TSC-1042", body: "Lab dip review", data: { starts_at: "2026-11-21T08:00:00Z" }, typed: true },
  { kind: "call_cancelled", title: "Maison Rue withdrew the invite to a call about TSC-1042", body: "Lab dip review", data: { starts_at: "2026-11-21T08:00:00Z" }, typed: true },
  { kind: "call_cancelled", title: "Maison Rue cancelled the call about TSC-1042", body: "Lab dip review", data: { starts_at: "2026-11-21T08:00:00Z" }, typed: true },
];

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
    const { capacityWindowProblem, formatCapacityWindow, parseCapacityWindow } = await load("/src/lib/domain/quote.js");
    const { notificationBody, notificationTitle } = await load("/src/shared/notification-text.mjs");
    const email = await load("/scripts/generate-notification-email.mjs");
    const { ZH_TITLE_KINDS } = await load("/src/shared/notification-zh.mjs");

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

    // What the form takes as a window is read back whole; anything else is refused.
    const nov = new Date(2026, 10, 6);
    for (const [typed, start, end, units] of [
      ["Jan 5 - Mar 1, 2027", "2027-01-05", "2027-03-01", null],
      ["Dec 20 - Jan 15 · 300 units", "2026-12-20", "2027-01-15", 300],
      ["Dec 12-30", "2026-12-12", "2026-12-30", null],
      ["Dec 12 to Jan 3", "2026-12-12", "2027-01-03", null],
      ["2027-01-05 - 2027-03-01", "2027-01-05", "2027-03-01", null],
      ["2027年1月5日至3月1日 · 300件", "2027-01-05", "2027-03-01", 300],
      ["12月12日至30日", "2026-12-12", "2026-12-30", null],
      ["12月12日-1月3日，４２０件", "2026-12-12", "2027-01-03", 420],
      ["２０２７年１月５日到２０２７年３月１日", "2027-01-05", "2027-03-01", null],
    ]) {
      expect(`window kept: ${typed}`, capacityWindowProblem(typed, nov), null);
      const parsed = parseCapacityWindow(typed, nov);
      expect(`window read: ${typed}`, [parsed.capacity_window_start, parsed.capacity_window_end, parsed.capacity_window_units].join(), [start, end, units].join());
      const back = formatCapacityWindow(parsed, nov);
      const again = parseCapacityWindow(back, nov);
      expect(`window reads back: ${back}`, [again.capacity_window_start, again.capacity_window_end, again.capacity_window_units].join(), [start, end, units].join());
    }
    for (const [typed, why] of [
      ["Jan to Feb 2027", "format"],
      ["1月到2月", "format"],
      ["2027年1月至2月", "format"],
      ["Q1 2027", "format"],
      ["soon", "format"],
      ["300 units", "format"],
      ["Dec 12-30 · partner confirmed", "format"],
      ["Dec 12 - Dec 30 maybe later", "format"],
      ["Dec 1, Dec 5, Dec 9", "format"],
      ["Feb 30 - Mar 3, 2027", "format"],
      ["13月5日", "format"],
      ["", "format"],
      ["Jan 5 - Mar 1", "past"],
      ["1月5日至3月1日", "past"],
    ]) {
      expect(`window refused: ${typed}`, capacityWindowProblem(typed, nov), why);
    }

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

    // The same reminders read in Chinese count the same days.
    const zh = { locale: "zh" };
    expect("zh reminder: three days out", notificationTitle(reminder("2026-11-05"), { ...zh, now: cron }),
      `“Fit sample”${behind ? "4 天后到期" : "3 天后到期"}`);
    expect("zh reminder: the UTC day", notificationTitle(reminder("2026-11-02"), { ...zh, now: cron }),
      `“Fit sample”${behind ? "明天到期" : "今天到期"}`);
    expect("zh reminder: read after the day", notificationTitle(reminder("2026-10-20"), { ...zh, now: evening }), "“Fit sample”已于 10月20日 到期");
    expect("zh reminder: the email's zone", email.notificationTitle(reminder("2026-10-28"), { ...zh, now: evening, timeZone: "UTC" }), "“Fit sample”2 天后到期");
    expect("zh deadline: the reader's zone", notificationBody(
      { kind: "rfq_invited", body: "Quotes close Nov 20.", data: { quote_deadline: "2026-11-20T15:59:00Z" } },
      { ...zh, timeZone: "America/New_York", withZone: true },
    ), "报价截止：11月20日（周五）10:59 GMT-5。");

    // Every kind, in Chinese, the same in the bell and the email; English unchanged.
    const cjk = /[\u4e00-\u9fff]/;
    const sampled = new Set(ZH_SAMPLES.map((sample) => sample.kind));
    for (const kind of ZH_TITLE_KINDS) if (!sampled.has(kind)) failures.push(`zh: no sample for ${kind}`);
    for (const sample of ZH_SAMPLES) {
      const options = { ...zh, timeZone: "Asia/Shanghai", withZone: true, now: evening };
      const title = notificationTitle(sample, options);
      const body = notificationBody(sample, options);
      if (!cjk.test(title)) failures.push(`zh title left in English: ${sample.title}`);
      if (sample.body && !sample.typed && !cjk.test(body)) failures.push(`zh body left in English: ${sample.body}`);
      if (sample.typed && !sample.data?.message_text && !body.startsWith(sample.body)) failures.push(`zh typed body changed: ${sample.body} → ${body}`);
      expect(`zh email title: ${sample.kind}`, email.notificationTitle(sample, options), title);
      expect(`zh email body: ${sample.kind}`, email.notificationBody(sample, options), body);
      if (sample.kind !== "milestone_due_soon") expect(`en title kept: ${sample.kind}`, notificationTitle(sample, { now: evening }), sample.title);
    }
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
