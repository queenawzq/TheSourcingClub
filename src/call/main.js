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
 */
import "./call.css";
import { isConfigured } from "../lib/supabase.js";
import { joinCall, loadZoomClient, ZOOM_SDK_VERSION } from "../lib/domain/calls.js";

const params = new URLSearchParams(window.location.search);
const callId = params.get("call");
// Only one of our own pages: anything else in `back` would make this page an
// open redirect, since Zoom sends the person there on leaving.
const backPath = /^\/app\.html(\/|\?|$)/.test(params.get("back") ?? "") ? params.get("back") : "/app.html/messages";
const back = new URL(backPath, window.location.origin).href;

const status = document.querySelector(".call-page-status");
const actions = document.querySelector(".call-page-actions");

function show(text, { joinUrl } = {}) {
  status.textContent = text;
  actions.replaceChildren();
  if (joinUrl) actions.append(link("Open in Zoom app", joinUrl, { primary: true, newTab: true }));
  actions.append(link("Back to the conversation", back, { primary: !joinUrl }));
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
  console.warn("zoom join", failure?.errorCode, failure?.reason ?? failure?.errorMessage ?? failure?.message);
  const root = document.getElementById("zmmtg-root");
  if (root) root.style.display = "none";
  show(text, { joinUrl: join?.joinUrl });
}

async function start() {
  if (!isConfigured || !callId) {
    show("This call can't be opened from this link.");
    return;
  }
  const answer = await joinCall(callId);
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
  const cantOpen = "The video can't open on this page right now. Join the same call in the Zoom app.";
  ZoomMtg.setZoomJSLib(`https://source.zoom.us/${ZOOM_SDK_VERSION}/lib`, "/av");
  ZoomMtg.preLoadWasm();
  ZoomMtg.prepareWebSDK();
  ZoomMtg.init({
    leaveUrl: back,
    patchJsMedia: true,
    leaveOnPageUnload: true,
    success: () => {
      ZoomMtg.join({
        signature: join.signature,
        meetingNumber: join.meetingNumber,
        passWord: join.passcode,
        userName: join.userName,
        error: (failure) => failed(cantOpen, join, failure),
      });
    },
    error: (failure) => failed(cantOpen, join, failure),
  });
}

start();
