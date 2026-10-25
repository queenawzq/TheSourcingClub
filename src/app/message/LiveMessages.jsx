/**
 * Conversations, on Queena's designed screen.
 *
 * `MessagesScreen` is imported from src/prototype/main.jsx and mounted here
 * with live threads behind it. This file is the seam.
 *
 * Calls are live: "Schedule call" opens the designed dialog, and the
 * conversation's calls are the designed cards in the "Scheduled call" panel
 * (see live-calls.js). Two things the design draws still have nothing behind
 * them, presence and "usually replies in 2h", and an instant "Live video
 * chat" needs presence, so all three stay absent here; the prototype keeps
 * them.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessagesScreen } from "../../prototype/main.jsx";
import "./messages.css";
import { supabase } from "../../lib/supabase.js";
import { ATTACHMENT_ACCEPT, attachmentRefusal, urlFor } from "../../lib/domain/documents.js";
import { awaitingScreen, fileOnlyBody, LANGUAGE_NAME, listMessages, listThreads, markRead, openOrderThread, readable, RESCREEN_AFTER_MS, rescreenStale, sendMessage, sentAt, threadProjectNames } from "../../lib/domain/message.js";
import { acceptCall, browserTimeZone, callState, cancelCall, counterCall, counterpartyTimeZone, declineCall, joinCall, listCalls, loadZoomEmbedded, otherSide, proposeCall, theirZoneFor, zoneOptions } from "../../lib/domain/calls.js";
import { callsForPanel, panelCard } from "./live-calls.js";
import { useCallClock } from "./use-calls.js";
import CallChangeDialog from "./CallChangeDialog.jsx";

const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

/**
 * Why a held message was held, as its sender is told it: the kind the screen
 * recorded (messages.held_for), never the screen's own words, which are for
 * staff. A message held for proposing a call elsewhere used to be told it
 * "shares contact details".
 */
const HELD_FOR = {
  contact_details: "It looks like it shares contact details. ",
  outside_platform: "It looks like it suggests continuing outside the platform. ",
};

/** After this long still being checked, a message says so even before the screen has been asked again. */
const SAY_CHECKING_AFTER_MS = 15 * 1000;

/**
 * What the sender is told about a message that has not reached the other side.
 * Nothing in the first seconds of being checked: that is how long a check
 * takes, and saying so on every message would make every message look
 * suspect. Once the screen has answered without a verdict, or it has been a
 * while, it says so: a message that looks sent and never arrives is the worst
 * of both.
 */
function deliveryStatus(message, { unscreened = false } = {}) {
  if (message.failed) {
    return {
      kind: "rejected",
      label: "Not sent",
      note: `${message.failed} ${message.typed ? "Copy it and send it again." : "Attach the files and send them again."}`,
    };
  }
  if (message.delivery === "held") {
    return {
      kind: "held",
      label: "Held for review: not delivered yet",
      note: `${HELD_FOR[message.held_for] ?? ""}Our team will check it before it is sent.`,
    };
  }
  if (message.delivery === "checking" && !String(message.id).startsWith("outgoing-")
      && (unscreened || Date.now() - Date.parse(message.created_at) > SAY_CHECKING_AFTER_MS)) {
    return {
      kind: "checking",
      label: "Checking before it is sent",
      note: "It has not reached them yet. This page keeps trying; if it is still here in a few minutes, our team will deliver it.",
    };
  }
  if (message.delivery === "rejected") {
    return { kind: "rejected", label: "Not delivered", note: message.review_note || null };
  }
  return null;
}

/**
 * Open a message's file in a new tab. The tab opens on the click itself (a
 * tab opened after an await is a pop-up browsers block), then goes to the
 * signed link.
 */
