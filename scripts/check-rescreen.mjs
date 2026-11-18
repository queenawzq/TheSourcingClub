/**
 * check:rescreen — the sender's page keeps asking about its own messages still
 * being checked: quickly at first, then once a minute for as long as it is
 * open, and never in a burst (src/shared/rescreen.mjs). With the "checking"
 * notice gone, a page that stopped asking after a minute left a message
 * undelivered, looking sent, until the sender reloaded.
 */
import { readFileSync } from "node:fs";
import { RESCREEN_AFTER_MS, RESCREEN_EVERY_MS, nextRescreenAt } from "../src/shared/rescreen.mjs";

let failures = 0;
const check = (ok, label) => { if (!ok) { failures += 1; console.log(`FAIL ${label}`); } };

const sent = Date.UTC(2026, 10, 18, 14, 0, 0);
check(RESCREEN_EVERY_MS === 60000, "once the quick asks are done, it asks every minute");
check(nextRescreenAt(sent, 0) === sent + 5000 && nextRescreenAt(sent, 3) === sent + 60000, "the quick asks at 5, 15, 30 and 60 s stay as they were");
check(nextRescreenAt(sent, 4) === sent + 120000, "the fifth ask is a minute after the fourth");
check(nextRescreenAt(sent, 12) === sent + 10 * 60000, "and it keeps asking: ten minutes after sending, still once a minute");

// Asked as each one comes due, it never stops by itself.
let at = null;
let n = 0;
let last = sent;
const times = [];
while (n < 30) {
  const due = nextRescreenAt(sent, n, at);
  check(due > last || n === 0, `ask ${n + 1} comes after ask ${n}`);
  times.push(due);
  last = due;
  at = due;
  n += 1;
}
check(times.at(-1) - times.at(-2) === RESCREEN_EVERY_MS, "the thirtieth ask is still a minute after the one before");

// A message found long after it was sent (the page opened an hour later) is
// asked about at once, then a minute apart: never in a burst.
const old = sent - 60 * 60000;
const now = sent;
const first = nextRescreenAt(old, 0, null);
check(first <= now, "an old message is asked about as soon as the page sees it");
const second = nextRescreenAt(old, 1, now);
check(second - now >= RESCREEN_AFTER_MS[0], "the next quick ask waits at least 5 s");
const fifth = nextRescreenAt(old, 4, now);
check(fifth - now === RESCREEN_EVERY_MS, "once the quick ones are used, a minute after the last ask");

// The page uses the schedule and no longer stops after the quick asks.
const page = readFileSync(new URL("../src/app/message/LiveMessages.jsx", import.meta.url), "utf8");
check(/nextRescreenAt\(/.test(page), "the conversation page asks on this schedule");
check(!/attempts\.current\[message\.id\][^;\n]*<\s*RESCREEN_AFTER_MS\.length/.test(page), "the page no longer gives up after the quick asks");

if (failures) {
  console.error(`check:rescreen: ${failures} failed`);
  process.exit(1);
}
console.log("check:rescreen: the page keeps asking, once a minute, never in a burst");
