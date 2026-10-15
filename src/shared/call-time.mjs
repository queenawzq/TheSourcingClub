/**
 * Call times in words, in whichever time zone they should be read.
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

/** "Atelier Minho: Tue, Oct 14 · 3:00 PM Lisbon", or "" when their zone is unknown. */
export function theirTime(date, name, zone) {
  return zone ? `${name}: ${whenIn(date, zone)}` : "";
}
