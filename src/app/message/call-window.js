/**
 * A call's Zoom meeting in a window of its own.
 *
 * On a computer, "Join call" opens call.html in a popup: Zoom's full-window
 * meeting, kept apart from the conversation so the conversation stays
 * usable. On a phone or tablet a popup is only a tab that is easy to lose, so
 * the call takes the page itself and Leave comes back to the conversation.
 *
 * The window and the conversation talk over a BroadcastChannel, so it works
 * whichever page opened the window (a dashboard, then the conversation) and
 * when a blocked popup was opened from a link instead. The window says when
 * it joined (with the meeting's Zoom-app link) and when it left; the
 * conversation tells it to leave. Closing the window is leaving: it says so
 * as it closes, and an open window is checked for being closed in case that
 * message never came.
 */

const CHANNEL = "tsc-calls";
const CLOSED_CHECK_MS = 1000;

/** call.html for a call: `popup` when it opens in its own window. */
export function callPageUrl(call, { popup = false } = {}) {
  const back = `/app.html/messages/${call.thread_id}`;
  return `/call.html?call=${encodeURIComponent(call.id)}&back=${encodeURIComponent(back)}${popup ? "&popup=1" : ""}`;
}

/** Phones and tablets: the call takes the page instead of a window. */
export function joinsInPage() {
  return Boolean(window.matchMedia?.("(hover: none) and (pointer: coarse)").matches);
}

// One call window at a time, kept here rather than in a screen so it
// survives moving from the dashboard to the conversation.
let current = null; // { call, handle, blocked, joinUrl, joined }
const listeners = new Set();
let channel = null;
let closedTimer = null;

function notify() {
  for (const listener of listeners) listener(current);
}

function end() {
  current = null;
  clearInterval(closedTimer);
  closedTimer = null;
  notify();
}

function listen() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }) => {
    if (!data?.callId) return;
    if (data.type === "joined") {
      if (current?.call.id !== data.callId) return;
      current = { ...current, joined: true, joinUrl: data.joinUrl ?? current.joinUrl };
      notify();
    } else if (data.type === "left" && current?.call.id === data.callId && !current.inApp) {
      end();
    }
  };
}

/**
 * Opens the call's window, or brings it forward when it is already open.
 * Must run inside the click: a browser blocks a popup opened later.
 * Returns where the call is: { blocked } when the browser refused the window.
 */
export function openCallWindow(call) {
  listen();
  if (current?.call.id === call.id && current.handle && !current.handle.closed) {
    current.handle.focus();
    return current;
  }
  if (current && current.call.id !== call.id) leaveCallWindow();
  const handle = window.open(callPageUrl(call, { popup: true }), `tsc-call-${call.id}`, "popup,width=1200,height=800");
  current = { call, handle, blocked: !handle, joinUrl: null, joined: false };
  clearInterval(closedTimer);
  if (handle) {
    closedTimer = setInterval(() => {
      if (current?.handle?.closed) end();
    }, CLOSED_CHECK_MS);
  }
  notify();
  return current;
}

/** The blocked window was opened from the link instead. */
export function openedFromLink() {
  if (!current) return;
  current = { ...current, blocked: false };
  notify();
}

/** Brings the call's window forward. */
export function showCallWindow() {
  if (current?.handle && !current.handle.closed) current.handle.focus();
}

function closeWindow() {
  listen();
  channel?.postMessage({ type: "leave", callId: current.call.id });
  try {
    current.handle?.close();
  } catch {
    // Already gone.
  }
}

/** Leaves the meeting in the window and closes it. */
export function leaveCallWindow() {
  if (!current) return;
  closeWindow();
  end();
}

/**
 * The person went on in the Zoom app: the window leaves the meeting and
 * closes, so they are in it once, but the call is still on. The page cannot
 * hear when the app's meeting ends, so it stays "in the app" until closed.
 */
export function openedInZoomApp() {
  if (!current) return;
  closeWindow();
  clearInterval(closedTimer);
  closedTimer = null;
  current = { ...current, handle: null, blocked: false, inApp: true };
  notify();
}

/** The call open in a window now, or null; `listener` hears every change. */
export function watchCallWindow(listener) {
  listen();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentCallWindow() {
  return current;
}

/** For call.html: its side of the channel. */
export function callWindowChannel(callId, { onLeave } = {}) {
  if (typeof BroadcastChannel === "undefined") {
    return { joined() {}, left() {}, close() {} };
  }
  const own = new BroadcastChannel(CHANNEL);
  own.onmessage = ({ data }) => {
    if (data?.type === "leave" && data.callId === callId) onLeave?.();
  };
  let gone = false;
  return {
    joined: (joinUrl) => own.postMessage({ type: "joined", callId, joinUrl }),
    left: () => {
      if (gone) return;
      gone = true;
      own.postMessage({ type: "left", callId });
    },
    close: () => own.close(),
  };
}
