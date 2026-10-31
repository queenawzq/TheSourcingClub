/**
 * Zoom, for calls: TSC's own Zoom account creates every meeting, and both
 * sides join it as participants through the Meeting SDK.
 *
 * Two Zoom apps, five server-only variables (never VITE_):
 *   - a Server-to-Server OAuth app (scope meeting:write:meeting:admin) creates
 *     meetings: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET;
 *   - a General app with Meeting SDK on signs the join:
 *     ZOOM_SDK_CLIENT_ID, ZOOM_SDK_CLIENT_SECRET.
 * The Meeting SDK joins meetings in its own account with nothing but that
 * signature; another account's meetings need Zoom's review and user tokens.
 * That is why the meetings are TSC's, not the brand's or the factory's.
 *
 * The leading underscore keeps Vercel from serving this file as a route.
 */
import { createHmac } from "node:crypto";

export function zoomConfigured(env = process.env) {
  return Boolean(
    env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET &&
    env.ZOOM_SDK_CLIENT_ID && env.ZOOM_SDK_CLIENT_SECRET,
  );
}

// One token per warm function, reused until a minute before it expires.
let cachedToken = null;

async function accessToken(env = process.env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const basic = Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env.ZOOM_ACCOUNT_ID)}`;
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Zoom refused the account credentials (${response.status} ${body.reason ?? body.error ?? ""})`.trim());
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/**
 * What Zoom is asked for: a scheduled meeting for a call. Anyone with the
 * signature may join before a host (nobody hosts: both sides are
 * participants), and there is no waiting room, since TSC has already decided
 * who is in the call.
 *
 * `use_pmi: false` is not a default to leave out. Zoom documents no default
 * for it, and left out it appears to follow the host user's own "Use PMI when
 * scheduling" setting: production's meetings came back as the host's Personal
 * Meeting ID (join_url /j/<PMI>?…&omn=<id>, Oct 26), the Meeting SDK said
 * "Meeting does not exist" for the id, and every call would have shared one
 * personal room.
 */
export function meetingRequestBody({ topic, startsAt, durationMinutes }) {
  return {
    topic: String(topic).slice(0, 200),
    type: 2,
    start_time: new Date(startsAt).toISOString().replace(/\.\d{3}Z$/, "Z"),
    timezone: "UTC",
    duration: durationMinutes,
    settings: {
      use_pmi: false,
      join_before_host: true,
      jbh_time: 0,
      waiting_room: false,
      host_video: true,
      participant_video: true,
      mute_upon_entry: false,
      approval_type: 2,
      auto_recording: "none",
    },
  };
}

/**
 * The meeting id in a join link's path when it is not the meeting's own id,
 * else null. A link to another id is a Personal Meeting ID standing in for the
 * meeting, which the Meeting SDK cannot join by the meeting's id.
 */
export function joinUrlMismatch({ meetingNumber, joinUrl }) {
  const pathId = /\/j\/(\d+)/.exec(String(joinUrl ?? ""))?.[1];
  return pathId && pathId !== String(meetingNumber) ? pathId : null;
}

export async function createMeeting(details, env = process.env) {
  const token = await accessToken(env);
  const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(meetingRequestBody(details)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) {
    throw new Error(`Zoom did not create the meeting (${response.status} ${body.message ?? ""})`.trim());
  }
  return { meetingNumber: String(body.id), passcode: body.password ?? "", joinUrl: body.join_url ?? "" };
}

const base64url = (value) => Buffer.from(value).toString("base64url");

/**
 * The Meeting SDK's join signature: an HS256 JWT signed with the SDK app's
 * secret, for one meeting, as a participant (role 0). Valid two hours: long
 * enough for a call that runs over, inside Zoom's 30 min – 48 h window.
 */
export function sdkSignature(meetingNumber, env = process.env, now = Date.now()) {
  // Small clock differences must not make a fresh signature appear future-dated.
  const iat = Math.floor(now / 1000) - 120;
  const exp = iat + 2 * 60 * 60;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    appKey: env.ZOOM_SDK_CLIENT_ID,
    mn: Number(meetingNumber),
    role: 0,
    iat,
    exp,
    tokenExp: exp,
  }));
  const signature = createHmac("sha256", env.ZOOM_SDK_CLIENT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
