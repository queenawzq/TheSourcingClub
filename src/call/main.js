/**
 * call.html?call=<id>&back=<path>: a call's Zoom meeting, full screen, for
 * phones and tablets.
 *
 * Zoom supports the view drawn inside a conversation (Component View) on
 * desktop browsers only; for phones and tablets it offers Client View, its
 * own full-page meeting. That page brings its own styles and takes over the
 * document, so it lives here rather than inside app.html. The join is the
 * conversation's: the same /api/call-join, the same checks, the same meeting.
 *
 * Zoom's own pre-join screen is kept: on iOS a tap is what lets the call's
 * sound start, and it is where a person checks their mic and camera. Leaving
 * goes back to the conversation (`back`).
 *
 * On a computer the conversation opens this page in a window of its own
 * (`popup=1`, src/app/message/call-window.js). There it tells the
 * conversation when it joined and when it left, leaves when the conversation
 * says so, and closes itself on leaving: Zoom sends it to `left=1`.
 */
import "./call.css";
import { supabase, isConfigured, kickNotificationEmails } from "../lib/supabase.js";
import { acceptCall, cancelCall, joinCall, loadZoomClient, ZOOM_SDK_VERSION } from "../lib/domain/calls.js";
import { callWindowChannel } from "../app/message/call-window.js";

const params = new URLSearchParams(window.location.search);
const callId = params.get("call");
// Only one of our own pages: anything else in `back` would make this page an
// open redirect, since Zoom sends the person there on leaving.
const backPath = /^\/app\.html(\/|\?|$)/.test(params.get("back") ?? "") ? params.get("back") : "/app.html/messages";
const back = new URL(backPath, window.location.origin).href;

const popup = params.get("popup") === "1";
const callWindow = popup && callId ? callWindowChannel(callId, { onLeave: leave }) : null;
// Closing the window is leaving the call.
if (callWindow) window.addEventListener("pagehide", () => callWindow.left());
let zoom = null;
let signedOut = false;
if (isConfigured) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) {
      signedOut = true;
      void leave();
    }
  });
  window.addEventListener("pagehide", () => subscription.unsubscribe(), { once: true });
}

const status = document.querySelector(".call-page-status");
const actions = document.querySelector(".call-page-actions");

function show(text, { joinUrl } = {}) {
  status.textContent = text;
  actions.replaceChildren();
  // Opening the app from here is the only way into the meeting: this window
  // is not in it, so it closes as the app opens.
  if (joinUrl) {
    const app = link("Open in Zoom app", joinUrl, { primary: true, newTab: true });
    if (popup) app.addEventListener("click", () => setTimeout(finished, 0));
    actions.append(app);
  }
  // In its own window the conversation is still open behind it: close.
  if (popup) {
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close this window";
    if (!joinUrl) close.className = "primary";
    close.addEventListener("click", finished);
    actions.append(close);
  } else {
    actions.append(link("Back to the conversation", back, { primary: !joinUrl }));
  }
}

