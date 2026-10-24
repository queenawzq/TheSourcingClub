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
import { browserTimeZone, endOf, startOf } from "../../shared/call-time.mjs";

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

/**
 * The server's contact-details check on the words about to be sent
 * (api/screen-call-text.js). The database refuses call text it did not pass,
 * so this runs right before every call function that carries words. Throws
 * with the reason when the words are refused, so the dialog can show it.
 */
async function checkCallText(texts) {
  const words = texts.filter((text) => typeof text === "string" && text.trim());
  if (!words.length) return;
  let response;
  let body = {};
  try {
    const { data } = await supabase.auth.getSession();
    response = await fetch("/api/screen-call-text", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token ?? ""}` },
      body: JSON.stringify({ texts: words }),
    });
    body = await response.json().catch(() => ({}));
  } catch {
    throw new Error("The call's details could not be checked. Check your connection and try again.");
  }
  if (!response.ok) {
    const text = body.error ? body.error[0].toUpperCase() + body.error.slice(1) : "The call's details could not be checked";
    throw new Error(/[.!?]$/.test(text) ? text : `${text}.`);
  }
}

export async function proposeCall({ threadId, startsAt, durationMinutes = 30, title, agenda, timeZone }) {
  await checkCallText([title, agenda]);
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
  await checkCallText([title, agenda]);
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

// A reason reaches the other side too, so it is checked like the call's words.
export async function declineCall(callId, note = null) {
  await checkCallText([note]);
  return unwrap(await supabase.rpc("decline_call", { target_call: callId, note: note || null }), "decline the call");
}

export async function cancelCall(callId, note = null) {
  await checkCallText([note]);
  return unwrap(await supabase.rpc("cancel_call", { target_call: callId, note: note || null }), "cancel the call");
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
// What a call is, for the person looking at it (its state and clock are in
// call-time.mjs, re-exported above, so they can be checked without a database)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

/**
 * Ask the server for what the Meeting SDK needs to join (api/call-join.js).
 * Resolves { ok: true, join } or { ok: false, message } — never throws, so the
 * card can say why ("opens 10 minutes before", "video isn't set up yet").
 */
export async function joinCall(callId) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { ok: false, message: "Sign in again to join." };
    const response = await fetch("/api/call-join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ callId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const text = body.error ? body.error[0].toUpperCase() + body.error.slice(1) : "The call could not be opened.";
      return { ok: false, message: /[.!?]$/.test(text) ? text : `${text}.` };
    }
    return { ok: true, join: body };
  } catch {
    return { ok: false, message: "The call could not be opened. Check your connection and try again." };
  }
}

/**
 * Zoom's Component View, from Zoom's own CDN, loaded only when someone joins.
 * The CDN build brings its own React 18 and Redux as globals; the npm package
 * would put a second React inside this React 19 bundle. Pinned version.
 */
export const ZOOM_SDK_VERSION = "6.5.0";
let zoomLoading = null;

export function loadZoomEmbedded() {
  if (window.ZoomMtgEmbedded) return Promise.resolve(window.ZoomMtgEmbedded);
  if (zoomLoading) return zoomLoading;
  const base = `https://source.zoom.us/${ZOOM_SDK_VERSION}/lib/vendor`;
  const scripts = [
    `${base}/react.min.js`,
    `${base}/react-dom.min.js`,
    `${base}/redux.min.js`,
    `${base}/redux-thunk.min.js`,
    `${base}/lodash.min.js`,
    `https://source.zoom.us/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`,
  ];
  const load = (src) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Zoom could not be loaded. Check your connection, or open the call in the Zoom app."));
    document.head.appendChild(script);
  });
  zoomLoading = scripts
    .reduce((chain, src) => chain.then(() => load(src)), Promise.resolve())
    .then(() => window.ZoomMtgEmbedded)
    .catch((failure) => {
      zoomLoading = null;
      throw failure;
    });
  return zoomLoading;
}
