/**
 * When a call's card changes on its own, and whose time its second line is.
 *
 * Two things the screens got wrong without anything failing:
 *
 * - A dashboard left open read "Open" after a confirmed call's Join window
 *   opened, until it was reloaded. The pages kept time with a 30-second poll
 *   started whenever they happened to open, so "Join call" appeared up to a
 *   poll late, and later still in a tab the browser had slowed. The pages now
 *   wake at the moment the next call changes (`nextCallChange`); this pins
 *   those moments, and that no call page goes back to a poll.
 * - The other company's line read in the zone of whichever browser it last
 *   signed in from, even when it had proposed the call in another zone. A call
 *   they proposed now reads in the zone they chose (`theirZoneFor`).
 */
import { readFileSync } from "node:fs";
import {
  JOIN_CLOSES_AFTER_END_MINUTES,
  JOIN_OPENS_MINUTES,
  callState,
  canJoinCall,
  nextCallChange,
  startOf,
  theirTime,
  theirZoneFor,
} from "../src/shared/call-time.mjs";
import { joinUrlMismatch, meetingRequestBody } from "../api/_zoom.js";
import { ZOOM_VIEW_CHROME, ZOOM_VIEW_MIN_WIDTH, zoomViewSize } from "../src/shared/zoom-view.mjs";

let failures = 0;
let checks = 0;
function check(condition, label) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`FAIL ${label}`);
  }
}

const MINUTE = 60000;
const BRAND = "brand-org";
const FACTORY = "factory-org";
const now = Date.UTC(2026, 9, 23, 22, 49, 50); // 6:49:50 PM in New York
const at = (minutes) => new Date(now + minutes * MINUTE).toISOString();

// A confirmed 30-minute call at 7:00 PM ET, 10 min 10 s away.
const confirmed = {
  status: "accepted", starts_at: at(10 + 10 / 60), duration_minutes: 30,
  proposer_org_id: FACTORY, proposer_time_zone: "Asia/Shanghai",
};
const opens = startOf(confirmed).getTime() - JOIN_OPENS_MINUTES * MINUTE;
const closes = startOf(confirmed).getTime() + (30 + JOIN_CLOSES_AFTER_END_MINUTES) * MINUTE;

check(canJoinCall(confirmed, now - 7 * 24 * 60 * MINUTE), "a confirmed call can be joined even a week before its start");
check(canJoinCall(confirmed, now), "a confirmed call can be joined more than ten minutes early");
check(!canJoinCall({ ...confirmed, status: "proposed" }, now), "an unaccepted invitation cannot be joined");
check(!canJoinCall({ ...confirmed, status: "cancelled" }, now), "a cancelled call cannot be joined early");
check(!canJoinCall(confirmed, closes), "an expired call cannot be joined");
const joinHandler = readFileSync(new URL("../api/call-join.js", import.meta.url), "utf8");
check(!joinHandler.includes("call.opens_at"), "the server no longer blocks joins before the scheduled opening time");

check(callState(confirmed, BRAND, now) === "upcoming", "a confirmed call before its window is upcoming");
check(callState(confirmed, BRAND, opens) === "live", "and is live the moment its window opens");
check(nextCallChange([confirmed], now) === opens, "the next change of a confirmed call is its window opening, not a poll later");
check(nextCallChange([confirmed], opens) === startOf(confirmed).getTime(), "then its start (Starting soon → On now)");
check(nextCallChange([confirmed], startOf(confirmed).getTime()) === closes, "then the end of its Join window");
check(nextCallChange([confirmed], closes) === null, "and nothing after that");

// An invite expires at its start; closed calls never change on their own.
const invite = { status: "proposed", starts_at: at(5 / 60), duration_minutes: 30, proposer_org_id: BRAND };
check(nextCallChange([confirmed, invite], now) === startOf(invite).getTime(), "the earliest change of several calls wins (an invite expiring)");
check(nextCallChange([{ ...confirmed, status: "cancelled" }, { ...invite, status: "declined" }], now) === null,
  "cancelled and declined calls never wake a page");

