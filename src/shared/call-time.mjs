/**
 * Call times in words, in whichever time zone they should be read, and where
 * a call stands at a given moment.
 *
 * Shared by the designed schedule dialog (src/prototype/main.jsx, live only)
 * and src/lib/domain/calls.js, and the demo seed. No database here: the prototype imports it.
 */

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const ZONE_LABELS = {
  "America/New_York": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Los_Angeles": "PT",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

/** "ET", "PT", "UTC", otherwise the zone's city ("Shanghai", "Ho Chi Minh"). */
export function zoneLabel(zone) {
  if (!zone) return "";
  return ZONE_LABELS[zone] ?? zone.split("/").pop().replace(/_/g, " ");
}

/** The zones the schedule dialog offers: the person's own first. */
export function zoneOptions(own) {
  const common = [
    ["America/New_York", "Eastern Time (ET)"],
    ["America/Chicago", "Central Time (CT)"],
    ["America/Denver", "Mountain Time (MT)"],
    ["America/Los_Angeles", "Pacific Time (PT)"],
    ["UTC", "UTC"],
    ["Europe/London", "London"],
    ["Europe/Lisbon", "Lisbon / Porto"],
    ["Europe/Paris", "Paris / Milan"],
    ["Europe/Istanbul", "Istanbul"],
    ["Asia/Kolkata", "India"],
    ["Asia/Dhaka", "Dhaka"],
    ["Asia/Ho_Chi_Minh", "Ho Chi Minh City"],
    ["Asia/Shanghai", "China (Shanghai)"],
    ["Asia/Hong_Kong", "Hong Kong"],
  ];
  const options = common.map(([value, label]) => ({ value, label }));
  if (own && !options.some((option) => option.value === own)) {
    options.unshift({ value: own, label: zoneLabel(own) });
  }
  return options;
}

const partsIn = (date, zone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone || undefined,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
};

/** The calendar date (y, m 1-12, d) a moment falls on in a zone. */
export function dateIn(date, zone) {
  const { year, month, day } = partsIn(date, zone);
  return { year, month, day };
}

/**
 * The UTC moment that is `minutes` past midnight on (year, month, day) in a
 * zone. Two passes settle the offset, including on the day clocks change.
 */
export function zonedTime(year, month, day, minutes, zone) {
  const wanted = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = partsIn(new Date(guess), zone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wanted - seenAsUtc;
  }
  return new Date(guess);
}

/** "3:00 PM" */
export function clock(date, zone) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone || undefined, hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Tue, Oct 14" */
export function dayLabel(date, zone) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone || undefined, weekday: "short", month: "short", day: "numeric" }).format(date);
}

/** "Tue, Oct 14 · 10:00 AM ET" */
export function whenIn(date, zone) {
  return `${dayLabel(date, zone)} · ${clock(date, zone)}${zone ? ` ${zoneLabel(zone)}` : ""}`;
}

/**
 * "Atelier Minho's time: Tue, Oct 14 · 3:00 PM Lisbon", or "" when their
 * zone is unknown, or when it reads the same day and hour as the reader's
 * own (`ownZone`): a second line repeating the first says nothing.
 */
export function theirTime(date, name, zone, ownZone) {
  if (!zone) return "";
  if (ownZone !== undefined && sameClock(date, zone, ownZone)) return "";
  return `${name}'s time: ${whenIn(date, zone)}`;
}

/** Whether a moment reads as the same day and hour in two zones. */
export function sameClock(date, zone, otherZone) {
  return dayLabel(date, zone) === dayLabel(date, otherZone) && clock(date, zone) === clock(date, otherZone);
}

// ---------------------------------------------------------------------------
// Where a call stands, and when that changes
// ---------------------------------------------------------------------------

export const JOIN_OPENS_MINUTES = 10;
export const JOIN_CLOSES_AFTER_END_MINUTES = 30;

export const startOf = (call) => new Date(call.starts_at);
export const endOf = (call) => new Date(startOf(call).getTime() + call.duration_minutes * 60000);

/** Confirmed participants may join at any time before the call expires. */
export function canJoinCall(call, now = Date.now()) {
  return call?.status === "accepted" && now < endOf(call).getTime() + JOIN_CLOSES_AFTER_END_MINUTES * 60000;
}

/**
 * Where a call stands for this company: "invite" (theirs, waiting on us),
 * "waiting" (ours, waiting on them), "upcoming", "live", or "past" — plus the
 * closed states as they are.
 */
export function callState(call, orgId, now = Date.now()) {
  if (call.status === "proposed") {
    if (startOf(call).getTime() <= now) return "expired";
    return call.proposer_org_id === orgId ? "waiting" : "invite";
  }
  if (call.status === "accepted") {
    const opens = startOf(call).getTime() - JOIN_OPENS_MINUTES * 60000;
    const closes = endOf(call).getTime() + JOIN_CLOSES_AFTER_END_MINUTES * 60000;
    if (now >= closes) return "past";
    if (now >= opens) return "live";
    return "upcoming";
  }
  return call.status;
}

/**
 * The next moment, after `now`, at which any of these calls reads
 * differently on its own: an invite expires at its start; a confirmed call
 * opens to Join, turns from "Starting soon" to "On now" at its start, and
 * ends when Join closes. A page keeping time sets its clock for exactly then,
 * so "Join call" appears as the window opens rather than up to a poll later.
 * Null when nothing will change without someone acting.
 */
export function nextCallChange(calls, now = Date.now()) {
  let next = null;
  for (const call of calls) {
    const start = startOf(call).getTime();
    const moments = call.status === "proposed"
      ? [start]
      : call.status === "accepted"
        ? [start - JOIN_OPENS_MINUTES * 60000, start, endOf(call).getTime() + JOIN_CLOSES_AFTER_END_MINUTES * 60000]
        : [];
    for (const moment of moments) {
      if (moment > now && (next === null || moment < next)) next = moment;
    }
  }
  return next;
}

/**
 * The time zone the other company's line on a call is read in. A call they
 * proposed (or answered with another time) carries the zone they chose for
 * it, which says where they are for this call; their saved zone is only the
 * browser they last signed in from. A call this company proposed has no zone
 * of theirs on it, so it uses the saved one.
 */
export function theirZoneFor(call, orgId, savedZone) {
  if (call && call.proposer_org_id !== orgId && call.proposer_time_zone) return call.proposer_time_zone;
  return savedZone ?? null;
}