async function openAttachment(doc, onError) {
  const tab = window.open("", "_blank");
  try {
    const url = await urlFor(doc, 300);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (failure) {
    tab?.close();
    onError(failure);
  }
}

/** "Today" for anything from today, a date otherwise. */
function dayLabel(value) {
  if (!value) return "";
  const when = new Date(value);
  const today = new Date();
  return when.toDateString() === today.toDateString() ? "Today" : DAY.format(when);
}

export default function LiveMessages({ org, isFactory, user, threadId, orderId }) {
  const [threads, setThreads] = useState(null);
  const [projectNames, setProjectNames] = useState(new Map());
  const [messagesByThread, setMessagesByThread] = useState({});
  // Messages on their way: drawn the moment Send is pressed, before the
  // database has answered. { [threadId]: [{ tempId, body, files, at, failed }] }
  const [outgoing, setOutgoing] = useState({});
  // Files of a message still uploading, by message id, so a read of the
  // thread that lands before they are linked does not drop them from view.
  const [uploading, setUploading] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const activeThreadRef = useRef(threadId ?? null);

  // Calls: every call in the company's conversations, the other side's time
  // zone per conversation, the dialog (open to propose, or to answer one call
  // with another time), and which call is being changed.
  const ownZone = browserTimeZone() ?? "UTC";
  const [calls, setCalls] = useState([]);
  const [theirZones, setTheirZones] = useState({});
  const [activeId, setActiveId] = useState(threadId ?? null);
  const [dialog, setDialog] = useState(null);
  const [callBusy, setCallBusy] = useState(null);
  const [callNotes, setCallNotes] = useState({});
  // Withdraw, cancel or decline waiting on "are you sure?": { call, mode }.
  const [confirmCall, setConfirmCall] = useState(null);
  // The call being joined: { call, join, text } while the designed video
  // panel is open; Zoom draws into zoomRoot.
  const [video, setVideo] = useState(null);
  const zoomRoot = useRef(null);
  const zoomClient = useRef(null);

  // The other side's time zone, asked again whenever a conversation opens
  // and whenever the calls reload rather than kept: it may have moved since.
  const refreshTheirZone = useCallback((thread) => {
    if (!thread) return;
    counterpartyTimeZone(thread).then((zone) => setTheirZones((current) => ({ ...current, [thread]: zone ?? current[thread] ?? null })));
  }, []);

  const reloadCalls = useCallback(async () => {
    refreshTheirZone(activeThreadRef.current);
    try {
      setCalls(await listCalls(org.id));
    } catch (failure) {
      setError(failure);
    }
  }, [org.id, refreshTheirZone]);

  useEffect(() => { reloadCalls(); }, [reloadCalls]);

  // The clock the cards read: "Join call" opens and "Starting soon" turns
  // into "On now" while the page stays open, at the moment each happens.
  const [now] = useCallClock(calls);

  useEffect(() => { refreshTheirZone(activeId); }, [activeId, refreshTheirZone]);

  // An order's conversation is reached by the order, not by its thread id.
  // open_order_thread is idempotent — one thread per order — so this both
  // finds an existing conversation and starts the first one.
  const [resolvedThreadId, setResolvedThreadId] = useState(threadId);

  useEffect(() => {
    if (threadId || !orderId) return undefined;
    let cancelled = false;
    openOrderThread(orderId)
      .then((thread) => {
        if (cancelled) return;
        // The function returns the thread's row, not its id. Stored whole, it
        // reached listMessages as "[object Object]" and the screen fell back
        // to the newest conversation: another order's.
        setResolvedThreadId(thread?.id ?? null);
        // The thread may have just been created, so the list has to be read
        // again or the screen shows "no conversations yet" over a live one.
        reload();
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [orderId, threadId]);


  const reload = useCallback(async () => {
    try {
      const rows = await listThreads(org.id);
      setProjectNames(await threadProjectNames(rows ?? []));
      setThreads(rows ?? []);
      return rows ?? [];
    } catch (failure) {
      setError(failure);
      return [];
    }
  }, [org.id]);

  useEffect(() => { reload(); }, [reload]);

  /**
   * Load one conversation, and mark it read.
   *
   * Unread is derived per user from message_reads, so opening a thread is the
   * only thing that clears it — there is no counter to decrement.
   */
  const loadThread = useCallback(async (threadId) => {
    if (!threadId) return;
    setActiveId(threadId);
    setDialog((current) => (current?.threadId === threadId ? current : null));
    activeThreadRef.current = threadId;
    try {
      const rows = await listMessages(threadId);
      setMessagesByThread((current) => ({ ...current, [threadId]: rows ?? [] }));
      setError(null);
      await markRead(threadId);
      reload();
    } catch (failure) {
      setError(failure);
    }
  }, [reload]);

  /**
   * Your own messages the screen has not decided: ask it again, on a back-off,
   * for as long as the page is open. Only asking once, on the send, left a
   * message whose screen failed in `checking` for good while its sender
   * looked at it as sent. `unscreened` is the ones the screen was asked about
   * and did not decide, which then say so.
   */
  const [unscreened, setUnscreened] = useState(() => new Set());
  const attempts = useRef({});
  const [screenRound, setScreenRound] = useState(0);
  useEffect(() => {
    const waiting = Object.values(messagesByThread)
      .flatMap((rows) => awaitingScreen(rows, user.id))
      .filter((message) => (attempts.current[message.id] ?? 0) < RESCREEN_AFTER_MS.length);
    if (!waiting.length) return undefined;
    const dueAt = (message) => Date.parse(message.created_at) + RESCREEN_AFTER_MS[attempts.current[message.id] ?? 0];
    const timer = setTimeout(async () => {
      const due = waiting.filter((message) => dueAt(message) <= Date.now());
      for (const message of due) attempts.current[message.id] = (attempts.current[message.id] ?? 0) + 1;
      setUnscreened((current) => new Set([...current, ...due.map((message) => message.id)]));
      if (await rescreenStale(due, user.id, { olderThanMs: 0 })) {
        for (const threadId of new Set(due.map((message) => message.thread_id))) {
          const rows = await listMessages(threadId).catch(() => null);
          if (rows) setMessagesByThread((current) => ({ ...current, [threadId]: rows }));
        }
        reloadRef.current();
      }
      setScreenRound((round) => round + 1);
    }, Math.max(0, Math.min(...waiting.map(dueAt)) - Date.now()));
    return () => clearTimeout(timer);
  }, [messagesByThread, screenRound, user.id]);

  // Open the conversation that was asked for — an order's own thread, say —
  // or the newest one, the way the design does. Once, and the same one the
  // designed screen shows, which it picks only when it mounts. Picking the
  // newest again on every new arrival opened a conversation that had just
  // appeared, behind the one on screen, and marked it read: it arrived with
  // no unread badge, and the one being read stopped updating.
  const opened = useRef(null);
  useEffect(() => {
    if (opened.current || !threads?.length || (orderId && !resolvedThreadId)) return;
    const target = resolvedThreadId ?? threads[0].id;
    opened.current = target;
    loadThread(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads?.length, resolvedThreadId]);

  /**
   * Live: a message delivered to this company (or one of its own changing
   * state: delivered, held, released) arrives without a refresh. Realtime
   * applies the read policy per subscriber, so the other side hears of a
   * message only once it is delivered, never while it is checked or held.
   * The event only says which conversation moved; the rows are read again
   * through the normal query, with their sender and files.
   */
  const loadThreadRef = useRef(loadThread);
  loadThreadRef.current = loadThread;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const reloadCallsRef = useRef(reloadCalls);
  reloadCallsRef.current = reloadCalls;
  useEffect(() => {
    let listTimer = null;
    const channel = supabase
      .channel(`messages:${org.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const moved = payload.new?.thread_id ?? payload.old?.thread_id;
        if (moved && moved === activeThreadRef.current) loadThreadRef.current(moved);
        else {
          clearTimeout(listTimer);
          listTimer = setTimeout(() => reloadRef.current(), 300);
        }
      })
      // A call proposed, answered or cancelled by the other side shows up
      // in the panel at once (20261014000300).
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => reloadCallsRef.current())
      .subscribe();
    return () => {
      clearTimeout(listTimer);
      supabase.removeChannel(channel);
    };
  }, [org.id]);

  /**
   * Send. Nothing here waits before drawing: the message is in the timeline
   * the moment the button is pressed, the box is already empty, and the
   * button is free for the next one. The saved row replaces the drawn one,
   * and the screen's verdict arrives through the live channel.
   */
  function send(threadId, body, files = []) {
    const draft = { tempId: `outgoing-${Date.now()}-${Math.random()}`, body: body || fileOnlyBody(files), typed: body, files, at: new Date().toISOString() };
    const dropDraft = () => setOutgoing((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).filter((item) => item.tempId !== draft.tempId),
    }));
    setOutgoing((current) => ({ ...current, [threadId]: [...(current[threadId] ?? []), draft] }));
    setNotice(null);

    sendMessage({
      threadId,
      orgId: org.id,
      userId: user.id,
      body,
      files,
      onSaved: (row) => {
        if (files.length) setUploading((current) => ({ ...current, [row.id]: files.map((file) => file.name) }));
        setMessagesByThread((current) => ({
          ...current,
          [threadId]: [...(current[threadId] ?? []).filter((message) => message.id !== row.id), { ...row, documents: [] }],
        }));
        dropDraft();
      },
    })
      .then(({ message, failed, delivery }) => {
        if (delivery === "checking") setUnscreened((current) => new Set([...current, message.id]));
        setUploading((current) => {
          const next = { ...current };
          delete next[message.id];
          return next;
        });
        if (failed.length) setNotice(`Sent, but without the files: ${failed.join(" ")}`);
        return loadThread(threadId);
      })
      .catch((failure) => {
        // Never saved: the bubble says so, and the words are not lost.
        setOutgoing((current) => ({
          ...current,
          [threadId]: (current[threadId] ?? []).map((item) => (item.tempId === draft.tempId ? { ...item, failed: failure.message } : item)),
        }));
      });
  }

  async function changeCall(call, change) {
    setCallBusy(call.id);
    setCallNotes((current) => ({ ...current, [call.id]: null }));
    try {
      await change();
      await reloadCalls();
    } catch (failure) {
      setCallNotes((current) => ({ ...current, [call.id]: { text: failure.message, error: true } }));
    } finally {
      setCallBusy(null);
    }
  }

  const callHandlers = {
    accept: (call) => changeCall(call, () => acceptCall(call.id, ownZone)),
    // Each closes the call for both sides and cannot be undone: asked first.
    decline: (call) => setConfirmCall({ call, mode: "decline" }),
    cancel: (call) => setConfirmCall({ call, mode: call.status === "proposed" ? "withdraw" : "cancel" }),
    counter: (call) => setDialog({ threadId: call.thread_id, counterOf: call, key: call.id, busy: false, error: null }),
    join: async (call) => {
      setCallBusy(call.id);
      setCallNotes((current) => ({ ...current, [call.id]: null }));
      const answer = await joinCall(call.id);
      setCallBusy(null);
      if (!answer.ok) {
        setCallNotes((current) => ({ ...current, [call.id]: { text: answer.message, error: true } }));
        return;
      }
      setVideo({ call, join: answer.join, text: "Connecting to the call…" });
    },
  };

  async function confirmCallChange(reason) {
    const { call, mode } = confirmCall;
    await (mode === "decline" ? declineCall(call.id, reason) : cancelCall(call.id, reason));
    setConfirmCall(null);
    await reloadCalls();
  }

  // "Join call" on a dashboard opens this page with ?join=<call>: once the
  // page and its calls are drawn, that call is joined as if pressed here,
  // if it is on now.
  const joinOnOpen = useRef(new URLSearchParams(window.location.search).get("join"));
  useEffect(() => {
    const id = joinOnOpen.current;
    if (!id || !threads || !calls.length) return;
    joinOnOpen.current = null;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const call = calls.find((candidate) => candidate.id === id);
    if (call && callState(call, org.id) === "live") callHandlers.join(call);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, calls]);

  // Once the panel is drawn, Zoom joins inside it. Leaving (or switching
  // conversation, or leaving the page) ends the meeting for this person only.
  useEffect(() => {
    // Once per join: a failure updates `video` too, which must not retry.
    if (!video?.join || video.attempted || !zoomRoot.current) return undefined;
    // Zoom's meeting view is never narrower than about 360px: on a phone it
    // would be cut off, so the call opens in Zoom's app straight away.
    if (zoomRoot.current.clientWidth < 360) {
      setVideo((current) => current && {
        ...current,
        attempted: true,
        failed: true,
        text: "On a screen this narrow, the call opens in the Zoom app.",
      });
      return undefined;
    }
    setVideo((current) => current && { ...current, attempted: true });
    document.body.classList.remove("tsc-zoom-failed");
    (async () => {
      try {
        const ZoomMtgEmbedded = await loadZoomEmbedded();
        const client = ZoomMtgEmbedded.createClient();
        zoomClient.current = client;
        // Zoom draws its view at a fixed size: the panel's width, 16:9, in
        // speaker view (its default, "ribbon", is a small floating window).
        const width = Math.floor(zoomRoot.current.clientWidth);
        await client.init({
          zoomAppRoot: zoomRoot.current,
          language: "en-US",
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: { defaultViewType: "speaker", isResizable: false, viewSizes: { default: { width, height: Math.round((width * 9) / 16) } } },
          },
        });
        await client.join({
          sdkKey: video.join.sdkKey,
          signature: video.join.signature,
          meetingNumber: video.join.meetingNumber,
          password: video.join.passcode,
          userName: video.join.userName,
        });
        setVideo((current) => current && { ...current, joined: true, text: "You're in the call. The other side joins from this conversation." });
      } catch (failure) {
        // Zoom's own error box would sit over the page with a Retry that
        // fails the same way: take Zoom's view away and offer its app.
        console.warn("zoom join", failure?.errorCode, failure?.reason ?? failure?.message);
        try {
          window.ZoomMtgEmbedded?.destroyClient();
        } catch {
          // Nothing to tidy.
        }
        // Zoom puts its error dialog on <body>, outside its own view, keeps
        // drawing it after the client is gone, and its Retry fails the same
        // way. Hidden until this panel closes (messages.css).
        document.body.classList.add("tsc-zoom-failed");
        zoomClient.current = null;
        setVideo((current) => current && {
          ...current,
          failed: true,
          text: "The video can't open inside this page right now. Join the same call in the Zoom app.",
        });
      }
    })();
    return undefined;
  }, [video]);

  // Opening another conversation leaves the call: its panel is this one's.
  useEffect(() => {
    if (video && video.call.thread_id !== activeId) leaveVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Leaving the page (another screen of the app) leaves the call too:
  // otherwise Zoom stays joined, with sound, behind a panel that is gone.
  useEffect(() => () => {
    const client = zoomClient.current;
    zoomClient.current = null;
    Promise.resolve()
      .then(() => client?.leaveMeeting())
      .catch(() => null)
      .finally(() => {
        try {
          window.ZoomMtgEmbedded?.destroyClient();
        } catch {
          // Nothing to tidy.
        }
      });
    document.body.classList.remove("tsc-zoom-failed");
  }, []);

  async function leaveVideo() {
    try {
      await zoomClient.current?.leaveMeeting();
    } catch {
      // Already out.
    }
    try {
      window.ZoomMtgEmbedded?.destroyClient();
    } catch {
      // Nothing to tidy.
    }
    zoomClient.current = null;
    document.body.classList.remove("tsc-zoom-failed");
    setVideo(null);
  }

  async function submitSchedule({ startsAt, timeZone, title, agenda }) {
    setDialog((current) => ({ ...current, busy: true, error: null }));
    try {
      if (dialog.counterOf) {
        await counterCall({ callId: dialog.counterOf.id, startsAt, title, agenda, timeZone });
      } else {
        await proposeCall({ threadId: dialog.threadId, startsAt, title, agenda, timeZone });
      }
      setDialog(null);
      await reloadCalls();
    } catch (failure) {
      setDialog((current) => current && { ...current, busy: false, error: failure.message });
    }
  }

  // Still loading, or an order's conversation still being opened (the empty
  // state there would claim there is nothing to talk about on a thread one
  // round trip away). A failure says so: the error line further down is
  // never reached from here, and the page stayed blank.
  if (!threads || (orderId && !resolvedThreadId)) {
    return error ? (
      <div className="messages-empty" data-testid="threads-error">
        <h1>Your conversations could not be loaded</h1>
        <p role="alert">{error.message}</p>
      </div>
    ) : (
      <div className="messages-empty" role="status">
        <p>Loading your conversations…</p>
      </div>
    );
  }

  // A conversation exists once either side presses Message, not before:
  // quoting or starting an order does not open one.
  if (!threads.length) {
    return (
      <div className="messages-empty" data-testid="threads-empty">
        <h1>No conversations yet</h1>
        <p>
          {isFactory
            ? "Press Message on a request you have quoted, or on an order, to write to the brand. When a brand writes to you, the conversation shows here."
            : "Press Message on a quote or an order to write to the factory. When a factory writes to you, the conversation shows here."}
        </p>
      </div>
    );
  }

  /**
   * A live thread as the designed screen expects one.
   *
   * `localTime`, `status` and `responseLabel` are deliberately absent: the
   * design renders them only when present, so they simply do not appear.
   */
  const shaped = threads.map((thread) => {
    const counterparty = isFactory ? thread.brand_name : thread.factory_name;
    const outgoingRows = (outgoing[thread.id] ?? []).map((item) => ({
      id: item.tempId,
      sender_org_id: org.id,
      body: item.body,
      created_at: item.at,
      delivery: "checking",
      failed: item.failed,
      typed: item.typed,
      documents: item.files.map((file) => ({ file_name: file.name })),
    }));
    const rows = [...(messagesByThread[thread.id] ?? []), ...outgoingRows];

    return {
      id: thread.id,
      name: counterparty ?? "—",
      initials: initialsOf(counterparty),
      // The project's name, so two conversations with one company differ.
      project: projectNames.get(thread.id) ?? thread.subject_title ?? "",
      kind: thread.subject_kind === "order" ? "Production order" : "Request for quote",
      lastDate: dayLabel(thread.last_message_at),
      // The other side's last words in the reader's language, as in the
      // conversation itself; the reader's own as typed.
      lastPreview: (thread.last_sender_org_id !== org.id && thread.last_body_translated_lang === "en"
        ? thread.last_body_translated
        : thread.last_body) ?? "No messages yet.",
      unread: Number(thread.unread_count) || 0,
      files: [],
      messages: rows.map((message) => {
        const mine = message.sender_org_id === org.id;
        // The reader's own words as they typed them, the translation one
        // click away. The other side's: the reader's language first.
        const view = mine
          ? { text: message.body, isTranslation: Boolean(message.body_translated), original: message.body_translated, originalLang: message.body_translated_lang }
          : readable(message);
        const linked = (message.documents ?? []).filter((doc) => doc.file_name);
        const files = linked.length
          ? linked.map((doc) => ({ name: doc.file_name, uploading: !doc.storage_path, onOpen: doc.storage_path ? () => openAttachment(doc, setError) : undefined }))
          : (uploading[message.id] ?? []).map((name) => ({ name, uploading: true }));
        return {
          id: message.id,
          from: mine ? (isFactory ? "factory" : "brand") : (isFactory ? "brand" : "factory"),
          // The bubble's side and label: the reader's own messages on the
          // right with their own name, whichever side the reader is on.
          own: mine,
          time: sentAt(message) ? TIME.format(new Date(sentAt(message))) : "",
          // Only the sender's company ever reads a message that is not
          // delivered (the read policy), so this is always the reader's own.
          status: deliveryStatus(message, { unscreened: unscreened.has(message.id) }),
          // The reader's own language first, with the original one click
          // away — the rule in CLAUDE.md. The designed bubble shows `body`
          // by default and `translation` when toggled, so the readable text
          // is the body and the toggle reveals what was actually typed.
          // Whenever there is text in the other language, it is one click
          // away, whichever way it goes: a factory reading a brand's English
          // has the Chinese translation behind the toggle, as a brand reading
          // a factory's Chinese has the original.
          ...(view.original
            ? {
              body: view.text,
              translation: view.original,
              language: view.originalLang,
              ...(!mine && view.isTranslation
                ? {
                  showAltLabel: `Show original${LANGUAGE_NAME[view.originalLang] ? ` (${LANGUAGE_NAME[view.originalLang]})` : ""}`,
                  hideAltLabel: "Show translation",
                }
                : {
                  showAltLabel: `Show translation${LANGUAGE_NAME[view.originalLang] ? ` (${LANGUAGE_NAME[view.originalLang]})` : ""}`,
                  hideAltLabel: mine ? "Show what you wrote" : "Show original",
                }),
            }
            : { body: view.text }),
          attachments: files.length ? files : undefined,
        };
      }),
    };
  });

  // Each conversation's calls as the designed cards.
  const callCards = {};
  for (const thread of threads) {
    const theirs = calls.filter((call) => call.thread_id === thread.id);
    callCards[thread.id] = callsForPanel(theirs, org.id, now).map((call) => panelCard(call, {
      now,
      orgId: org.id,
      ownZone,
      otherZone: theirZones[thread.id] ?? null,
      handlers: callHandlers,
      busyId: callBusy,
      notes: callNotes,
    }));
  }
  const dialogThread = dialog ? threads.find((thread) => thread.id === dialog.threadId) : null;
  const dialogOther = dialogThread ? (isFactory ? dialogThread.brand_name : dialogThread.factory_name) ?? "" : "";

  return (
    <>
      <MessagesScreen
        calls={callCards}
        video={video ? {
          title: video.call.title,
          text: video.text,
          mountRef: zoomRoot,
          failed: Boolean(video.failed),
          joinUrl: video.join.joinUrl,
          onLeave: leaveVideo,
        } : null}
        scheduling={{
          open: Boolean(dialog),
          key: dialog?.key ?? "new",
          onOpen: () => activeId && setDialog({ threadId: activeId, key: `new-${Date.now()}`, busy: false, error: null }),
          onClose: () => setDialog(null),
          ownZone,
          zones: zoneOptions(ownZone),
          otherName: dialogOther,
          // Answering an invite with another time: their times read in the
          // zone they proposed in.
          otherZone: dialog ? theirZoneFor(dialog.counterOf, org.id, theirZones[dialog.threadId]) : null,
          heading: dialog?.counterOf ? "Propose another time" : undefined,
          submitLabel: dialog?.counterOf ? "Send new time" : undefined,
          initial: dialog?.counterOf ? { title: dialog.counterOf.title, agenda: dialog.counterOf.agenda ?? "" } : undefined,
          busy: dialog?.busy ?? false,
          error: dialog?.error ?? null,
          onSubmit: submitSchedule,
        }}
        threads={shaped}
        initialThreadId={resolvedThreadId}
        onSelectThread={loadThread}
        onSend={send}
        canAttach
        attachAccept={ATTACHMENT_ACCEPT}
        acceptFiles={(picked) => {
          const refused = picked.map(attachmentRefusal).filter(Boolean);
          setNotice(refused.length ? refused.join(" ") : null);
          return picked.filter((file) => !attachmentRefusal(file));
        }}
        composerNotice={error ? { text: error.message, alert: true } : notice ? { text: notice } : null}
        ownName={org.name}
      />
      {confirmCall && (
        <CallChangeDialog
          mode={confirmCall.mode}
          title={confirmCall.call.title}
          counterparty={otherSide(confirmCall.call, org.id).name}
          onConfirm={confirmCallChange}
          onClose={() => setConfirmCall(null)}
        />
      )}
    </>
  );
}