// No call page keeps time with a poll again.
for (const path of ["src/app/message/use-calls.js", "src/app/message/LiveMessages.jsx"]) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  check(!/setInterval\s*\(/.test(source), `${path} keeps call time without a poll`);
}
const hook = readFileSync(new URL("../src/app/message/use-calls.js", import.meta.url), "utf8");
check(/nextCallChange\(/.test(hook) && /visibilitychange/.test(hook), "the call clock wakes at the next change and when the tab is shown again");
for (const path of ["src/app/home/LiveHome.jsx", "src/app/home/LiveFactoryHome.jsx"]) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  check(/useDashboardCalls\(/.test(source) && /\bnow\b[^;]*\)/.test(source), `${path} draws its calls at the dashboard clock`);
}

// Ningbo proposed in Shanghai time from a browser in New York: the brand
// reads Ningbo's line in Shanghai time, not in the saved New York zone.
const savedZone = "America/New_York";
check(theirZoneFor(confirmed, BRAND, savedZone) === "Asia/Shanghai", "a call the other side proposed reads in the zone they proposed in");
const line = theirTime(startOf(confirmed), "Ningbo Loomworks", theirZoneFor(confirmed, BRAND, savedZone));
check(/Sat, Oct 24 · 7:00 AM Shanghai$/.test(line), `the brand's card says Ningbo's 7:00 AM Shanghai (${line})`);
check(theirZoneFor(confirmed, FACTORY, "America/Chicago") === "America/Chicago",
  "a call this company proposed reads the other side in their saved zone");
check(theirZoneFor({ ...confirmed, proposer_time_zone: null }, BRAND, savedZone) === savedZone,
  "a call proposed with no zone falls back to the saved one");
check(theirZoneFor(null, BRAND, savedZone) === savedZone, "no call (a new proposal) uses the saved zone");

// Zoom makes a meeting its own id only when asked: left out, use_pmi takes the
// host user's setting, and production's calls came back as one Personal
// Meeting ID the Meeting SDK could not join ("Meeting does not exist").
const zoomBody = meetingRequestBody({ topic: "Fit review", startsAt: at(60), durationMinutes: 30 });
check(zoomBody.settings.use_pmi === false, "a call's Zoom meeting is asked for with use_pmi: false");
check(zoomBody.settings.join_before_host === true && zoomBody.settings.jbh_time === 0,
  "Zoom permits joining any time before the host, without a ten-minute restriction");
check(zoomBody.type === 2 && zoomBody.start_time === "2026-10-23T23:49:50Z", "as a scheduled meeting at the call's start, in UTC");
check(joinUrlMismatch({ meetingNumber: "84598714022", joinUrl: "https://us06web.zoom.us/j/7320690524?pwd=x&omn=84598714022" }) === "7320690524",
  "a join link to a Personal Meeting ID is noticed");
check(joinUrlMismatch({ meetingNumber: "84598714022", joinUrl: "https://us06web.zoom.us/j/84598714022?pwd=x" }) === null,
  "a join link to the meeting itself is not");
check(joinUrlMismatch({ meetingNumber: "1", joinUrl: "" }) === null, "nor is a meeting with no link");

// Zoom's view fits the room under the conversation's header, toolbar and all.
// Sized from the panel's width alone, a 1920 x 822 window drew it 707px tall
// in 536px of room, and its mic, camera and leave buttons were out of reach.
const wideShort = zoomViewSize({ panelWidth: 886, availableHeight: 536 });
check(wideShort.height + ZOOM_VIEW_CHROME <= 536, "a wide, short window draws Zoom's toolbar inside the room it has");
check(wideShort.width < 886 && Math.abs(wideShort.height - (wideShort.width * 9) / 16) < 1, "by narrowing the view, still 16:9");
const tall = zoomViewSize({ panelWidth: 700, availableHeight: 1200 });
check(tall.width === 700 && tall.height === 394, "with room to spare the view is the panel's width");
check(zoomViewSize({ panelWidth: 500, availableHeight: 200 }).width === ZOOM_VIEW_MIN_WIDTH,
  "never narrower than Zoom's toolbar needs, however short the window");

if (failures) {
  console.log(`check:calls: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`check:calls: all ${checks} checks pass`);
