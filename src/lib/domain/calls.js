/**
 * Calls.
 *
 * A call belongs to a conversation, so who may see it is the conversation's
 * own rule (`is_thread_party`). One side proposes a time; only the other side
 * accepts, declines or proposes another time; the proposer may withdraw; either
 * side may cancel an accepted call before it starts. Every change is a
 * database function (migration 20261014000100), never a table write.
 *
 * Times are UTC in the database. Everything here that turns them into words
 * takes the time zone it should speak in, so one call reads "10:00 AM ET" to
 * the brand and "10:00 PM Shanghai" to the factory.
 */
import { supabase, unwrap } from "../supabase.js";
import { browserTimeZone } from "../../shared/call-time.mjs";

// The time-zone helpers live beside the designed screens, which use them too.
export * from "../../shared/call-time.mjs";

const CALL_COLUMNS = `
  id, thread_id, counter_of, title, agenda, starts_at, duration_minutes,
  proposer_org_id, proposer_time_zone, status, responded_at, response_note,
  cancelled_by_org_id, created_at,
  thread:message_threads (
    id, order_id, rfq_id, brand_org_id, factory_org_id,
    brand:orgs!message_threads_brand_org_id_fkey (name),
    factory:orgs!message_threads_factory_org_id_fkey (name)
  )
`;

/** Every call in the company's conversations, oldest first. */
export async function listCalls(orgId) {
  const rows = unwrap(
    await supabase.from("calls").select(CALL_COLUMNS).order("starts_at", { ascending: true }),
    "load your calls",
  );
  // A person in two companies reads both companies' calls through RLS; this
  // screen is about one of them.
  return rows.filter((call) => call.thread?.brand_org_id === orgId || call.thread?.factory_org_id === orgId);
}

export async function listThreadCalls(threadId) {
  return unwrap(
    await supabase.from("calls").select(CALL_COLUMNS).eq("thread_id", threadId).order("starts_at", { ascending: true }),
    "load this conversation's calls",
  );
}

export async function proposeCall({ threadId, startsAt, durationMinutes = 30, title, agenda, timeZone }) {
  return unwrap(
    await supabase.rpc("propose_call", {
      target_thread: threadId,
      starts_at: startsAt.toISOString(),
      duration_minutes: durationMinutes,
      title,
      agenda: agenda || null,
      time_zone: timeZone || null,
    }),
    "send the invite",
  );
}

export async function counterCall({ callId, startsAt, durationMinutes = 30, title, agenda, timeZone }) {
  return unwrap(
    await supabase.rpc("counter_call", {
      target_call: callId,
      starts_at: startsAt.toISOString(),
      duration_minutes: durationMinutes,
      title,
      agenda: agenda || null,
      time_zone: timeZone || null,
    }),
    "propose another time",
  );
}

export async function acceptCall(callId, timeZone = browserTimeZone()) {
  return unwrap(await supabase.rpc("accept_call", { target_call: callId, time_zone: timeZone }), "accept the call");
}

export async function declineCall(callId, note = null) {
  return unwrap(await supabase.rpc("decline_call", { target_call: callId, note }), "decline the call");
}

export async function cancelCall(callId, note = null) {
  return unwrap(await supabase.rpc("cancel_call", { target_call: callId, note }), "cancel the call");
}

/** Saves the browser's time zone as the signed-in person's. Never throws. */
export async function saveMyTimeZone() {
  const zone = browserTimeZone();
  if (!zone) return;
  try {
    await supabase.rpc("set_my_time_zone", { zone });
  } catch {
    // Only the other side's view of times depends on it.
  }
}

/** The other company's time zone in a conversation, or null if unknown. */
export async function counterpartyTimeZone(threadId) {
  const { data, error } = await supabase.rpc("thread_counterparty_time_zone", { target_thread: threadId });
  return error ? null : data ?? null;
}

// ---------------------------------------------------------------------------
// What a call is, for the person looking at it
// ---------------------------------------------------------------------------

export const JOIN_OPENS_MINUTES = 10;
export const JOIN_CLOSES_AFTER_END_MINUTES = 30;

export const startOf = (call) => new Date(call.starts_at);
export const endOf = (call) => new Date(startOf(call).getTime() + call.duration_minutes * 60000);

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

/** The other company in the call's conversation. */
export function otherSide(call, orgId) {
  const thread = call.thread ?? {};
  return thread.brand_org_id === orgId
    ? { id: thread.factory_org_id, name: thread.factory?.name ?? "" }
    : { id: thread.brand_org_id, name: thread.brand?.name ?? "" };
}

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

const icsStamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

// Calendar files wrap lines longer than 75 bytes, each continuation starting
// with a space (RFC 5545 3.1). Cut on characters, counting UTF-8 bytes.
function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = "";
  for (const char of line) {
    if (encoder.encode(current + char).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** The conversation the call belongs to: where the call is joined. */
export function callLink(call, origin = window.location.origin) {
  return `${origin}/app.html/messages/${call.thread_id}`;
}

function calendarDetails(call, otherName, link) {
  return [
    call.agenda,
    `Video call on The Sourcing Club with ${otherName}.`,
    `Join from the conversation: ${link}`,
  ].filter(Boolean).join("\n\n");
}

/** An .ics file for the call (UTC times, the call's id as its UID). */
export function icsFor(call, otherName, link = callLink(call)) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Sourcing Club//Calls//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${call.id}@sourcing-club.com`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(startOf(call))}`,
    `DTEND:${icsStamp(endOf(call))}`,
    `SUMMARY:${icsText(`${call.title} · ${otherName}`)}`,
    `DESCRIPTION:${icsText(calendarDetails(call, otherName, link))}`,
    `LOCATION:${icsText(link)}`,
    `URL:${link}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function downloadIcs(call, otherName) {
  const blob = new Blob([icsFor(call, otherName)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${call.title.replace(/[^\w\- ]+/g, "").trim() || "call"}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalendarUrl(call, otherName, link = callLink(call)) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${call.title} · ${otherName}`,
    dates: `${icsStamp(startOf(call))}/${icsStamp(endOf(call))}`,
    details: calendarDetails(call, otherName, link),
    location: link,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