function link(label, href, { primary = false, newTab = false } = {}) {
  const anchor = document.createElement("a");
  anchor.textContent = label;
  anchor.href = href;
  if (primary) anchor.className = "primary";
  if (newTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  return anchor;
}

// Zoom draws its failures in a dialog of its own over its page, with a Retry
// that fails the same way: put this page's message and ways on in front.
function failed(text, join, failure) {
  if (signedOut) { finished(); return; }
  console.warn("zoom join", failure?.errorCode, failure?.reason ?? failure?.errorMessage ?? failure?.message);
  const root = document.getElementById("zmmtg-root");
  if (root) root.style.display = "none";
  show(text, { joinUrl: join?.joinUrl });
}

// Out of the meeting: the conversation hears of it and the window closes.
function finished() {
  callWindow?.left();
  if (signedOut) {
    const root = document.getElementById("zmmtg-root");
    if (root) root.style.display = "none";
  }
  if (popup) window.close();
  // A window the browser will not let a script close (opened from a link).
  status.textContent = "You left the call. You can close this window.";
  actions.replaceChildren();
}

async function leave() {
  try {
    await new Promise((resolve) => zoom ? zoom.leaveMeeting({ success: resolve, error: resolve }) : resolve());
  } finally {
    finished();
  }
}

/**
 * Leaving a call started now that nobody has answered yet ends it, as closing
 * its window does on a computer: nobody answers into an empty call. Only the
 * caller's side can end it (the database refuses anyone else, and anything but
 * a call that still rings), so a refusal is simply nothing to do.
 */
async function endIfStillRinging() {
  try {
    const { data: call } = await supabase.from("calls").select("instant, status").eq("id", callId).maybeSingle();
    if (call?.instant && call.status === "proposed") await cancelCall(callId);
  } catch {
    // Already answered, declined, missed or ended.
  }
}

async function start() {
  if (signedOut) return;
  if (params.get("left") === "1") {
    if (isConfigured && callId) await endIfStillRinging();
    if (popup) finished();
    else window.location.replace(back);
    return;
  }
  if (!isConfigured || !callId) {
    show("This call can't be opened from this link.");
    return;
  }
  // On a phone the conversation hands over to this page right after starting
  // a call, before its own email send runs: send the other side's notice
  // from here, while the call still rings.
  kickNotificationEmails();
  // Joining a call started now is answering it: accepted here, so the window
  // could open in the click. Already accepted (a teammate, or a second
  // press) is fine.
  if (params.get("answer") === "1") {
    try {
      await acceptCall(callId);
    } catch (failure) {
      if (!/accepted already/.test(failure.message)) {
        show(/has ended/.test(failure.message) ? "This call has ended."
          : /other side answers/.test(failure.message) ? "You started this call, so you can't answer it."
          : failure.noAnswer ? failure.message : "The call could not be opened.");
        return;
      }
    }
  }
  const answer = await joinCall(callId);
  if (signedOut) return;
  if (!answer.ok) {
    show(answer.message);
    return;
  }
  const { join } = answer;
  let ZoomMtg;
  try {
    ZoomMtg = await loadZoomClient();
  } catch (failure) {
    failed(failure.message, join, failure);
    return;
  }
  if (signedOut) return;
  const cantOpen = "The video can't open on this page right now. Join the same call in the Zoom app.";
  ZoomMtg.setZoomJSLib(`https://source.zoom.us/${ZOOM_SDK_VERSION}/lib`, "/av");
  ZoomMtg.preLoadWasm();
  ZoomMtg.prepareWebSDK();
  zoom = ZoomMtg;
  // In a window, Zoom's Leave (or the host ending the meeting) lands on this
  // page again as `left=1`, which closes it.
  // Zoom's Leave lands on this page again as `left=1` (in a window or on a
  // phone), so a call that still rings can be ended before going back.
  const leaveUrl = `${window.location.origin}/call.html?call=${encodeURIComponent(callId)}${popup ? "&popup=1" : ""}&left=1&back=${encodeURIComponent(backPath)}`;
  ZoomMtg.init({
    leaveUrl,
    patchJsMedia: true,
    leaveOnPageUnload: true,
    success: () => {
      if (signedOut) { void leave(); return; }
      ZoomMtg.join({
        signature: join.signature,
        meetingNumber: join.meetingNumber,
        passWord: join.passcode,
        userName: join.userName,
        success: () => {
          if (signedOut) { void leave(); return; }
          callWindow?.joined(join.joinUrl);
          // Disconnected: left, ended by the host, or the connection is gone.
          ZoomMtg.inMeetingServiceListener("onMeetingStatus", (data) => {
            if ((data?.meetingStatus ?? data?.status) === 3) callWindow?.left();
          });
        },
        error: (failure) => failed(cantOpen, join, failure),
      });
    },
    error: (failure) => failed(cantOpen, join, failure),
  });
}

start();
