/**
 * Join a call's video meeting.
 *
 * The caller must be signed in, belong to one of the two companies in the
 * call's conversation, and the call must be accepted and on now: from 10
 * minutes before the start to 30 minutes after the end (call_join_context).
 * The first Join creates the Zoom meeting in TSC's account; a Join arriving
 * while that is happening waits for it rather than making a second meeting
 * (claim_call_meeting). The meeting's number and passcode live in
 * call_meetings, which the browser cannot read: this is the only way to them.
 *
 * Without the Zoom variables the answer is 503 and the screen says video
 * isn't set up yet: calls still schedule and sit in both calendars.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { createMeeting, sdkSignature, zoomConfigured } from "./_zoom.js";

function json(response, status, body) {
  response.status(status).json(body);
}

function bodyOf(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body || "{}");
  } catch {
    return {};
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "method not allowed" });

  const { supabaseUrl, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !serviceKey) return json(response, 503, { error: "video isn't set up on this site yet" });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await db.auth.getUser(token) : { data: null };
  if (!auth?.user) return json(response, 401, { error: "sign in is required" });

  const { callId } = bodyOf(request);
  const { data: rows } = callId
    ? await db.rpc("call_join_context", { target_call: callId, target_user: auth.user.id })
    : { data: null };
  const call = Array.isArray(rows) ? rows[0] : rows;
  // Not a party, or no such call: the same answer, so this cannot be used to
  // ask whether a call exists.
  if (!call || !call.is_party) return json(response, 404, { error: "that call is not yours to join" });
  if (call.status !== "accepted") return json(response, 409, { error: "this call is not confirmed" });

  const now = Date.now();
  if (now < new Date(call.opens_at).getTime()) {
    return json(response, 409, { error: "the call opens 10 minutes before it starts", opensAt: call.opens_at });
  }
  if (now > new Date(call.closes_at).getTime()) return json(response, 409, { error: "this call has ended" });

  if (!zoomConfigured()) {
    return json(response, 503, { error: "video isn't set up yet. The call is still confirmed and in both calendars." });
  }

  // The meeting: reuse it, wait for the request creating it, or create it.
  let meeting = null;
  for (let attempt = 0; attempt < 6 && !meeting; attempt += 1) {
    const { data: claims, error } = await db.rpc("claim_call_meeting", { target_call: call.call_id });
    if (error) {
      console.error("call-join claim", error.message);
      return json(response, 500, { error: "the call could not be opened" });
    }
    const claim = Array.isArray(claims) ? claims[0] : claims;
    if (claim?.meeting_number) {
      meeting = { meetingNumber: claim.meeting_number, passcode: claim.passcode ?? "", joinUrl: claim.join_url ?? "" };
    } else if (claim?.should_create) {
      try {
        meeting = await createMeeting({
          topic: `${call.title} · The Sourcing Club`,
          startsAt: call.starts_at,
          durationMinutes: call.duration_minutes,
        });
      } catch (failure) {
        console.error("call-join zoom", failure.message);
        await db.rpc("release_call_meeting_claim", { target_call: call.call_id });
        return json(response, 502, { error: "Zoom could not open the meeting. Try again in a moment." });
      }
      const { error: recordError } = await db.rpc("record_call_meeting", {
        target_call: call.call_id, number: meeting.meetingNumber, code: meeting.passcode, url: meeting.joinUrl,
      });
      if (recordError) console.error("call-join record", recordError.message);
    } else {
      // Someone else is creating it right now.
      await wait(1000);
    }
  }
  if (!meeting) return json(response, 503, { error: "the meeting is still being opened. Try again in a moment." });

  // "Ana Silva · Atelier Minho"; once when a person is named after the company.
  const userName = [...new Set([call.user_name, call.org_name].filter(Boolean))].join(" · ") || "Guest";
  return json(response, 200, {
    sdkKey: process.env.ZOOM_SDK_CLIENT_ID,
    signature: sdkSignature(meeting.meetingNumber),
    meetingNumber: meeting.meetingNumber,
    passcode: meeting.passcode,
    joinUrl: meeting.joinUrl,
    userName: userName.slice(0, 60),
  });
}
